const doctorCommand = require('./commands/doctor');
const startCommand = require('./commands/start');
const { stopCommand, restartCommand, logsCommand } = require('./commands/daemon_ctl');
const taskCommand = require('./commands/task');
const statusCommand = require('./commands/status');
const { listCommand, cancelCommand, retryCommand } = require('./commands/task_ctl');
const { projectsCommand, useCommand } = require('./commands/projects');
const initCommand = require('./commands/init');
const serviceCommand = require('./commands/service');

function printHelp() {
  console.log(`
Tele-vs-CLI — Headless Telegram & Remote AI Agent Runner (Zero VSIX)
Versi: 1.0.0

PENGGUNAAN:
  tele <perintah> [opsi]

PERINTAH UTAMA:
  init                      Setup interaktif (server URL, secret, project key, default agent)
  start [--daemon] [--once] Jalankan worker CLI (foreground / background)
  stop                      Hentikan background worker yang aktif
  restart                   Restart background worker
  logs [-f]                 Tampilkan atau pantau log worker secara live
  task "<instruksi>"        Kirim tugas baru ke antrean
                            Opsi: --agent <nama> --priority <HIGH|NORMAL>
  status [--json]           Cek status worker, koneksi server, dan antrean tugas
  list                      Tampilkan daftar tugas di server
  cancel <task_id>          Batalkan tugas tertentu
  retry <task_id>           Jadwalkan ulang tugas yang gagal/dibatalkan
  projects                  Lihat daftar proyek di server
  use <project_id>          Pilih proyek aktif lokal
  doctor                    Diagnostik lingkungan, koneksi, izin, dan CLI agent
  service install|uninstall Pasang autostart service (Windows Task Scheduler / Linux systemd)
  help, --help              Tampilkan bantuan ini

CONTOH:
  tele doctor
  tele start --daemon
  tele task "Buat endpoint API login JWT" --agent claude
  tele status
  tele logs -f
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
    case 'list':
      await listCommand(subArgs);
      break;
    case 'cancel':
      await cancelCommand(subArgs);
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
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      console.error(`❌ Perintah tidak dikenal: '${command}'`);
      console.log(`Ketik 'tele help' untuk daftar perintah lengkap.`);
      process.exit(1);
  }
}

module.exports = { main, printHelp };
