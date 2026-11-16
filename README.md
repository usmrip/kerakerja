# 🚀 Tele-vs-CLI

> **Headless Telegram & Remote AI Agent Runner (Zero VSIX)**  
> Eksekusi perintah dan tugas AI Agent dari Telegram, Dashboard Web, atau Terminal tanpa perlu membuka aplikasi VS Code.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![VSIX Free](https://img.shields.io/badge/VSIX-None-blue.svg)](#arsitektur)

---

## 🌟 Mengapa Tele-vs-CLI?

Pada versi sebelumnya (*tele-vs-cli*), eksekusi tugas AI Agent bergantung pada VS Code yang harus terbuka dengan ekstensi VSIX terpasang.

**Tele-vs-CLI** hadir sebagai runner mandiri (**headless agent daemon**):
- ⚡ **Zero VSIX Dependency:** Murni berjalan di Node.js CLI runtime tanpa ekstensi editor.
- 🐧 **Cocok untuk Server & VPS Headless:** Dapat berjalan di Linux server, Docker, Mac, maupun Windows background daemon.
- 🤖 **Multi AI Agent:** Mendukung **Google Antigravity (`agy`)**, **Claude Code (`claude`)**, **Gemini CLI (`gemini`)**, **Codex (`codex`)**, dan **Cline (`cline`)**.
- 🛡️ **Keamanan Tingkat Tinggi:** Perlindungan dari path traversal, penyaringan perintah sistem berbahaya (*dangerous command filter*), dan penyamaran token sensitif (*mask secrets*).
- 🔄 **Sinkronisasi Dua Arah:** Terhubung ke server dashboard dan bot Telegram secara real-time.

---

## 📦 Panduan Instalasi (Linux, Windows, macOS)

Tele-vs-CLI menyediakan skrip instalasi otomatis untuk **Linux**, **Windows**, dan **macOS (OS X)**.

### 🐧 Linux & 🍎 macOS (OS X)

**Cara 1: One-liner via cURL (Instalasi Langsung):**
```bash
curl -fsSL https://raw.githubusercontent.com/usmrip/tele-vs-cli/main/install.sh | bash
```

**Cara 2: Dari Repositori Lokal:**
```bash
git clone https://github.com/usmrip/tele-vs-cli.git
cd tele-vs-cli
./install.sh
```

---

### 🪟 Windows (PowerShell / Command Prompt)

**Cara 1: One-liner via PowerShell:**
```powershell
irm https://raw.githubusercontent.com/usmrip/tele-vs-cli/main/install.ps1 | iex
```

**Cara 2: Dari Repositori Lokal:**
```powershell
git clone https://github.com/usmrip/tele-vs-cli.git
cd tele-vs-cli
.\install.ps1
```
*(Atau klik ganda `install.cmd` untuk pengguna Command Prompt/GUI)*

---

### 🌐 Universal Node.js Installer (Semua OS)
Jika Node.js (>= 18.0.0) sudah terpasang di sistem:
```bash
cd tele-vs-cli
node scripts/install.js
```
*atau:*
```bash
npm run install-cli
```

---

## 🧹 Panduan Uninstall (Linux, Windows, macOS)

Tele-vs-CLI menyediakan skrip pencopotan otomatis untuk membersihkan worker daemon, auto-start service, launcher CLI, entri PATH, dan direktori instalasi di semua OS.

### 🐧 Linux & 🍎 macOS (OS X)
```bash
# One-liner via cURL
curl -fsSL https://raw.githubusercontent.com/usmrip/tele-vs-cli/main/uninstall.sh | bash

# Atau dari repositori lokal
./uninstall.sh [--yes] [--purge] [--dry-run]
```

### 🪟 Windows (PowerShell / Command Prompt)
```powershell
# One-liner via PowerShell
irm https://raw.githubusercontent.com/usmrip/tele-vs-cli/main/uninstall.ps1 | iex

# Atau dari repositori lokal
.\uninstall.ps1 [-Yes] [-Purge] [-DryRun]
```
*(Atau klik ganda `uninstall.cmd` untuk pengguna Command Prompt/GUI)*

### 🌐 Universal Node.js / CLI (Semua OS)
```bash
tele uninstall [--yes] [--purge] [--dry-run]
# atau
npm run uninstall-cli -- --yes
```

---

### 2. Inisialisasi Proyek (`tele init`):
```bash
tele init
```
Wizard akan menanyakan:
- Server URL Dashboard (default: `https://biru.co.id/tele-vs-cli/`)
- Secret API Key
- Project ID / Project Key
- AI Agent pilihan (`auto`, `agy`, `claude`, `gemini`, `cline`)

### 3. Diagnostik Kesiapan Sistem (`tele doctor`):
```bash
tele doctor
```
Memeriksa status runtime Node.js, koneksi ke server, ketersediaan CLI Agent di PATH, dan izin direktori logs.

### 4. Cek Kuota & Status Model AI (`tele quota`):
```bash
tele quota
```
Memeriksa kuota aktif, model AI yang tersedia (Gemini 4 Argon, Gemini 3.8 Flash, Claude Sonnet 3.5, dll.), dan status background worker.

---

## 🛠️ Daftar Perintah CLI (`tele`)

| Perintah | Deskripsi |
|---|---|
| `tele doctor` | Diagnostik lingkungan, koneksi server, dan deteksi CLI Agent |
| `tele start [--daemon] [--verbose]` | Jalankan worker di foreground atau background (opsi `--verbose` untuk live progress) |
| `tele stop` | Hentikan worker daemon yang sedang berjalan |
| `tele restart` | Restart worker daemon |
| `tele logs [-f]` | Lihat atau pantau log worker secara live (*follow*) |
| `tele task "<instruksi>" [--verbose]` | Kirim tugas baru ke antrean dari terminal (opsi `--verbose` untuk live progress) |
| `tele quota [--json]` | Tampilkan status kuota, model AI, dan kesiapan agent aktif |
| `tele status [--json]` | Cek status worker, koneksi server, dan antrean tugas |
| `tele list` | Tampilkan daftar tugas di server |
| `tele cancel <id>` | Batalkan tugas tertentu |
| `tele kill <id>` | Hentikan paksa tugas aktif & tandai gagal (`/kill <task_id>`) |
| `tele retry <id>` | Jadwalkan ulang tugas yang gagal/batal |
| `tele projects` | Tampilkan daftar proyek di server |
| `tele use <id>` | Beralih proyek aktif lokal |
| `tele service install` | Pasang auto-start service (Windows Task Scheduler, Linux systemd, macOS launchd) |
| `tele service uninstall` | Hapus auto-start service |
| `tele uninstall [--purge]` | Copot Tele-vs-CLI dari sistem (daemon, service, launcher, dan PATH) |

---

## 🧪 Menjalankan Tes Unit

Seluruh pengujian unit dan integrasi berada di folder `test/`:
```bash
npm test
```

---

## 🛡️ Keamanan

- **Spawn Argumen Aman:** Seluruh perintah agent dieksekusi menggunakan array argumen (`child_process.spawn`), bukan string shell mentah, mencegah *command injection*.
- **Path Traversal Guard:** Pekerjaan hanya boleh berjalan di dalam direktori kerja proyek (`workDir`).
- **Dangerous Command Guard:** Perintah berbahaya seperti `reboot`, `rm -rf /`, fork bomb, atau `format` diblokir secara otomatis.
- **Masking Secrets:** Token bot Telegram, API secret key, dan bearer token disamarkan pada log dan output notifikasi.

---

## 📄 Lisensi
Didistribusikan di bawah lisensi MIT. Hak Cipta © 2026 Biru Indonesia Creative.
