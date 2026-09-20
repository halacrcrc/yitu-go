// Android gen 工程补丁：tauri android init 后运行一次
// 修复两个 Windows 构建问题：
//   1) 中文项目路径触发 AGP 的路径检查 → android.overridePathCheck=true
//   2) JDK 17.0.5+ 禁止 ProcessBuilder 直接启动 .bat → BuildTask 改经 cmd /c
// 用法: node scripts/fix-android-gen.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const gen = join(process.cwd(), "src-tauri", "gen", "android");
if (!existsSync(gen)) {
  console.error("未找到 src-tauri/gen/android，请先运行: npx tauri android init");
  process.exit(1);
}

// 补丁 1：gradle.properties
const gradleProps = join(gen, "gradle.properties");
let props = readFileSync(gradleProps, "utf8");
if (!props.includes("android.overridePathCheck")) {
  appendFileSync(gradleProps, "\nandroid.overridePathCheck=true\n");
  console.log("✓ gradle.properties: 添加 android.overridePathCheck=true");
} else {
  console.log("• gradle.properties: 已存在 overridePathCheck");
}

// 补丁 2：MainActivity.kt —— edge-to-edge 一体化：透明系统栏 + 高度注入 CSS 变量（--safe-top/--safe-bottom）
const mainActivityKt = join(
  gen,
  "app",
  "src",
  "main",
  "java",
  "com",
  "yitugo",
  "app",
  "MainActivity.kt",
);
const fixedMainActivity = `package com.yitugo.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.roundToInt

class MainActivity : TauriActivity() {
  private var safeTopPx = 0f   // 物理像素
  private var safeBottomPx = 0f
  private var lastInjectedTop = -1

  // edge-to-edge 一体化：状态栏/导航栏透明，应用背景延伸到系统栏后面。
  // 系统栏高度除以屏幕密度后注入 CSS 变量（--safe-top/--safe-bottom，单位 CSS px），
  // 前端按需避让；注入分多轮重试以覆盖 WebView 异步创建与页面加载的时机。
  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val contentView = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { _, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      safeTopPx = bars.top.toFloat()
      safeBottomPx = bars.bottom.toFloat()
      injectSafeArea()
      insets // 不消费：WebView 仍能拿到 insets（供其内部使用）
    }
    // WebView 就绪时机不定（Rust 侧异步创建），分多轮注入保证页面加载后变量就位
    val handler = Handler(Looper.getMainLooper())
    listOf(500L, 1200L, 2500L, 4000L, 6000L, 9000L, 13000L).forEach { delay ->
      handler.postDelayed({ injectSafeArea() }, delay)
    }
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) injectSafeArea()
  }

  override fun onResume() {
    super.onResume()
    injectSafeArea()
  }

  private fun findWebView(root: View): WebView? {
    if (root is WebView) return root
    if (root is ViewGroup) {
      for (i in 0 until root.childCount) {
        findWebView(root.getChildAt(i))?.let { return it }
      }
    }
    return null
  }

  private fun injectSafeArea() {
    if (safeTopPx <= 0f && safeBottomPx <= 0f) return
    val root = findViewById<View>(android.R.id.content) ?: return
    val web = findWebView(root) ?: return
    val density = resources.displayMetrics.density
    val topDp = (safeTopPx / density).roundToInt()
    val bottomDp = (safeBottomPx / density).roundToInt()
    if (topDp == lastInjectedTop) return // 值未变化且已注入过
    lastInjectedTop = topDp
    val js = "(function(){var d=document.documentElement;d.style.setProperty('--safe-top','\${topDp}px');d.style.setProperty('--safe-bottom','\${bottomDp}px');})();"
    web.evaluateJavascript(js, null)
  }
}
`;
if (existsSync(mainActivityKt)) {
  const cur = readFileSync(mainActivityKt, "utf8");
  if (!cur.includes("setOnApplyWindowInsetsListener")) {
    writeFileSync(mainActivityKt, fixedMainActivity);
    console.log("✓ MainActivity.kt: 添加系统栏避让（insets padding）");
  } else {
    console.log("• MainActivity.kt: 已包含状态栏避让补丁");
  }
} else {
  console.error("✗ 未找到 MainActivity.kt");
  process.exit(1);
}

// 补丁 3：BuildTask.kt 改用 cmd /c 启动 npm
const buildTaskKt = join(
  gen,
  "buildSrc",
  "src",
  "main",
  "java",
  "com",
  "yitugo",
  "app",
  "kotlin",
  "BuildTask.kt",
);
let kt = readFileSync(buildTaskKt, "utf8");
const oldExec = `project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            executable(executable)`;
const newExec = `project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            if (Os.isFamily(Os.FAMILY_WINDOWS)) {
                executable("cmd")
                args(listOf("/c", executable) + args)
            } else {
                executable(executable)
                args(args)
            }`;
if (kt.includes(oldExec)) {
  kt = kt.replace(oldExec, newExec);
  writeFileSync(buildTaskKt, kt);
  console.log("✓ BuildTask.kt: Windows 下改用 cmd /c 启动 npm");
} else if (kt.includes('executable("cmd")')) {
  console.log("• BuildTask.kt: 已包含 cmd /c 补丁");
} else {
  console.error("✗ BuildTask.kt: 结构与预期不符，请手动检查");
  process.exit(1);
}
console.log("补丁完成。现在可以运行: npx tauri android build --apk --target aarch64");

// 补丁 4：minSdk 升到 29（Android 10+）
const appGradle = join(gen, "app", "build.gradle.kts");
if (existsSync(appGradle)) {
  let g = readFileSync(appGradle, "utf8");
  if (/minSdk\s*=\s*24/.test(g)) {
    g = g.replace(/minSdk\s*=\s*24/, "minSdk = 29");
    writeFileSync(appGradle, g);
    console.log("✓ app/build.gradle.kts: minSdk 24 → 29");
  } else if (/minSdk\s*=\s*29/.test(g)) {
    console.log("• app/build.gradle.kts: minSdk 已为 29");
  } else {
    console.error("✗ app/build.gradle.kts: 未找到 minSdk 行，请手动检查");
  }
}
