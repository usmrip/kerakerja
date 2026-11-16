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

## 📦 Instalasi & Penggunaan Global

### 1. Masuk ke folder proyek dan pasang global:
```bash
cd tele-vs-cli
npm link
```
Setelah di-link, perintah `tele` langsung dapat diakses dari direktori mana pun di terminal Anda.

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

---

## 🛠️ Daftar Perintah CLI (`tele`)

| Perintah | Deskripsi |
|---|---|
| `tele doctor` | Diagnostik lingkungan, koneksi server, dan deteksi CLI Agent |
| `tele start [--daemon]` | Jalankan worker di foreground atau sebagai background daemon |
| `tele stop` | Hentikan worker daemon yang sedang berjalan |
| `tele restart` | Restart worker daemon |
| `tele logs [-f]` | Lihat atau pantau log worker secara live (*follow*) |
| `tele task "<instruksi>"` | Kirim tugas baru ke antrean dari terminal |
| `tele status [--json]` | Cek status worker, koneksi server, dan antrean tugas |
| `tele list` | Tampilkan daftar tugas di server |
| `tele cancel <id>` | Batalkan tugas tertentu |
| `tele retry <id>` | Jadwalkan ulang tugas yang gagal/batal |
| `tele projects` | Tampilkan daftar proyek di server |
| `tele use <id>` | Beralih proyek aktif lokal |
| `tele service install` | Pasang auto-start service (Windows Task Scheduler / Linux systemd) |
| `tele service uninstall` | Hapus auto-start service |

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
