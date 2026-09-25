// Android gen 工程补丁：tauri android init 后运行一次
// 修复 Windows 构建问题与安卓 UI 适配，共 5 项：
//   1) 中文路径检查覆盖（android.overridePathCheck=true）
//   2) MainActivity：edge-to-edge 一体化（透明系统栏 + WebView 原生 insets padding，
//      系统栏高度不再注入 CSS——原生避让 100% 可靠，不依赖 JS 时机）
//   3) BuildTask 改经 cmd /c 启动 npm（JDK 17.0.5+ 限制）
//   4) minSdk 29
//   5) 主题：窗口背景墨绿色 + 透明系统栏（避让区域与界面浑然一体）
// 用法: node scripts/fix-android-gen.mjs
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const gen = join(process.cwd(), "src-tauri", "gen", "android");
if (!existsSync(gen)) {
  console.error("未找到 src-tauri/gen/android，请先运行: npx tauri android init");
  process.exit(1);
}

// ---------- 补丁 1：gradle.properties ----------
const gradleProps = join(gen, "gradle.properties");
let props = readFileSync(gradleProps, "utf8");
if (!props.includes("android.overridePathCheck")) {
  appendFileSync(gradleProps, "\nandroid.overridePathCheck=true\n");
  console.log("✓ gradle.properties: 添加 android.overridePathCheck=true");
} else {
  console.log("• gradle.properties: 已存在 overridePathCheck");
}

// ---------- 补丁 2：MainActivity（edge-to-edge + 原生 insets padding） ----------
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
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // 背景延伸、内容避让：enableEdgeToEdge 让窗口背景（墨绿）延伸到系统栏后面，
  // 内容（WebView）用 safeDrawing insets 占位——含状态栏/手势条/刘海，比
  // systemBars 更全面。关键：insets 值先落地保存，WebView 稍后创建时再应用。
  private var webView: WebView? = null
  private var lastTop = 0
  private var lastBottom = 0

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val contentView = findViewById<View>(android.R.id.content)
    contentView.viewTreeObserver.addOnGlobalLayoutListener { applyInsets() }
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { _, insets ->
      val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      applyInsets(safe.top, safe.bottom)
      insets
    }
  }

  override fun onResume() {
    super.onResume()
    applyInsets()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) applyInsets()
  }

  private fun applyInsets(top: Int = -1, bottom: Int = -1) {
    if (top >= 0) lastTop = top
    if (bottom >= 0) lastBottom = bottom
    if (lastTop <= 0 && lastBottom <= 0) return
    if (webView == null) {
      val root = findViewById<View>(android.R.id.content) ?: return
      val w = findWebView(root) ?: return
      w.setBackgroundColor(Color.TRANSPARENT)
      webView = w
    }
    webView?.setPadding(0, lastTop, 0, lastBottom)
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
}
`;
if (existsSync(mainActivityKt)) {
  const cur = readFileSync(mainActivityKt, "utf8");
  if (!cur.includes("safeDrawing")) {
    writeFileSync(mainActivityKt, fixedMainActivity);
    console.log("✓ MainActivity.kt: 背景延伸 + safeDrawing 内容避让");
  } else {
    console.log("• MainActivity.kt: 已包含 safeDrawing 补丁");
  }
} else {
  console.error("✗ 未找到 MainActivity.kt");
  process.exit(1);
}

// ---------- 补丁 3：BuildTask 改用 cmd /c 启动 npm ----------
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

// ---------- 补丁 4：minSdk 29 ----------
const appGradle = join(gen, "app", "build.gradle.kts");
if (existsSync(appGradle)) {
  let g = readFileSync(appGradle, "utf8");
  if (/minSdk\s*=\s*24/.test(g)) {
    g = g.replace(/minSdk\s*=\s*24/, "minSdk = 29");
    writeFileSync(appGradle, g);
    console.log("✓ app/build.gradle.kts: minSdk 24 → 29");
  } else if (/minSdk\s*=\s*29/.test(g)) {
    console.log("• app/build.gradle.kts: minSdk 已为 29");
  }
}

// ---------- 补丁 5：主题背景色 + 透明系统栏 ----------
const themesFiles = [
  join(gen, "app", "src", "main", "res", "values", "themes.xml"),
  join(gen, "app", "src", "main", "res", "values-night", "themes.xml"),
];
const colorsXml = join(gen, "app", "src", "main", "res", "values", "colors.xml");
const themeInject =
  '<item name="android:windowBackground">@color/yitu_window_bg</item>' +
  '<item name="android:statusBarColor">@android:color/transparent</item>' +
  '<item name="android:navigationBarColor">@android:color/transparent</item>';
for (const f of themesFiles) {
  if (!existsSync(f)) continue;
  let x = readFileSync(f, "utf8");
  if (!x.includes("windowBackground")) {
    x = x.replace(
      '<style name="Theme.yitu_go" parent="Theme.MaterialComponents.DayNight.NoActionBar">',
      '<style name="Theme.yitu_go" parent="Theme.MaterialComponents.DayNight.NoActionBar">' + themeInject,
    );
    writeFileSync(f, x);
    console.log("✓ themes.xml: windowBackground + 透明系统栏");
  } else {
    console.log("• themes.xml: 已配置");
  }
}
if (existsSync(colorsXml)) {
  let c = readFileSync(colorsXml, "utf8");
  if (!c.includes("yitu_window_bg")) {
    c = c.replace("</resources>", '    <color name="yitu_window_bg">#0B100E</color>\n</resources>');
    writeFileSync(colorsXml, c);
    console.log("✓ colors.xml: yitu_window_bg");
  }
}

console.log("补丁完成。现在可以运行: npx tauri android build --apk --target aarch64");
