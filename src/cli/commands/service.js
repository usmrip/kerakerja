const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function serviceCommand(args) {
  const action = (args[0] || '').toLowerCase();
  const cwd = process.cwd();
  const nodeBin = process.execPath;
  const scriptPath = path.join(__dirname, '..', '..', '..', 'bin', 'tele.js');
  const serviceName = 'TeleVsCliWorker';

  if (action === 'install') {
    console.log(`Mengonfigurasi auto-start background service '${serviceName}'...`);
    if (process.platform === 'win32') {
      try {
        const cmd = `schtasks /create /tn "${serviceName}" /tr "\"${nodeBin}\" \"${scriptPath}\" start --daemon" /sc onlogon /f`;
        execSync(cmd, { stdio: 'inherit' });
        console.log(`✅ Layanan Windows Task Scheduler '${serviceName}' berhasil dipasang (aktif saat login).`);
      } catch (e) {
        console.error(`❌ Gagal memasang task scheduler: ${e.message}`);
      }
    } else if (process.platform === 'linux') {
      const userSystemdDir = path.join(process.env.HOME || '~', '.config', 'systemd', 'user');
      if (!fs.existsSync(userSystemdDir)) fs.mkdirSync(userSystemdDir, { recursive: true });
      const unitPath = path.join(userSystemdDir, 'tele-vs-cli.service');
      const unitContent = `[Unit]
Description=Tele-vs-CLI Headless Worker
After=network.target

[Service]
Type=simple
WorkingDirectory=${cwd}
ExecStart=${nodeBin} ${scriptPath} start
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
      fs.writeFileSync(unitPath, unitContent, 'utf-8');
      try {
        execSync('systemctl --user daemon-reload && systemctl --user enable tele-vs-cli && systemctl --user start tele-vs-cli', { stdio: 'inherit' });
        console.log(`✅ Layanan systemd user service 'tele-vs-cli' berhasil dipasang dan dijalankan.`);
      } catch (e) {
        console.log(`⚠️ Unit file tersimpan di ${unitPath}. Jalankan manual: systemctl --user start tele-vs-cli`);
      }
    } else {
      console.log('Sistem operasi saat ini belum didukung untuk auto-service.');
    }
  } else if (action === 'uninstall') {
    console.log(`Menghapus background service '${serviceName}'...`);
    if (process.platform === 'win32') {
      try {
        execSync(`schtasks /delete /tn "${serviceName}" /f`, { stdio: 'inherit' });
        console.log(`✅ Layanan '${serviceName}' berhasil dihapus.`);
      } catch (e) {
        console.error(`❌ Gagal menghapus service: ${e.message}`);
      }
    } else if (process.platform === 'linux') {
      try {
        execSync('systemctl --user stop tele-vs-cli && systemctl --user disable tele-vs-cli', { stdio: 'inherit' });
        console.log(`✅ Layanan systemd 'tele-vs-cli' berhasil dicopot.`);
      } catch (e) {}
    }
  } else {
    console.log('Penggunaan: tele service install | tele service uninstall');
  }
}

module.exports = serviceCommand;
