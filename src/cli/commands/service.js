const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function getWindowsHiddenVbsPath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'kerakerja', 'bin', 'start-hidden.vbs');
}

async function serviceCommand(args = []) {
  const action = (args[0] || '').toLowerCase();
  const isAll = args.includes('--all') || args.includes('-a');
  const cwd = process.cwd();
  const nodeBin = process.execPath;
  const scriptPath = path.join(__dirname, '..', '..', '..', 'bin', 'kerakerja.js');
  const serviceName = 'KeraKerjaWorker';
  const startFlags = isAll ? 'start --all' : 'start';

  if (action === 'install') {
    console.log(`Mengonfigurasi auto-start background service '${serviceName}'${isAll ? ' (Multi-Project --all)' : ''}...`);
    if (process.platform === 'win32') {
      try {
        // Bersihkan service lama jika masih ada
        try { execSync('schtasks /delete /tn "TeleVsCliWorker" /f', { stdio: 'ignore', windowsHide: true }); } catch (e) {}

        const vbsPath = getWindowsHiddenVbsPath();
        const vbsDir = path.dirname(vbsPath);
        if (!fs.existsSync(vbsDir)) fs.mkdirSync(vbsDir, { recursive: true });
        const targetCmd = `""${nodeBin}"" ""${scriptPath}"" ${startFlags} --daemon`;
        const vbsContent = `Set shell = CreateObject("WScript.Shell")\r\nshell.Run "${targetCmd}", 0, False\r\n`;
        fs.writeFileSync(vbsPath, vbsContent, 'utf-8');

        const cmd = `schtasks /create /tn "${serviceName}" /tr "wscript.exe \\"${vbsPath}\\"" /sc onlogon /f`;
        execSync(cmd, { stdio: 'inherit', windowsHide: true });
        console.log(`✅ Layanan Windows Task Scheduler '${serviceName}' berhasil dipasang (mode tersembunyi tanpa popup).`);
      } catch (e) {
        console.error(`❌ Gagal memasang task scheduler: ${e.message}`);
      }
    } else if (process.platform === 'linux') {
      const userSystemdDir = path.join(process.env.HOME || '~', '.config', 'systemd', 'user');
      if (!fs.existsSync(userSystemdDir)) fs.mkdirSync(userSystemdDir, { recursive: true });
      const unitPath = path.join(userSystemdDir, 'kerakerja.service');
      const unitContent = `[Unit]
Description=KeraKerja Headless Worker
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
        execSync('systemctl --user stop tele-vs-cli 2>/dev/null; systemctl --user disable tele-vs-cli 2>/dev/null; rm -f "$HOME/.config/systemd/user/tele-vs-cli.service"', { stdio: 'ignore' });
      } catch (e) {}
      try {
        execSync('systemctl --user daemon-reload && systemctl --user enable kerakerja && systemctl --user start kerakerja', { stdio: 'inherit' });
        console.log(`✅ Layanan systemd user service 'kerakerja' berhasil dipasang dan dijalankan.`);
      } catch (e) {
        console.log(`⚠️ Unit file tersimpan di ${unitPath}. Jalankan manual: systemctl --user start kerakerja`);
      }
    } else if (process.platform === 'darwin') {
      const launchAgentsDir = path.join(process.env.HOME || '~', 'Library', 'LaunchAgents');
      if (!fs.existsSync(launchAgentsDir)) fs.mkdirSync(launchAgentsDir, { recursive: true });
      const plistPath = path.join(launchAgentsDir, 'com.usmrip.kerakerja.plist');
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.usmrip.kerakerja</string>
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
        const legacyPlist = path.join(launchAgentsDir, 'com.usmrip.tele-vs-cli.plist');
        if (fs.existsSync(legacyPlist)) {
          try { execSync(`launchctl unload "${legacyPlist}" 2>/dev/null`, { stdio: 'ignore' }); } catch (e) {}
          fs.unlinkSync(legacyPlist);
        }
        execSync(`launchctl unload "${plistPath}" 2>/dev/null; launchctl load "${plistPath}"`, { stdio: 'inherit' });
        console.log(`✅ Layanan macOS launchd 'com.usmrip.kerakerja' berhasil dipasang dan diaktifkan.`);
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
        execSync(`schtasks /delete /tn "${serviceName}" /f`, { stdio: 'inherit', windowsHide: true });
        const vbsPath = getWindowsHiddenVbsPath();
        if (fs.existsSync(vbsPath)) fs.unlinkSync(vbsPath);
        console.log(`✅ Layanan '${serviceName}' berhasil dihapus.`);
      } catch (e) {
        console.error(`❌ Gagal menghapus service: ${e.message}`);
      }
      try { execSync('schtasks /delete /tn "TeleVsCliWorker" /f', { stdio: 'ignore', windowsHide: true }); } catch (e) {}
    } else if (process.platform === 'linux') {
      try {
        execSync('systemctl --user stop kerakerja && systemctl --user disable kerakerja', { stdio: 'inherit' });
        console.log(`✅ Layanan systemd 'kerakerja' berhasil dicopot.`);
      } catch (e) {}
    } else if (process.platform === 'darwin') {
      const plistPath = path.join(process.env.HOME || '~', 'Library', 'LaunchAgents', 'com.usmrip.kerakerja.plist');
      try {
        execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'inherit' });
        if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
        console.log(`✅ Layanan macOS launchd 'com.usmrip.kerakerja' berhasil dicopot.`);
      } catch (e) {}
    }
  } else {
    console.log('Penggunaan: kerakerja service install | kerakerja service uninstall');
  }
}

module.exports = serviceCommand;
