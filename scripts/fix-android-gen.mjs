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

// 补丁 2：MainActivity.kt —— enableEdgeToEdge 后给内容加系统栏避让，防止与状态栏重叠
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

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // edge-to-edge 模式下，给根内容视图加上系统栏（状态栏/导航栏）内边距，
    // 避免 WebView 内容与状态栏重叠
    val contentView = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
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
