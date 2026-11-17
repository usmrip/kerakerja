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
const { loadWorkspaces, getGlobalDir, getGlobalWorkspacesPath } = require('../src/config/workspaces');

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
    const baseDir = path.join(baseAppData, 'kerakerja');
    return {
      baseDir,
      appDir: path.join(baseDir, 'app'),
      binDir: path.join(baseDir, 'bin'),
      launchers: [
        path.join(baseDir, 'bin', 'kerakerja.cmd'),
        path.join(baseDir, 'bin', 'kerakerja.ps1'),
        path.join(baseDir, 'bin', 'kerakerja'),
        path.join(baseDir, 'bin', 'start-hidden.vbs')
      ],
      serviceName: 'KeraKerjaWorker',
      legacyBaseDir: path.join(baseAppData, 'tele-vs-cli'),
      legacyBinDir: path.join(baseAppData, 'tele-vs-cli', 'bin'),
      legacyServiceName: 'TeleVsCliWorker'
    };
  }

  return {
    baseDir: path.join(homeDir, '.kerakerja'),
    appDir: path.join(homeDir, '.kerakerja'),
    binDir: path.join(homeDir, '.local', 'bin'),
    launchers: [path.join(homeDir, '.local', 'bin', 'kerakerja')],
    systemdUnit: path.join(homeDir, '.config', 'systemd', 'user', 'kerakerja.service'),
    launchdPlist: path.join(homeDir, 'Library', 'LaunchAgents', 'com.usmrip.kerakerja.plist'),
    legacyBaseDir: path.join(homeDir, '.tele-vs-cli'),
    legacyLaunchers: [path.join(homeDir, '.local', 'bin', 'tele')],
    legacySystemdUnit: path.join(homeDir, '.config', 'systemd', 'user', 'tele-vs-cli.service'),
    legacyLaunchdPlist: path.join(homeDir, 'Library', 'LaunchAgents', 'com.usmrip.tele-vs-cli.plist')
  };
}

function printUsage() {
  console.log(`
KeraKerja Universal Uninstaller (Linux / macOS / Windows)

Penggunaan:
  node scripts/uninstall.js [opsi]

Opsi:
  --yes, -y     Lanjutkan tanpa konfirmasi interaktif
  --purge       Hapus juga konfigurasi lokal (kerakerja.config.json, logs/, PID)
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

function stopPidFile(pidPath, dryRun, summary, label = 'Worker daemon') {
  if (!fs.existsSync(pidPath)) return;
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
        console.log(`   [dry-run] Akan menghentikan ${label} PID ${pid}`);
        summary.push(`(dry-run) Hentikan ${label} PID ${pid}`);
      } else {
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
          } else {
            process.kill(pid, 'SIGTERM');
          }
          console.log(`   ✅ ${label} (PID ${pid}) dihentikan.`);
          summary.push(`Hentikan ${label} PID ${pid}`);
        } catch (e) {
          console.log(`   ⚠️ Gagal menghentikan ${label} PID ${pid}: ${e.message}`);
        }
      }
    }
  }
  safeUnlink(pidPath, dryRun, summary);
}

function stopWorkerDaemon(dirs, dryRun, summary, globalDir = getGlobalDir()) {
  const checked = new Set();
  for (const dir of dirs) {
    if (!dir) continue;
    const resolved = path.resolve(dir);
    if (checked.has(resolved)) continue;
    checked.add(resolved);
    stopPidFile(path.join(resolved, 'kerakerja-worker.pid'), dryRun, summary, 'Worker daemon');
    stopPidFile(path.join(resolved, 'tele-worker.pid'), dryRun, summary, 'Legacy worker daemon');
  }

  if (globalDir) {
    stopPidFile(path.join(globalDir, 'multi-worker.pid'), dryRun, summary, 'Multi-Project worker');
  }
  const legacyGlobalDir = path.join(os.homedir(), '.tele-vs-cli');
  if (fs.existsSync(legacyGlobalDir)) {
    stopPidFile(path.join(legacyGlobalDir, 'multi-worker.pid'), dryRun, summary, 'Legacy Multi-Project worker');
  }
}

function cleanWorkspaces(workspaceDirs, dryRun, summary) {
  const seen = new Set();
  for (const dir of workspaceDirs) {
    if (!dir) continue;
    const resolved = path.resolve(dir);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!fs.existsSync(resolved)) continue;
    console.log(`   🧹 Membersihkan workspace: ${resolved}`);
    safeUnlink(path.join(resolved, 'kerakerja.config.json'), dryRun, summary);
    safeUnlink(path.join(resolved, 'kerakerja-worker.pid'), dryRun, summary);
    safeUnlink(path.join(resolved, 'tele.config.json'), dryRun, summary);
    safeUnlink(path.join(resolved, 'tele-worker.pid'), dryRun, summary);
    safeRmDir(path.join(resolved, 'logs'), dryRun, summary);
  }
}

function removeAutoService(paths, dryRun, summary) {
  if (process.platform === 'win32') {
    for (const svcName of [paths.serviceName, paths.legacyServiceName].filter(Boolean)) {
      try {
        execSync(`schtasks /query /tn "${svcName}"`, { stdio: 'ignore', windowsHide: true });
        if (dryRun) {
          console.log(`   [dry-run] Akan menghapus Windows Task Scheduler: ${svcName}`);
          summary.push(`(dry-run) Hapus service ${svcName}`);
        } else {
          execSync(`schtasks /delete /tn "${svcName}" /f`, { stdio: 'ignore', windowsHide: true });
          console.log(`   ✅ Windows Task Scheduler '${svcName}' dihapus.`);
          summary.push(`Hapus service ${svcName}`);
        }
      } catch (e) {
        // Task tidak terpasang
      }
    }
    return;
  }

  if (process.platform === 'linux') {
    for (const [unitName, unitPath] of [['kerakerja', paths.systemdUnit], ['tele-vs-cli', paths.legacySystemdUnit]]) {
      if (!unitPath || !fs.existsSync(unitPath)) continue;
      if (dryRun) {
        console.log(`   [dry-run] Akan menonaktifkan & menghapus systemd unit: ${unitPath}`);
        summary.push(`(dry-run) Hapus systemd service ${unitName}`);
      } else {
        try { execSync(`systemctl --user stop ${unitName}`, { stdio: 'ignore' }); } catch (e) {}
        try { execSync(`systemctl --user disable ${unitName}`, { stdio: 'ignore' }); } catch (e) {}
        safeUnlink(unitPath, false, summary);
        try { execSync('systemctl --user daemon-reload', { stdio: 'ignore' }); } catch (e) {}
        console.log(`   ✅ Layanan systemd user service ${unitName} dihapus.`);
      }
    }
    return;
  }

  if (process.platform === 'darwin') {
    for (const plistPath of [paths.launchdPlist, paths.legacyLaunchdPlist].filter(Boolean)) {
      if (!fs.existsSync(plistPath)) continue;
      if (dryRun) {
        console.log(`   [dry-run] Akan unload & menghapus launchd plist: ${plistPath}`);
        summary.push(`(dry-run) Hapus launchd service ${path.basename(plistPath)}`);
      } else {
        try { execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' }); } catch (e) {}
        safeUnlink(plistPath, false, summary);
        console.log(`   ✅ Layanan macOS launchd ${path.basename(plistPath)} dihapus.`);
      }
    }
  }
}

function removeLaunchersAndPath(paths, dryRun, summary) {
  for (const launcher of [...(paths.launchers || []), ...(paths.legacyLaunchers || [])]) {
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
      let currentPath = execSync(
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'User\')"',
        { encoding: 'utf-8', windowsHide: true }
      ).trim();
      let anyChanged = false;
      for (const dirToRemove of [paths.binDir, paths.legacyBinDir].filter(Boolean)) {
        const { changed, newPath } = removeDirFromWindowsPath(currentPath, dirToRemove);
        if (changed) {
          currentPath = newPath;
          anyChanged = true;
          if (dryRun) {
            console.log(`   [dry-run] Akan menghapus '${dirToRemove}' dari User PATH Windows.`);
            summary.push(`(dry-run) Hapus ${dirToRemove} dari User PATH`);
          } else {
            console.log(`   ✅ '${dirToRemove}' dihapus dari User PATH Windows.`);
            summary.push(`Hapus ${dirToRemove} dari User PATH`);
          }
        }
      }
      if (anyChanged && !dryRun) {
        execSync(
          'powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::SetEnvironmentVariable(\'Path\', $env:__TELE_NEW_PATH, \'User\')"',
          { windowsHide: true, env: { ...process.env, __TELE_NEW_PATH: currentPath } }
        );
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
  console.log('🧹 KeraKerja Universal Uninstaller (Linux / Windows / macOS)');
  console.log('==============================================================================\n');
  console.log(`📌 Sistem Operasi : ${process.platform} (${os.type()} ${os.arch()})`);
  if (opts.dryRun) {
    console.log('📌 Mode           : DRY-RUN (tidak ada perubahan permanen)');
  }

  const rootDir = path.resolve(__dirname, '..');
  const paths = getInstallPaths(process.platform);
  const globalDir = getGlobalDir();
  const workspacesFile = getGlobalWorkspacesPath();
  const registeredWorkspaces = loadWorkspaces(workspacesFile);
  const workspaceDirs = registeredWorkspaces.map(w => w.workDir);

  if (registeredWorkspaces.length > 0) {
    console.log(`📌 Workspace terdaftar (${registeredWorkspaces.length}):`);
    for (const ws of registeredWorkspaces) {
      console.log(`   • ${ws.projectId} -> ${ws.workDir}`);
    }
  }

  if (!opts.yes && !opts.dryRun) {
    if (!process.stdin.isTTY) {
      console.log('\n❌ Konfirmasi diperlukan untuk mencopot KeraKerja dan membersihkan semua workspace.');
      console.log('   Jalankan di terminal interaktif atau tambahkan flag --yes (-y).');
      return { exitCode: 1, aborted: true };
    }
    const confirmed = await askConfirmation(
      '\n⚠️ Apakah Anda yakin ingin mencopot KeraKerja dan menghapus konfigurasi di semua workspace? (y/N): '
    );
    if (!confirmed) {
      console.log('❌ Pencopotan dibatalkan.');
      return { exitCode: 0, aborted: true };
    }
  }

  const summary = [];

  console.log('\n1️⃣  Menghentikan semua background worker...');
  stopWorkerDaemon([rootDir, process.cwd(), paths.appDir, ...workspaceDirs], opts.dryRun, summary, globalDir);

  console.log('\n2️⃣  Memeriksa & menghapus auto-start service...');
  removeAutoService(paths, opts.dryRun, summary);

  console.log('\n3️⃣  Menghapus launcher CLI & entri PATH...');
  removeLaunchersAndPath(paths, opts.dryRun, summary);

  console.log('\n4️⃣  Membersihkan direktori instalasi & semua workspace...');
  const normalizedRoot = path.normalize(rootDir).toLowerCase();
  const normalizedApp = path.normalize(paths.appDir).toLowerCase();

  // Bersihkan file runtime Tele-vs-CLI di seluruh workspace terdaftar
  const dirsToClean = [...workspaceDirs];
  if (opts.purge && normalizedRoot !== normalizedApp) {
    dirsToClean.push(rootDir, process.cwd());
  }
  cleanWorkspaces(dirsToClean, opts.dryRun, summary);

  // Hapus global registry & multi-worker logs (~/.tele-vs-cli/workspaces.json, multi-worker.log)
  safeUnlink(workspacesFile, opts.dryRun, summary);
  safeUnlink(path.join(globalDir, 'multi-worker.log'), opts.dryRun, summary);

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

  if (process.platform !== 'win32' && fs.existsSync(globalDir)) {
    try {
      if (fs.readdirSync(globalDir).length === 0) {
        safeRmDir(globalDir, opts.dryRun, summary);
      }
    } catch (e) {}
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

  // Hapus direktori instalasi legacy ~/.tele-vs-cli atau %LOCALAPPDATA%\tele-vs-cli
  if (paths.legacyBaseDir && fs.existsSync(paths.legacyBaseDir)) {
    safeRmDir(paths.legacyBaseDir, opts.dryRun, summary);
  }

  console.log('\n==============================================================================');
  if (opts.dryRun) {
    console.log('🔍 Simulasi Uninstall Selesai (Dry-Run)');
  } else {
    console.log('✅ KeraKerja Berhasil Dicopot!');
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
  runUninstall().then((res) => {
    if (res && res.exitCode) process.exit(res.exitCode);
  }).catch((err) => {
    console.error(`\n❌ Terjadi kesalahan saat uninstall: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseUninstallArgs,
  removeDirFromWindowsPath,
  getInstallPaths,
  cleanWorkspaces,
  runUninstall
};
