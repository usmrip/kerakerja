#!/usr/bin/env node

/**
 * Tele-vs-CLI Universal Cross-Platform Installer
 * Supports Linux, macOS (OS X), and Windows
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync } = require('child_process');
const {
  getAppInfo,
  checkForUpdates,
  applyAutoUpdate,
  getProjectSwitchGuideLines,
  testCommunication
} = require('../src/utils/app_info');
const { loadConfig } = require('../src/config/config');

function normalizeWinPathEntry(entry) {
  return String(entry || '').trim().replace(/[\\/]+$/, '').toLowerCase();
}

function addDirToWindowsPath(targetBinDir, execFn = execSync) {
  const rawCurrent = execFn(
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'User\')"',
    { encoding: 'utf-8', windowsHide: true }
  ).trim();

  const entries = rawCurrent
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);

  const normalizedTarget = normalizeWinPathEntry(targetBinDir);
  const alreadyExists = entries.some(e => normalizeWinPathEntry(e) === normalizedTarget);

  if (!alreadyExists) {
    entries.push(targetBinDir);
    const newPath = entries.join(';');
    execFn(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::SetEnvironmentVariable(\'Path\', $env:__TELE_NEW_PATH, \'User\')"',
      {
        encoding: 'utf-8',
        windowsHide: true,
        env: { ...process.env, __TELE_NEW_PATH: newPath }
      }
    );
    return { added: true, newPath };
  }
  return { added: false, newPath: entries.join(';') };
}

function askYesNo(question, defaultYes = true) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const suffix = defaultYes ? '[Y/n]' : '[y/N]';
    rl.question(`${question} ${suffix}: `, answer => {
      rl.close();
      const val = answer.trim().toLowerCase();
      if (!val) return resolve(defaultYes);
      resolve(val === 'y' || val === 'yes' || val === 'ya');
    });
  });
}

async function runInstaller() {
  const cliArgs = process.argv.slice(2);
  const rootDir = path.resolve(__dirname, '..');
  const appInfo = getAppInfo(rootDir);

  console.log('==============================================================================');
  console.log('🚀 Memulai Pemasangan Tele-vs-CLI (Linux / Windows / macOS)');
  console.log('==============================================================================');
  console.log(`📦 Versi Aplikasi    : v${appInfo.version}${appInfo.commitHash ? ` (${appInfo.commitHash})` : ''}`);
  console.log(`🕒 Terakhir Update   : ${appInfo.lastUpdateDate}`);
  console.log('');

  // 1. Periksa Versi Node.js
  const nodeVersion = process.versions.node;
  const majorVersion = parseInt(nodeVersion.split('.')[0], 10);
  console.log(`📌 Sistem Operasi    : ${process.platform} (${os.type()} ${os.arch()})`);
  console.log(`📌 Versi Node.js     : v${nodeVersion}`);

  if (majorVersion < 18) {
    console.error(`\n❌ Versi Node.js terlalu lama! Tele-vs-CLI memerlukan Node.js versi >= 18.0.0.`);
    process.exit(1);
  }

  // 2. Cek Pembaruan & Konfirmasi Auto-Update
  if (!cliArgs.includes('--skip-update-check')) {
    process.stdout.write('\n🔍 Memeriksa pembaruan terbaru dari GitHub... ');
    const updateStatus = checkForUpdates(rootDir);
    if (!updateStatus.checked) {
      console.log(`⚪ Dilewati (${updateStatus.reason === 'no-git' ? 'bukan repo git' : 'offline / remote tidak terjangkau'}).`);
    } else if (!updateStatus.updateAvailable) {
      console.log(`🟢 Sudah versi terbaru (${updateStatus.localCommit.substring(0, 7)}).`);
    } else {
      console.log(`📦 Pembaruan tersedia!`);
      for (const c of updateStatus.commits) {
        console.log(`   ✨ ${c}`);
      }

      let shouldUpdate = false;
      if (cliArgs.includes('--auto-update') || cliArgs.includes('--yes')) {
        shouldUpdate = true;
      } else if (process.stdin.isTTY && !cliArgs.includes('--no-update')) {
        shouldUpdate = await askYesNo('❓ Apakah Anda ingin melakukan auto-update sekarang?', true);
      } else {
        console.log(`💡 Jalankan 'tele update' nanti untuk memperbarui ke versi terbaru.`);
      }

      if (shouldUpdate) {
        console.log('⬇️ Menerapkan auto-update (git pull origin main)...');
        const res = applyAutoUpdate(rootDir);
        if (res.ok) {
          const refreshed = getAppInfo(rootDir);
          console.log(`✅ Berhasil diperbarui ke commit ${refreshed.commitHash || 'terbaru'} (${refreshed.lastUpdateDate}).`);
        } else {
          console.log(`⚠️ Auto-update gagal: ${res.error}. Melanjutkan instalasi dengan versi saat ini.`);
        }
      }
    }
  }

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

  // 3. Tentukan Direktori Launcher Berdasarkan Sistem Operasi
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    targetBinDir = path.join(localAppData, 'tele-vs-cli', 'bin');
    if (!fs.existsSync(targetBinDir)) {
      fs.mkdirSync(targetBinDir, { recursive: true });
    }

    launcherPath = path.join(targetBinDir, 'tele.cmd');
    const cmdContent = `@echo off\r\nnode "${binScript}" %*\r\n`;
    fs.writeFileSync(launcherPath, cmdContent, 'utf-8');

    // Buat juga bash shim (untuk Git Bash / MSYS2 / WSL)
    const bashShimPath = path.join(targetBinDir, 'tele');
    const bashContent = `#!/usr/bin/env bash\nexec node "${binScript.replace(/\\/g, '/')}" "$@"\n`;
    fs.writeFileSync(bashShimPath, bashContent, 'utf-8');

    // Hapus tele.ps1 lama agar PowerShell menjalankan tele.cmd (bebas blokir ExecutionPolicy Restricted)
    const legacyPs1Path = path.join(targetBinDir, 'tele.ps1');
    if (fs.existsSync(legacyPs1Path)) {
      try { fs.unlinkSync(legacyPs1Path); } catch (e) {}
    }

    // Periksa & tambahkan targetBinDir ke User PATH Windows secara aman
    try {
      const pathRes = addDirToWindowsPath(targetBinDir);
      if (pathRes.added) {
        console.log(`\n⚙️ Menambahkan '${targetBinDir}' ke PATH Pengguna Windows...`);
        console.log(`✅ PATH berhasil diperbarui.`);
      }
      if (!String(process.env.PATH || '').toLowerCase().includes(targetBinDir.toLowerCase())) {
        process.env.PATH = `${process.env.PATH};${targetBinDir}`;
      }
    } catch (e) {
      console.log(`⚠️ Silakan tambahkan direktori ini ke User PATH Anda secara manual: ${targetBinDir}`);
    }
  } else {
    // Linux & macOS (Darwin)
    const homeDir = os.homedir();
    const localBin = path.join(homeDir, '.local', 'bin');

    targetBinDir = localBin;
    if (!fs.existsSync(targetBinDir)) {
      fs.mkdirSync(targetBinDir, { recursive: true });
    }

    launcherPath = path.join(targetBinDir, 'tele');
    const shContent = `#!/usr/bin/env bash\nexec node "${binScript}" "$@"\n`;
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

  // 4. Jalankan Diagnostik Awal (tele doctor)
  console.log('\n🔎 Menjalankan diagnostik otomatis (tele doctor)...\n');
  try {
    execSync(`node "${binScript}" doctor`, { stdio: 'inherit' });
  } catch (e) {
    console.log(`(Diagnostik selesai)`);
  }

  // 5. Jika konfigurasi proyek sudah ada, lakukan test komunikasi Workstation <-> Dashboard <-> Telegram
  const existingConfig = loadConfig(process.cwd());
  let commResult = null;
  if (existingConfig.secret && existingConfig.projectId && existingConfig.projectId !== 'default' && !cliArgs.includes('--skip-comm-test')) {
    console.log('\n📡 Menguji komunikasi Workstation <-> Dashboard <-> Telegram...');
    commResult = await testCommunication(existingConfig);
    for (const msg of commResult.messages) {
      console.log(`   ${msg}`);
    }
  }

  console.log('\n==============================================================================');
  console.log('🎉 Pemasangan Tele-vs-CLI Berhasil!');
  console.log('==============================================================================');
  console.log('📌 PENTING — Daftarkan Proyek Terlebih Dahulu di Website:');
  console.log('   👉 Buka Dashboard Website (https://biru.co.id/tele-vs-cli/)');
  console.log('   👉 Daftarkan proyek Anda untuk mendapatkan Secret Key (AGENTS_TELE_SECRET) & Project ID.');
  console.log('');
  console.log('💡 Langkah Selanjutnya:');
  console.log('   1. Buka terminal baru atau muat ulang shell.');
  console.log('   2. Ketik: tele init           (Setup server URL, secret, project & test komunikasi)');
  console.log('   3. Ketik: tele start --daemon (Menjalankan background worker)');
  console.log('   4. Ketik: tele quota          (Melihat kuota & kesiapan model AI)');
  console.log('');
  for (const line of getProjectSwitchGuideLines(commResult ? commResult.projectTag : '')) {
    console.log(line);
  }
  console.log('==============================================================================\n');
}

if (require.main === module) {
  runInstaller().catch(err => {
    console.error(`\n❌ Terjadi kesalahan saat instalasi: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { runInstaller, addDirToWindowsPath, normalizeWinPathEntry };
