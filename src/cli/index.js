const doctorCommand = require('./commands/doctor');
const startCommand = require('./commands/start');
const { stopCommand, restartCommand, logsCommand } = require('./commands/daemon_ctl');
const taskCommand = require('./commands/task');
const statusCommand = require('./commands/status');
const quotaCommand = require('./commands/quota');
const usageCommand = require('./commands/usage');
const queueCommand = require('./commands/queue');
const updateCommand = require('./commands/update');
const { listCommand, cancelCommand, killCommand, retryCommand } = require('./commands/task_ctl');
const { projectsCommand, useCommand } = require('./commands/projects');
const initCommand = require('./commands/init');
const serviceCommand = require('./commands/service');
const { sampahCommand } = require('./commands/sampah');
const { snapshotCommand, restoreCommand } = require('./commands/snapshot');
const { infoCommand } = require('./commands/info');
const { whereCommand } = require('./commands/where');
const { sysinfoCommand } = require('./commands/sysinfo');
const { workersCommand } = require('./commands/workers');
const { runUninstall } = require('../../scripts/uninstall');

function printHelp() {
  console.log(`
KeraKerja — Headless Telegram & Remote AI Agent Runner (Zero VSIX)
Versi: 1.0.0

PENGGUNAAN:
  kerakerja <perintah> [opsi]

PERINTAH UTAMA:
  init                      Setup interaktif (server URL, secret, project key, default agent)
  start [--all] [--daemon] [--verbose] Jalankan worker CLI (1 proyek / --all semua proyek)
  stop [--all]              Hentikan background worker yang aktif
  restart [--all]           Restart background worker
  logs [--all] [-f]         Tampilkan atau pantau log worker secara live
  task "<instruksi>"        Kirim tugas baru ke antrean
                            Opsi: --agent <nama> --priority <HIGH|NORMAL> --verbose
  queue [--json] [--all]    Lihat rincian antrean tugas aktif (menunggu & dikerjakan)
  status [--json]           Cek status worker, koneksi server, dan antrean tugas
  usage [--json] [-w]       Pantau sisa kuota Antigravity AI (Gemini, Claude, GPT, Argon)
  quota [--json]            Tampilkan kuota, model AI, dan kesiapan agent aktif
  list                      Tampilkan daftar tugas di server
  cancel <task_id>          Batalkan tugas tertentu
  kill <task_id>            Hentikan paksa tugas aktif & tandai gagal (/kill)
  retry <task_id>           Jadwalkan ulang tugas yang gagal/dibatalkan
  projects                  Lihat daftar proyek di server
  use <project_id>          Pilih proyek aktif lokal
  doctor                    Diagnostik lingkungan, koneksi, izin, dan CLI agent
  service install [--all]|uninstall Pasang/hapus autostart service (Windows Task Scheduler / Linux systemd / macOS launchd)
  update [--check]          Perbarui KeraKerja ke versi terbaru dari GitHub
  info [--json]             Tampilkan informasi versi KeraKerja & waktu update terakhir
  where [--json]            Tampilkan direktori kerja aktif (workDir) & proyek aktif
  sampah [--dry-run]        Bersihkan sampah tele-vs-cli & kirim laporan tabel ke Telegram
  sysinfo [--json]          Info sistem mesin, worker aktif, CPU/RAM & total usage worker
  workers [--json] [--online] Lihat daftar worker terdaftar (server & lokal) beserta statusnya
  snapshot <kode> [param]   Buat snapshot (full, db, kode, upload, db,kode) ke ../snapshot-kerakerja
  restore [<kode_lengkap>]  Restore snapshot (atau tampilkan 4 snapshot terakhir)
  uninstall, --uninstall    Copot KeraKerja dari sistem & seluruh workspace terdaftar
  help, --help              Tampilkan bantuan ini

CONTOH:
  kerakerja doctor
  kerakerja start --daemon --verbose
  kerakerja task "Buat endpoint API login JWT" --agent agy --verbose
  kerakerja quota
  kerakerja status
  kerakerja logs -f
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'help').toLowerCase();
  const subArgs = args.slice(1);

  switch (command) {
    case 'init':
      await initCommand(subArgs);
      break;
    case 'start':
      await startCommand(subArgs);
      break;
    case 'stop':
      await stopCommand(subArgs);
      break;
    case 'restart':
      await restartCommand(subArgs);
      break;
    case 'logs':
      await logsCommand(subArgs);
      break;
    case 'task':
      await taskCommand(subArgs);
      break;
    case 'status':
      await statusCommand(subArgs);
      break;
    case 'queue':
    case 'q':
    case 'antrean':
    case 'antrian':
      await queueCommand(subArgs);
      break;
    case 'usage':
    case 'agy-usage':
    case 'pemakaian':
      await usageCommand(subArgs);
      break;
    case 'quota':
    case 'kuota':
      await quotaCommand(subArgs);
      break;
    case 'update':
    case '/update':
    case 'upgrade':
    case '/upgrade':
      await updateCommand(subArgs);
      break;
    case 'info':
    case '/info':
      await infoCommand(subArgs);
      break;
    case 'where':
    case '/where':
      await whereCommand(subArgs);
      break;
    case 'list':
      await listCommand(subArgs);
      break;
    case 'cancel':
      await cancelCommand(subArgs);
      break;
    case 'kill':
    case '/kill':
      await killCommand(subArgs);
      break;
    case 'retry':
      await retryCommand(subArgs);
      break;
    case 'projects':
      await projectsCommand(subArgs);
      break;
    case 'use':
      await useCommand(subArgs);
      break;
    case 'doctor':
      await doctorCommand(subArgs);
      break;
    case 'service':
      await serviceCommand(subArgs);
      break;
    case 'sampah':
    case '/sampah':
      await sampahCommand(subArgs);
      break;
    case 'sysinfo':
    case '/sysinfo':
      await sysinfoCommand(subArgs);
      break;
    case 'workers':
    case '/workers':
      await workersCommand(subArgs);
      break;
    case 'snapshot':
    case '/snapshot':
      await snapshotCommand(subArgs);
      break;
    case 'restore':
    case '/restore':
      await restoreCommand(subArgs);
      break;
    case 'uninstall':
    case '--uninstall': {
      const res = await runUninstall(subArgs);
      if (res && res.exitCode) process.exit(res.exitCode);
      break;
    }
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.error(`❌ Perintah tidak dikenal: '${command}'`);
      console.log(`Ketik 'kerakerja help' untuk daftar perintah lengkap.`);
      process.exit(1);
  }
}

module.exports = { main, printHelp };
