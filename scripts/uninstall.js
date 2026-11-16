#!/usr/bin/env node

/**
 * Tele-vs-CLI Universal Cross-Platform Uninstaller
 * Supports Linux, macOS (OS X), and Windows
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync } = require('child_process');

/**
 * Mem-parsing argumen CLI untuk uninstaller.
 * @param {string[]} argv
 */
function parseUninstallArgs(argv = []) {
  const flags = new Set(argv.map((a) => String(a).trim()));
  return {
    yes: flags.has('--yes') || flags.has('-y'),
    purge: flags.has('--purge') || flags.has('--all'),
    dryRun: flags.has('--dry-run'),
    help: flags.has('--help') || flags.has('-h')
  };
}

/**
 * Menghapus targetDir dari string PATH Windows secara aman (case-insensitive).
 * @param {string} currentPath
 * @param {string} targetDir
 * @returns {{ changed: boolean, newPath: string }}
 */
function removeDirFromWindowsPath(currentPath, targetDir) {
  if (!currentPath || !targetDir) {
    return { changed: false, newPath: currentPath || '' };
  }
  const normalizedTarget = path.normalize(targetDir).replace(/[\\\/]+$/, '').toLowerCase();
  const parts = currentPath.split(';').filter((p) => p.trim() !== '');
  const filtered = parts.filter((entry) => {
    const normalizedEntry = path.normalize(entry.trim()).replace(/[\\\/]+$/, '').toLowerCase();
    return normalizedEntry !== normalizedTarget;
  });
  return {
    changed: filtered.length !== parts.length,
    newPath: filtered.join(';')
  };
}

/**
 * Mengembalikan path instalasi standar berdasarkan platform.
 * @param {NodeJS.Platform} platform
 * @param {string} homeDir
 * @param {string} localAppData
 */
function getInstallPaths(platform = process.platform, homeDir = os.homedir(), localAppData = process.env.LOCALAPPDATA) {
  if (platform === 'win32') {
    const baseAppData = localAppData || path.join(homeDir, 'AppData', 'Local');
    const baseDir = path.join(baseAppData, 'tele-vs-cli');
    return {
      baseDir,
      appDir: path.join(baseDir, 'app'),
      binDir: path.join(baseDir, 'bin'),
      launchers: [
        path.join(baseDir, 'bin', 'tele.cmd'),
        path.join(baseDir, 'bin', 'tele.ps1')
      ],
      serviceName: 'TeleVsCliWorker'
    };
  }

  return {
    baseDir: path.join(homeDir, '.tele-vs-cli'),
    appDir: path.join(homeDir, '.tele-vs-cli'),
    binDir: path.join(homeDir, '.local', 'bin'),
    launchers: [path.join(homeDir, '.local', 'bin', 'tele')],
    systemdUnit: path.join(homeDir, '.config', 'systemd', 'user', 'tele-vs-cli.service'),
    launchdPlist: path.join(homeDir, 'Library', 'LaunchAgents', 'com.usmrip.tele-vs-cli.plist')
  };
}

function printUsage() {
  console.log(`
Tele-vs-CLI Universal Uninstaller (Linux / macOS / Windows)

Penggunaan:
  node scripts/uninstall.js [opsi]

Opsi:
  --yes, -y     Lanjutkan tanpa konfirmasi interaktif
  --purge       Hapus juga konfigurasi lokal (tele.config.json, logs/, PID)
  --dry-run     Tampilkan simulasi penghapusan tanpa mengubah sistem
  --help, -h    Tampilkan bantuan ini
`);
}

function askConfirmation(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(question, (answer) => {
      rl.close();
      const normalized = (answer || '').trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes' || normalized === 'ya');
    });
  });
}

function safeUnlink(filePath, dryRun, summary) {
  if (!fs.existsSync(filePath)) return false;
  if (dryRun) {
    console.log(`   [dry-run] Akan menghapus file: ${filePath}`);
    summary.push(`(dry-run) Hapus file ${filePath}`);
    return true;
  }
  try {
    fs.unlinkSync(filePath);
    console.log(`   ✅ Dihapus: ${filePath}`);
    summary.push(`Hapus file ${filePath}`);
    return true;
  } catch (e) {
    console.log(`   ⚠️ Gagal menghapus ${filePath}: ${e.message}`);
    return false;
  }
}

function safeRmDir(dirPath, dryRun, summary) {
  if (!fs.existsSync(dirPath)) return false;
  if (dryRun) {
    console.log(`   [dry-run] Akan menghapus direktori: ${dirPath}`);
    summary.push(`(dry-run) Hapus direktori ${dirPath}`);
    return true;
  }
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log(`   ✅ Direktori dihapus: ${dirPath}`);
    summary.push(`Hapus direktori ${dirPath}`);
    return true;
  } catch (e) {
    console.log(`   ⚠️ Gagal menghapus direktori ${dirPath}: ${e.message}`);
    return false;
  }
}

function stopWorkerDaemon(dirs, dryRun, summary) {
  const checked = new Set();
  for (const dir of dirs) {
    if (!dir || checked.has(dir)) continue;
    checked.add(dir);
    const pidPath = path.join(dir, 'tele-worker.pid');
    if (!fs.existsSync(pidPath)) continue;

    const raw = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    if (!Number.isNaN(pid) && pid > 0) {
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (e) {
        alive = false;
      }

      if (alive) {
        if (dryRun) {
          console.log(`   [dry-run] Akan menghentikan worker PID ${pid}`);
          summary.push(`(dry-run) Hentikan worker PID ${pid}`);
        } else {
          try {
            if (process.platform === 'win32') {
              execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
            } else {
              process.kill(pid, 'SIGTERM');
            }
            console.log(`   ✅ Worker daemon (PID ${pid}) dihentikan.`);
            summary.push(`Hentikan worker PID ${pid}`);
          } catch (e) {
            console.log(`   ⚠️ Gagal menghentikan worker PID ${pid}: ${e.message}`);
          }
        }
      }
    }
    safeUnlink(pidPath, dryRun, summary);
  }
}

function removeAutoService(paths, dryRun, summary) {
  if (process.platform === 'win32') {
    try {
      execSync(`schtasks /query /tn "${paths.serviceName}"`, { stdio: 'ignore' });
      if (dryRun) {
        console.log(`   [dry-run] Akan menghapus Windows Task Scheduler: ${paths.serviceName}`);
        summary.push(`(dry-run) Hapus service ${paths.serviceName}`);
      } else {
        execSync(`schtasks /delete /tn "${paths.serviceName}" /f`, { stdio: 'ignore' });
        console.log(`   ✅ Windows Task Scheduler '${paths.serviceName}' dihapus.`);
        summary.push(`Hapus service ${paths.serviceName}`);
      }
    } catch (e) {
      // Task tidak terpasang
    }
    return;
  }

  if (process.platform === 'linux' && paths.systemdUnit) {
    if (fs.existsSync(paths.systemdUnit)) {
      if (dryRun) {
        console.log(`   [dry-run] Akan menonaktifkan & menghapus systemd unit: ${paths.systemdUnit}`);
        summary.push('(dry-run) Hapus systemd service tele-vs-cli');
      } else {
        try {
          execSync('systemctl --user stop tele-vs-cli', { stdio: 'ignore' });
        } catch (e) {}
        try {
          execSync('systemctl --user disable tele-vs-cli', { stdio: 'ignore' });
        } catch (e) {}
        safeUnlink(paths.systemdUnit, false, summary);
        try {
          execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
        } catch (e) {}
        console.log('   ✅ Layanan systemd user service tele-vs-cli dihapus.');
      }
    }
    return;
  }

  if (process.platform === 'darwin' && paths.launchdPlist) {
    if (fs.existsSync(paths.launchdPlist)) {
      if (dryRun) {
        console.log(`   [dry-run] Akan unload & menghapus launchd plist: ${paths.launchdPlist}`);
        summary.push('(dry-run) Hapus launchd service com.usmrip.tele-vs-cli');
      } else {
        try {
          execSync(`launchctl unload "${paths.launchdPlist}"`, { stdio: 'ignore' });
        } catch (e) {}
        safeUnlink(paths.launchdPlist, false, summary);
        console.log('   ✅ Layanan macOS launchd com.usmrip.tele-vs-cli dihapus.');
      }
    }
  }
}

function removeLaunchersAndPath(paths, dryRun, summary) {
  for (const launcher of paths.launchers) {
    safeUnlink(launcher, dryRun, summary);
  }

  if (process.platform === 'win32') {
    if (fs.existsSync(paths.binDir)) {
      try {
        const remaining = fs.readdirSync(paths.binDir);
        if (remaining.length === 0) {
          safeRmDir(paths.binDir, dryRun, summary);
        }
      } catch (e) {}
    }

    try {
      const currentPath = execSync(
        'powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'User\')"',
        { encoding: 'utf-8' }
      ).trim();
      const { changed, newPath } = removeDirFromWindowsPath(currentPath, paths.binDir);
      if (changed) {
        if (dryRun) {
          console.log(`   [dry-run] Akan menghapus '${paths.binDir}' dari User PATH Windows.`);
          summary.push(`(dry-run) Hapus ${paths.binDir} dari User PATH`);
        } else {
          const escaped = newPath.replace(/'/g, "''");
          execSync(
            `powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path', '${escaped}', 'User')"`
          );
          console.log(`   ✅ '${paths.binDir}' dihapus dari User PATH Windows.`);
          summary.push(`Hapus ${paths.binDir} dari User PATH`);
        }
      }
    } catch (e) {
      console.log(`   ⚠️ Tidak dapat memperbarui User PATH otomatis: ${e.message}`);
    }
  }
}

async function runUninstall(argv = process.argv.slice(2)) {
  const opts = parseUninstallArgs(argv);
  if (opts.help) {
    printUsage();
    return { exitCode: 0, aborted: false };
  }

  console.log('==============================================================================');
  console.log('🧹 Tele-vs-CLI Universal Uninstaller (Linux / Windows / macOS)');
  console.log('==============================================================================\n');
  console.log(`📌 Sistem Operasi : ${process.platform} (${os.type()} ${os.arch()})`);
  if (opts.dryRun) {
    console.log('📌 Mode           : DRY-RUN (tidak ada perubahan permanen)');
  }

  if (!opts.yes && !opts.dryRun && process.stdin.isTTY) {
    const confirmed = await askConfirmation('\nApakah Anda yakin ingin mencopot Tele-vs-CLI dari sistem ini? (y/N): ');
    if (!confirmed) {
      console.log('❌ Pencopotan dibatalkan.');
      return { exitCode: 0, aborted: true };
    }
  }

  const rootDir = path.resolve(__dirname, '..');
  const paths = getInstallPaths(process.platform);
  const summary = [];

  console.log('\n1️⃣  Menghentikan background worker...');
  stopWorkerDaemon([rootDir, process.cwd(), paths.appDir], opts.dryRun, summary);

  console.log('\n2️⃣  Memeriksa & menghapus auto-start service...');
  removeAutoService(paths, opts.dryRun, summary);

  console.log('\n3️⃣  Menghapus launcher CLI & entri PATH...');
  removeLaunchersAndPath(paths, opts.dryRun, summary);

  console.log('\n4️⃣  Membersihkan direktori instalasi...');
  const normalizedRoot = path.normalize(rootDir).toLowerCase();
  const normalizedApp = path.normalize(paths.appDir).toLowerCase();

  // Hapus direktori instalasi remote (~/.tele-vs-cli atau %LOCALAPPDATA%\tele-vs-cli\app)
  // Jika skrip dijalankan dari dalam appDir pada Windows, pindah cwd dulu agar tidak terkunci.
  if (fs.existsSync(paths.appDir)) {
    if (normalizedRoot === normalizedApp && process.platform === 'win32') {
      try {
        process.chdir(os.tmpdir());
      } catch (e) {}
    }
    safeRmDir(paths.appDir, opts.dryRun, summary);
  }

  if (process.platform === 'win32' && fs.existsSync(paths.baseDir)) {
    if (opts.purge) {
      safeRmDir(paths.baseDir, opts.dryRun, summary);
    } else {
      try {
        if (fs.readdirSync(paths.baseDir).length === 0) {
          safeRmDir(paths.baseDir, opts.dryRun, summary);
        }
      } catch (e) {}
    }
  }

  // Jika --purge pada repositori lokal, hapus file runtime lokal (tanpa menghapus source code)
  if (opts.purge && normalizedRoot !== normalizedApp) {
    safeUnlink(path.join(rootDir, 'tele.config.json'), opts.dryRun, summary);
    safeUnlink(path.join(rootDir, 'tele-worker.pid'), opts.dryRun, summary);
    safeRmDir(path.join(rootDir, 'logs'), opts.dryRun, summary);
  }

  console.log('\n==============================================================================');
  if (opts.dryRun) {
    console.log('🔍 Simulasi Uninstall Selesai (Dry-Run)');
  } else {
    console.log('✅ Tele-vs-CLI Berhasil Dicopot!');
  }
  console.log('==============================================================================');
  if (summary.length === 0) {
    console.log('ℹ️ Tidak ada komponen terpasang yang perlu dihapus.');
  } else {
    console.log(`📋 Total aksi: ${summary.length}`);
  }
  if (process.platform === 'win32' && !opts.dryRun) {
    console.log('💡 Tutup dan buka ulang terminal agar perubahan PATH berlaku penuh.');
  }
  console.log('');

  return { exitCode: 0, aborted: false, summary };
}

if (require.main === module) {
  runUninstall().catch((err) => {
    console.error(`\n❌ Terjadi kesalahan saat uninstall: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseUninstallArgs,
  removeDirFromWindowsPath,
  getInstallPaths,
  runUninstall
};
