const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function serviceCommand(args = []) {
  const action = (args[0] || '').toLowerCase();
  const isAll = args.includes('--all') || args.includes('-a');
  const cwd = process.cwd();
  const nodeBin = process.execPath;
  const scriptPath = path.join(__dirname, '..', '..', '..', 'bin', 'tele.js');
  const serviceName = 'TeleVsCliWorker';
  const startFlags = isAll ? 'start --all' : 'start';

  if (action === 'install') {
    console.log(`Mengonfigurasi auto-start background service '${serviceName}'${isAll ? ' (Multi-Project --all)' : ''}...`);
    if (process.platform === 'win32') {
      try {
        const cmd = `schtasks /create /tn "${serviceName}" /tr "\"${nodeBin}\" \"${scriptPath}\" ${startFlags} --daemon" /sc onlogon /f`;
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
ExecStart=${nodeBin} ${scriptPath} ${startFlags}
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
    } else if (process.platform === 'darwin') {
      const launchAgentsDir = path.join(process.env.HOME || '~', 'Library', 'LaunchAgents');
      if (!fs.existsSync(launchAgentsDir)) fs.mkdirSync(launchAgentsDir, { recursive: true });
      const plistPath = path.join(launchAgentsDir, 'com.usmrip.tele-vs-cli.plist');
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.usmrip.tele-vs-cli</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeBin}</string>
        <string>${scriptPath}</string>
        <string>start</string>${isAll ? '\n        <string>--all</string>' : ''}
    </array>
    <key>WorkingDirectory</key>
    <string>${cwd}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${path.join(cwd, 'logs', 'worker.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(cwd, 'logs', 'worker.log')}</string>
</dict>
</plist>
`;
      fs.writeFileSync(plistPath, plistContent, 'utf-8');
      try {
        execSync(`launchctl unload "${plistPath}" 2>/dev/null; launchctl load "${plistPath}"`, { stdio: 'inherit' });
        console.log(`✅ Layanan macOS launchd 'com.usmrip.tele-vs-cli' berhasil dipasang dan diaktifkan.`);
      } catch (e) {
        console.log(`⚠️ Plist tersimpan di ${plistPath}. Jalankan manual: launchctl load "${plistPath}"`);
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
    } else if (process.platform === 'darwin') {
      const plistPath = path.join(process.env.HOME || '~', 'Library', 'LaunchAgents', 'com.usmrip.tele-vs-cli.plist');
      try {
        execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'inherit' });
        if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
        console.log(`✅ Layanan macOS launchd 'com.usmrip.tele-vs-cli' berhasil dicopot.`);
      } catch (e) {}
    }
  } else {
    console.log('Penggunaan: tele service install | tele service uninstall');
  }
}

module.exports = serviceCommand;
