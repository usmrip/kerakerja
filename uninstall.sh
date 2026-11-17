#!/usr/bin/env bash

# ==============================================================================
# KeraKerja Uninstaller for Linux & macOS (OS X)
# Usage:
#   Local:  ./uninstall.sh [--yes] [--purge] [--dry-run]
#   Remote: curl -fsSL https://raw.githubusercontent.com/usmrip/kerakerja/main/uninstall.sh | bash
# ==============================================================================

set -e

INSTALL_DIR="${HOME}/.kerakerja"
BIN_LAUNCHER="${HOME}/.local/bin/kerakerja"

echo "=============================================================================="
echo "🧹 KeraKerja Uninstaller (Linux & macOS)"
echo "=============================================================================="

# 1. Deteksi OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     OS_NAME="Linux";;
    Darwin*)    OS_NAME="macOS";;
    *)          OS_NAME="Unknown: ${OS}";;
esac
echo "📌 Sistem Operasi : ${OS_NAME} ($(uname -m))"

# Cek flag --dry-run
DRY_RUN=0
for arg in "$@"; do
    if [ "${arg}" = "--dry-run" ]; then
        DRY_RUN=1
    fi
done

# 2. Tentukan Lokasi Source Code (Lokal atau Remote Install Dir)
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "${SCRIPT_DIR}" ] && [ -f "${SCRIPT_DIR}/scripts/uninstall.js" ]; then
    TARGET_DIR="${SCRIPT_DIR}"
    echo "📌 Menggunakan direktori lokal: ${TARGET_DIR}"
else
    TARGET_DIR="${INSTALL_DIR}"
    echo "📌 Direktori target instalasi : ${TARGET_DIR}"
fi

# 3. Jalankan Universal Node Uninstaller jika tersedia
if command -v node >/dev/null 2>&1 && [ -f "${TARGET_DIR}/scripts/uninstall.js" ]; then
    cd "${HOME}"
    node "${TARGET_DIR}/scripts/uninstall.js" "$@"
else
    echo "⚠️ Node.js atau scripts/uninstall.js tidak ditemukan, menjalankan pembersihan fallback..."

    if [ "${DRY_RUN}" -eq 1 ]; then
        echo "[dry-run] Akan menghentikan service & menghapus ${BIN_LAUNCHER} serta ${INSTALL_DIR}"
        exit 0
    fi

    if [ "${OS_NAME}" = "Linux" ]; then
        for SVC in "kerakerja" "tele-vs-cli"; do
            UNIT_FILE="${HOME}/.config/systemd/user/${SVC}.service"
            if [ -f "${UNIT_FILE}" ]; then
                systemctl --user stop "${SVC}" >/dev/null 2>&1 || true
                systemctl --user disable "${SVC}" >/dev/null 2>&1 || true
                rm -f "${UNIT_FILE}"
                systemctl --user daemon-reload >/dev/null 2>&1 || true
                echo "✅ Layanan systemd ${SVC} dihapus."
            fi
        done
    elif [ "${OS_NAME}" = "macOS" ]; then
        for PLIST in "com.usmrip.kerakerja.plist" "com.usmrip.tele-vs-cli.plist"; do
            PLIST_FILE="${HOME}/Library/LaunchAgents/${PLIST}"
            if [ -f "${PLIST_FILE}" ]; then
                launchctl unload "${PLIST_FILE}" >/dev/null 2>&1 || true
                rm -f "${PLIST_FILE}"
                echo "✅ Layanan launchd ${PLIST} dihapus."
            fi
        done
    fi

    rm -f "${BIN_LAUNCHER}" "${HOME}/.local/bin/tele"
    echo "✅ Launcher dihapus: ${BIN_LAUNCHER}"

    rm -rf "${INSTALL_DIR}" "${HOME}/.tele-vs-cli"
    echo "✅ Direktori instalasi dihapus: ${INSTALL_DIR}"

    echo "=============================================================================="
    echo "✅ KeraKerja Berhasil Dicopot!"
    echo "=============================================================================="
fi
