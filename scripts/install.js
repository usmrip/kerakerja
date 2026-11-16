#!/usr/bin/env node

/**
 * Tele-vs-CLI Universal Cross-Platform Installer
 * Supports Linux, macOS (OS X), and Windows
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

console.log('==============================================================================');
console.log('🚀 Memulai Pemasangan Tele-vs-CLI (Linux / Windows / macOS)');
console.log('==============================================================================\n');

// 1. Periksa Versi Node.js
const nodeVersion = process.versions.node;
const majorVersion = parseInt(nodeVersion.split('.')[0], 10);
console.log(`📌 Terdeteksi Sistem Operasi : ${process.platform} (${os.type()} ${os.arch()})`);
console.log(`📌 Terdeteksi Versi Node.js   : v${nodeVersion}`);

if (majorVersion < 18) {
  console.error(`\n❌ Versi Node.js terlalu lama! Tele-vs-CLI memerlukan Node.js versi >= 18.0.0.`);
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const binScript = path.join(rootDir, 'bin', 'tele.js');

if (!fs.existsSync(binScript)) {
  console.error(`\n❌ File eksekusi utama tidak ditemukan: ${binScript}`);
  process.exit(1);
}

// Pastikan bin/tele.js memiliki izin eksekusi di Unix
if (process.platform !== 'win32') {
  try {
    fs.chmodSync(binScript, 0o755);
  } catch (e) {}
}

let targetBinDir = '';
let launcherPath = '';

// 2. Tentukan Direktori Launcher Berdasarkan Sistem Operasi
if (process.platform === 'win32') {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  targetBinDir = path.join(localAppData, 'tele-vs-cli', 'bin');
  if (!fs.existsSync(targetBinDir)) {
    fs.mkdirSync(targetBinDir, { recursive: true });
  }

  launcherPath = path.join(targetBinDir, 'tele.cmd');
  const cmdContent = `@echo off\r\nnode "${binScript}" %*\r\n`;
  fs.writeFileSync(launcherPath, cmdContent, 'utf-8');

  // Buat juga tele.ps1 untuk PowerShell
  const ps1Path = path.join(targetBinDir, 'tele.ps1');
  const ps1Content = `& node "${binScript}" @args\r\n`;
  fs.writeFileSync(ps1Path, ps1Content, 'utf-8');

  // Periksa apakah targetBinDir sudah ada di User PATH
  try {
    const currentPath = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'User\')"', { encoding: 'utf-8' }).trim();
    if (!currentPath.toLowerCase().includes(targetBinDir.toLowerCase())) {
      console.log(`\n⚙️ Menambahkan '${targetBinDir}' ke PATH Pengguna Windows...`);
      const newPath = currentPath ? `${currentPath};${targetBinDir}` : targetBinDir;
      execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path', '${newPath.replace(/'/g, "''")}', 'User')"`);
      process.env.PATH = `${process.env.PATH};${targetBinDir}`;
      console.log(`✅ PATH berhasil diperbarui.`);
    }
  } catch (e) {
    console.log(`⚠️ Silakan tambahkan direktori ini ke User PATH Anda secara manual: ${targetBinDir}`);
  }

} else {
  // Linux & macOS (Darwin)
  const homeDir = os.homedir();
  const localBin = path.join(homeDir, '.local', 'bin');
  
  // Utamakan ~/.local/bin agar tidak perlu sudo/root
  targetBinDir = localBin;
  if (!fs.existsSync(targetBinDir)) {
    fs.mkdirSync(targetBinDir, { recursive: true });
  }

  launcherPath = path.join(targetBinDir, 'tele');
  const shContent = `#!/usr/bin/env bash
exec node "${binScript}" "$@"
`;
  fs.writeFileSync(launcherPath, shContent, 'utf-8');
  try {
    fs.chmodSync(launcherPath, 0o755);
  } catch (e) {}

  // Cek apakah targetBinDir sudah ada di PATH
  const currentPathEnv = process.env.PATH || '';
  if (!currentPathEnv.includes(targetBinDir)) {
    console.log(`\n⚙️ Menambahkan '${targetBinDir}' ke profil shell...`);
    const shellConfigs = ['.bashrc', '.zshrc', '.profile'];
    for (const conf of shellConfigs) {
      const p = path.join(homeDir, conf);
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf-8');
          if (!content.includes(targetBinDir)) {
            fs.appendFileSync(p, `\nexport PATH="$HOME/.local/bin:$PATH"\n`);
            console.log(`   + Ditambahkan ke ~/${conf}`);
          }
        } catch (e) {}
      }
    }
  }
}

console.log(`\n✅ Launcher CLI berhasil dipasang di:`);
console.log(`   👉 ${launcherPath}`);

// 3. Jalankan Diagnostik Awal (tele doctor)
console.log('\n🔎 Menjalankan diagnostik otomatis (tele doctor)...\n');
try {
  execSync(`node "${binScript}" doctor`, { stdio: 'inherit' });
} catch (e) {
  console.log(`(Diagnostik selesai)`);
}

console.log('\n==============================================================================');
console.log('🎉 Pemasangan Tele-vs-CLI Berhasil!');
console.log('==============================================================================');
console.log('💡 Langkah Selanjutnya:');
console.log('   1. Buka terminal baru atau muat ulang shell.');
console.log('   2. Ketik: tele --help        (Melihat daftar perintah)');
console.log('   3. Ketik: tele init          (Setup interaktif URL server & project key)');
console.log('   4. Ketik: tele start --daemon (Menjalankan background worker)');
console.log('   5. Ketik: tele quota         (Melihat kuota & kesiapan model AI)');
console.log('==============================================================================\n');
