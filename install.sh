#!/usr/bin/env bash

# ==============================================================================
# Tele-vs-CLI Installer for Linux & macOS (OS X)
# Usage:
#   Local:  ./install.sh
#   Remote: curl -fsSL https://raw.githubusercontent.com/usmrip/tele-vs-cli/main/install.sh | bash
# ==============================================================================

set -e

REPO_URL="https://github.com/usmrip/tele-vs-cli.git"
INSTALL_DIR="${HOME}/.tele-vs-cli"

echo "=============================================================================="
echo "🚀 Tele-vs-CLI Installer (Linux & macOS)"
echo "=============================================================================="

# 1. Deteksi OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     OS_NAME="Linux";;
    Darwin*)    OS_NAME="macOS";;
    *)          OS_NAME="Unknown: ${OS}";;
esac
echo "📌 Sistem Operasi : ${OS_NAME} ($(uname -m))"

# 2. Periksa Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "⚠️ Node.js belum terpasang di sistem!"
    if [ "${OS_NAME}" = "macOS" ]; then
        if command -v brew >/dev/null 2>&1; then
            echo "Menginstal Node.js melalui Homebrew..."
            brew install node
        else
            echo "❌ Silakan pasang Node.js (>= 18.0.0) terlebih dahulu dari https://nodejs.org/"
            exit 1
        fi
    elif [ "${OS_NAME}" = "Linux" ]; then
        if command -v apt-get >/dev/null 2>&1; then
            echo "💡 Menginstal Node.js melalui apt-get..."
            sudo apt-get update && sudo apt-get install -y nodejs npm || true
        elif command -v dnf >/dev/null 2>&1; then
            echo "💡 Menginstal Node.js melalui dnf..."
            sudo dnf install -y nodejs npm || true
        elif command -v pacman >/dev/null 2>&1; then
            echo "💡 Menginstal Node.js melalui pacman..."
            sudo pacman -Sy --noconfirm nodejs npm || true
        fi
    fi

    if ! command -v node >/dev/null 2>&1; then
        echo "❌ Node.js gagal dipasang otomatis. Pasang Node.js v18+ dari https://nodejs.org/"
        exit 1
    fi
fi

NODE_VER="$(node -v | sed 's/v//')"
MAJOR_VER="$(echo "${NODE_VER}" | cut -d'.' -f1)"
echo "📌 Versi Node.js  : v${NODE_VER}"

if [ "${MAJOR_VER}" -lt 18 ]; then
    echo "❌ Versi Node.js (${NODE_VER}) tidak memenuhi syarat minimal (>= 18.0.0)."
    echo "Perbarui Node.js Anda melalui nvm atau https://nodejs.org/"
    exit 1
fi

# 3. Tentukan Lokasi Source Code (Lokal atau Clone Git)
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "${SCRIPT_DIR}" ] && [ -f "${SCRIPT_DIR}/bin/tele.js" ]; then
    TARGET_DIR="${SCRIPT_DIR}"
    echo "📌 Menggunakan direktori lokal: ${TARGET_DIR}"
else
    TARGET_DIR="${INSTALL_DIR}"
    echo "📌 Memasang ke direktori: ${TARGET_DIR}"
    if [ -d "${TARGET_DIR}/.git" ]; then
        echo "Memperbarui repositori yang sudah ada..."
        cd "${TARGET_DIR}" && git pull origin main || true
    else
        echo "Mengunduh Tele-vs-CLI dari GitHub..."
        mkdir -p "${TARGET_DIR}"
        git clone "${REPO_URL}" "${TARGET_DIR}"
    fi
fi

# 4. Jalankan Universal Node Installer
cd "${TARGET_DIR}"
node scripts/install.js
