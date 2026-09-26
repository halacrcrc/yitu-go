#!/usr/bin/env bash
# KataGo Android NDK 交叉编译脚本（arm64-v8a，Eigen 后端，SHARED 库）
# 产出：libkatago.so（16KB 页面对齐，可直接放入 jniLibs/arm64-v8a/）
#
# 前置依赖（本机已就绪的路径，可按需调整）：
#   NDK        = C:/android-tools/sdk/ndk/26.3.11579264
#   CMake      = C:/katago-test/tools/cmake-3.28.4-windows-x86_64/bin/cmake.exe
#   KataGo源码 = C:/katago-test/KataGo-1.15.0（v1.15.0，匹配 humanSL 模型）
#   Eigen      = C:/katago-test/eigen/eigen-3.4.0（3.4.0 解压版）
#   zlib源码   = C:/katago-test/zlib-src/zlib-1.3.1
#
# 用法: bash scripts/build-katago-android.sh
set -e
NDK="C:/android-tools/sdk/ndk/26.3.11579264"
CMAKE="C:/katago-test/tools/cmake-3.28.4-windows-x86_64/bin/cmake.exe"
MAKE="$NDK/prebuilt/windows-x86_64/bin/make.exe"
JOBS=8

echo "=== 1/2 zlib（静态库，PIC）==="
cmake -G "Unix Makefiles" \
  -DCMAKE_MAKE_PROGRAM="$MAKE" \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-29 \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
  -DBUILD_SHARED_LIBS=OFF \
  -S "C:/katago-test/zlib-src/zlib-1.3.1" -B "C:/katago-test/build-zlib" > /dev/null
cmake --build "C:/katago-test/build-zlib" -- -j$JOBS > /dev/null

echo "=== 2/2 KataGo（SHARED 库）==="
# 关键点（均为实测踩坑）：
#   - EIGEN3_INCLUDE_DIRS 需指向解压根（内含 Eigen/），且路径需与上次一致
#   - Android 需补 -DBYTE_ORDER=LITTLE_ENDIAN（sha2.cpp 字节序宏缺失）
#   - libzip 缺失时 KataGo 自动 NO_LIBZIP（analysis 不受影响）
#   - 16KB 对齐：-Wl,-z,max-page-size=16384（Google Play 硬性要求）
cmake -G "Unix Makefiles" \
  -DCMAKE_MAKE_PROGRAM="$MAKE" \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-29 \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_BACKEND=EIGEN \
  -DNO_GIT_REVISION=1 \
  -DBUILD_SHARED_LIBS=OFF \
  -DZLIB_INCLUDE_DIR="C:/katago-test/zlib-src/zlib-1.3.1" \
  -DZLIB_LIBRARY="C:/katago-test/build-zlib/libz.a" \
  -DEIGEN3_INCLUDE_DIRS="C:/katago-test/eigen/eigen-3.4.0" \
  -DCMAKE_CXX_FLAGS="-DBYTE_ORDER=LITTLE_ENDIAN -DLITTLE_ENDIAN=1234 -DBIG_ENDIAN=4321" \
  -DCMAKE_SHARED_LINKER_FLAGS="-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384" \
  -S "C:/katago-test/KataGo-1.15.0/cpp" -B "C:/katago-test/build-katago115"
cmake --build "C:/katago-test/build-katago115" --target katago -- -j$JOBS

echo "=== 3/3 对齐验证 ==="
OBJDUMP="$NDK/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-objdump.exe"
"$OBJDUMP" -p "C:/katago-test/build-katago115/libkatago.so" | awk '$1 == "LOAD" { print $NF }' | sort -u
echo "完成: C:/katago-test/build-katago115/libkatago.so"
