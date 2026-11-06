#!/bin/sh
# Voir config.toml. NDK_HOME est défini par la CLI Tauri au moment du build Android.
exec "$NDK_HOME"/toolchains/llvm/prebuilt/*/bin/llvm-ranlib "$@"
