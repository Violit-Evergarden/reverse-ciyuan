#!/usr/bin/env bash
# 次元壁纸逆向环境一键重建(另一台电脑/新会话).
# 前置: macOS + Homebrew, Android cmdline-tools, mitmproxy(仅生成 CA 用), python3.
# 用法: bash setup_env.sh          # 全流程
#       bash setup_env.sh quick    # 跳过 AVD/CA 创建, 仅启动 emulator+frida
set -uo pipefail
ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
VENV="${REVERSE_VENV:-$HOME/reverse-venv}"
FRIDA_VER=16.7.19
AVD=ciyuan_aosp
MODE="${1:-full}"

echo "== [1/6] python venv + frida $FRIDA_VER + hpack =="
if [ ! -x "$VENV/bin/frida" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet "frida==$FRIDA_VER" "frida-tools==12.5.0" hpack
fi
"$VENV/bin/frida" --version

echo "== [2/6] frida-server (android-arm64) =="
FS=/tmp/frida-server-$FRIDA_VER
if [ ! -f "$FS" ]; then
  curl -sL -o "$FS.xz" "https://github.com/frida/frida/releases/download/$FRIDA_VER/frida-server-$FRIDA_VER-android-arm64.xz"
  xz -d -f "$FS.xz"
fi

if [ "$MODE" = "full" ]; then
  echo "== [3/6] AVD(若不存在) =="
  if ! emulator -list-avds 2>/dev/null | grep -q "^$AVD$"; then
    echo "   需先: sdkmanager 'system-images;android-34;aosp_arm64;arm64-v8a' 且 avdmanager create avd -n $AVD -k 'system-images;android-34;aosp_arm64;arm64-v8a'"
    echo "   (本脚本不自动建 AVD, 因镜像下载较大; 建好后重跑本脚本)"
    exit 1
  fi
  echo "== [4/6] mitmproxy CA(若不存在) =="
  if [ ! -f "$HOME/.mitmproxy/mitmproxy-ca-cert.pem" ]; then
    (mitmdump -p 18080 &>/dev/null &); sleep 3; pkill -f "mitmdump -p 18080"
  fi
else
  echo "== [3/6][4/6] quick 模式跳过 AVD/CA 创建 =="
fi

echo "== [5/6] 启动 emulator(-writable-system) + root + remount + 系统 CA + 重启 =="
if ! adb devices 2>/dev/null | grep -q emulator; then
  nohup emulator -avd $AVD -no-window -no-audio -gpu swiftshader_indirect -no-snapshot -memory 3072 -no-metrics -no-boot-anim -writable-system >/tmp/emulator.log 2>&1 &
  adb wait-for-device
  for i in $(seq 1 40); do [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 3; done
fi
adb root >/dev/null 2>&1; sleep 2; adb wait-for-device
adb remount 2>&1 | tail -1
if [ "$MODE" = "full" ] && [ -f "$HOME/.mitmproxy/mitmproxy-ca-cert.pem" ]; then
  HASH=$(openssl x509 -inform PEM -subject_hash_old -in "$HOME/.mitmproxy/mitmproxy-ca-cert.pem" -noout)
  { openssl x509 -in "$HOME/.mitmproxy/mitmproxy-ca-cert.pem" -outform PEM
    openssl x509 -in "$HOME/.mitmproxy/mitmproxy-ca-cert.pem" -text -fingerprint -noout; } > /tmp/$HASH.0
  if ! adb shell "ls /system/etc/security/cacerts/$HASH.0" >/dev/null 2>&1; then
    adb push /tmp/$HASH.0 /system/etc/security/cacerts/$HASH.0 >/dev/null
    adb shell "chmod 644 /system/etc/security/cacerts/$HASH.0; restorecon /system/etc/security/cacerts/$HASH.0"
    echo "   CA 已写入 /system, 重启使其进内存信任库..."
    adb reboot; sleep 5; adb wait-for-device
    for i in $(seq 1 40); do [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 3; done
    adb root >/dev/null 2>&1; sleep 2; adb wait-for-device
  fi
fi

echo "== [6/6] 启动 frida-server =="
adb push "$FS" /data/local/tmp/frida-server-$FRIDA_VER >/dev/null 2>&1
adb shell "chmod 755 /data/local/tmp/frida-server-$FRIDA_VER; pkill -f frida-server; nohup /data/local/tmp/frida-server-$FRIDA_VER >/data/local/tmp/fs.log 2>&1 &"
sleep 3
"$VENV/bin/frida-ps" -U 2>/dev/null | head -3

echo
echo "完成. 验证: adb shell pidof me.alzz.awsl (App 需已安装; 未装则 adb install <apk>)"
echo "抓取: python3 $VENV/bin/python tools/frida/spawn_dump_ctl.py tools/frida/dump4.js 120 <前缀>"
