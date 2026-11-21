# 🤖 PANDUAN KERJA OTOMATIS AI AGENT (KeraKerja CLI)

## ⚡ 1. MANDATORY TRIGGER: EKSEKUSI OTOMATIS ANTREAN TUGAS (TASK_QUEUE.md)
Setiap kali Anda menerima giliran bicara, prompt, atau instruksi apapun dari USER di sesi CLI ini:

1. **LANGKAH 1 (PRIORITAS UTAMA - PERIKSA TASK_QUEUE.md):**
   - Periksa file `TASK_QUEUE.md` di root proyek.
   - Jika terdapat tugas berstatus `[PENDING]` atau `[IN_PROGRESS]` (terutama tugas masuk dari Telegram):
     👉 **ANDA WAJIB OTOMATIS MENGEKSEKUSI TUGAS TERSEBUT SAMPAI SELESAI 100%!**
     - Ubah status menjadi `[IN_PROGRESS]` saat mulai dikerjakan.
     - Kerjakan instruksinya dan uji verifikasi hingga tuntas.
     - Setelah selesai 100%, perbarui status tugas dan lanjutkan antrean berikutnya.
     - Selesaikan antrean berurutan satu per satu.

2. **LANGKAH 2 (PENCATATAN PERINTAH BARU):**
   - Jika antrean kosong/sudah selesai dan user memberikan perintah baru:
     `node bin/kerakerja.js task "<Perintah User>"` (atau `kerakerja task "<Perintah User>"`)
   - Kerjakan tugas hingga tuntas 100%, lalu verifikasi hasilnya.

3. **KATA KUNCI PEMICU INSTAN:**
   Jika user mengetik: `proses antrian`, `kerjakan queue`, `next task`, `/queue`, atau `lanjutkan`:
   👉 Langsung baca `TASK_QUEUE.md` (atau jalankan `node bin/kerakerja.js queue`) dan selesaikan tugas berikutnya tanpa menunggu konfirmasi!

## 📢 2. STATUS & KOMUNIKASI WORKER CLI
- Gunakan perintah CLI `node bin/kerakerja.js status` / `kerakerja queue` / `kerakerja logs -f` untuk memantau eksekusi worker.
- > ⚠️ **ATURAN MUTLAK:** JANGAN PERNAH melaporkan tugas `SELESAI` sebelum tugas benar-benar 100% tuntas dan teruji.


## 📨 ATURAN ROUTING PENGIRIMAN TELEGRAM (ANTI-DUPLIKAT)
- **Jika perintah/tugas berasal dari KeraKerja** (`kerakerja`, worker KeraKerja, atau `TASK_QUEUE.md` KeraKerja): pengiriman notifikasi & laporan Telegram **WAJIB hanya ke Telegram KeraKerja** (ditangani worker/API KeraKerja — **JANGAN** kirim ganda melalui script/bot `tele-vs-code`).
- **Jika perintah/tugas berasal dari `tele-vs-code`**: pengiriman notifikasi & laporan Telegram **WAJIB hanya ke bot Telegram yang dikonfigurasi di setting `tele-vs-code`** (**JANGAN** kirim ke bot Telegram KeraKerja).
