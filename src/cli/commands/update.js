const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getRunningPid } = require('./daemon_ctl');
const { loadConfig } = require('../../config/config');
const ApiClient = require('../../api/client');

function parseUpdateArgs(args = []) {
  const normalized = args.map(a => String(a || '').trim().toLowerCase()).filter(Boolean);
  return {
    checkOnly: normalized.includes('--check') || normalized.includes('-c'),
    allWorkers: normalized.includes('--all') || normalized.includes('-a') || normalized.includes('all') || normalized.includes('workers') || normalized.includes('--workers'),
    noRestart: normalized.includes('--no-restart')
  };
}

async function dispatchUpdateToRemoteWorkers(options = {}) {
  const cwd = options.workDir || process.cwd();
  const config = options.config || loadConfig(cwd);
  const currentHost = options.hostname || os.hostname();
  const results = [];

  if (!config.serverUrl || !config.secret) {
    return { ok: false, error: 'Konfigurasi server/secret belum disetel', results };
  }

  const client = options.apiClient || new ApiClient(config.serverUrl, config.secret, config.projectId);
  const workersRes = await client.getWorkers({ all: true });
  if (!workersRes || !workersRes.data || !workersRes.data.ok) {
    return {
      ok: false,
      error: (workersRes && workersRes.data && workersRes.data.error) || 'Gagal mengambil daftar worker dari server',
      results
    };
  }

  const allWorkers = Array.isArray(workersRes.data.workers) ? workersRes.data.workers : [];
  const onlineWorkers = allWorkers.filter(w => Boolean(w.is_online));

  const seenProjects = new Set();
  for (const wk of onlineWorkers) {
    const targetProject = wk.project_key || wk.project_id;
    if (!targetProject) continue;

    // Lewati worker lokal pada host & proyek yang sama karena sudah di-update langsung secara lokal
    const isSameLocalProject = (
      String(wk.hostname || '').toLowerCase() === String(currentHost || '').toLowerCase()
      && String(targetProject) === String(config.projectId)
    );
    if (isSameLocalProject && !options.includeLocal) continue;

    if (seenProjects.has(targetProject)) continue;
    seenProjects.add(targetProject);

    const targetClient = options.createProjectClient
      ? options.createProjectClient(targetProject)
      : new ApiClient(config.serverUrl, config.secret, targetProject);

    try {
      const pushRes = await targetClient.addTask('/update', {
        sender: options.sender || 'CLI (Upgrade All)',
        priority: 'HIGH'
      });
      const taskId = pushRes && pushRes.data && (pushRes.data.id || (pushRes.data.task && pushRes.data.task.id));
      results.push({
        ok: Boolean(pushRes && pushRes.data && pushRes.data.ok !== false),
        projectId: targetProject,
        projectName: wk.project_name || targetProject,
        projectCode: wk.project_code || '',
        hostname: wk.hostname || wk.worker_id || 'worker',
        taskId: taskId || null
      });
    } catch (err) {
      results.push({
        ok: false,
        projectId: targetProject,
        projectName: wk.project_name || targetProject,
        projectCode: wk.project_code || '',
        hostname: wk.hostname || wk.worker_id || 'worker',
        error: err.message
      });
    }
  }

  return {
    ok: true,
    totalOnline: onlineWorkers.length,
    dispatchedCount: results.filter(r => r.ok).length,
    results
  };
}

async function updateCommand(args = []) {
  const opts = parseUpdateArgs(args);
  const isCheckOnly = opts.checkOnly;
  const rootDir = path.resolve(__dirname, '..', '..', '..');
  const gitDir = path.join(rootDir, '.git');

  console.log('==============================================================================');
  console.log('🔄 PEMBARUAN KERAKERJA (AUTO-UPDATE)');
  console.log('==============================================================================\n');

  if (!fs.existsSync(gitDir)) {
    console.log(`⚠️ Direktori instalasi (${rootDir}) bukan merupakan repositori Git.`);
    console.log(`💡 Untuk memperbarui instalasi global, jalankan ulang skrip installer:`);
    console.log(`   Linux / macOS : curl -fsSL https://raw.githubusercontent.com/usmrip/kerakerja/main/install.sh | bash`);
    console.log(`   Windows       : irm https://raw.githubusercontent.com/usmrip/kerakerja/main/install.ps1 | iex\n`);
    return;
  }

  try {
    process.stdout.write('🔍 Memeriksa pembaruan dari remote GitHub (origin/main)... ');
    execSync('git fetch origin main', { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
    console.log('✅ Terhubung.');

    const localCommit = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf-8' }).trim();
    const remoteCommit = execSync('git rev-parse origin/main', { cwd: rootDir, encoding: 'utf-8' }).trim();

    if (localCommit === remoteCommit) {
      console.log(`\n🟢 Instalasi lokal sudah menggunakan versi KeraKerja TERBARU (${localCommit.substring(0, 7)}).`);
    } else {
      const logDiff = execSync('git log HEAD..origin/main --oneline', { cwd: rootDir, encoding: 'utf-8' }).trim();
      console.log(`\n📦 Ditemukan pembaruan baru di remote:\n`);
      for (const line of logDiff.split(/\r?\n/).slice(0, 5)) {
        console.log(`   ✨ ${line}`);
      }

      if (isCheckOnly) {
        console.log(`\n💡 Jalankan 'kerakerja update' tanpa opsi untuk menerapkan pembaruan.\n`);
        return;
      }

      console.log(`\n⬇️ Mengunduh dan menerapkan pembaruan (git pull)...`);
      const pullOut = execSync('git pull origin main', { cwd: rootDir, encoding: 'utf-8' }).trim();
      console.log(pullOut);

      // Refresh launcher jika ada skrip install
      const installScript = path.join(rootDir, 'scripts', 'install.js');
      if (fs.existsSync(installScript)) {
        try {
          execSync(`node "${installScript}" --skip-update-check`, { stdio: 'ignore' });
        } catch (e) {}
      }

      console.log('\n==============================================================================');
      console.log('🎉 KeraKerja Lokal Berhasil Diperbarui ke Versi Terbaru!');
      console.log('==============================================================================');
    }

    if (opts.allWorkers && !isCheckOnly) {
      console.log('\n🌐 Mengirim perintah /update ke seluruh worker online lainnya...');
      const remoteRes = await dispatchUpdateToRemoteWorkers({ workDir: process.cwd() });
      if (!remoteRes.ok) {
        console.log(`⚠️ Gagal mengirim update ke worker remote: ${remoteRes.error}`);
      } else if (remoteRes.results.length === 0) {
        console.log('ℹ️ Tidak ada worker online di proyek lain yang perlu dikirimi perintah /update.');
      } else {
        for (const r of remoteRes.results) {
          const label = `${r.projectName}${r.projectCode ? ` (#${r.projectCode})` : ''} @ ${r.hostname}`;
          if (r.ok) {
            console.log(`   ✅ ${label} -> Tugas ${r.taskId ? `#${String(r.taskId).replace(/^#+/, '')}` : '/update'} dikirim`);
          } else {
            console.log(`   ❌ ${label} -> Gagal: ${r.error}`);
          }
        }
      }
    }

    // Cek apakah ada background worker yang aktif
    const workerPid = getRunningPid(process.cwd());
    if (workerPid) {
      console.log(`\n⚡ Background worker lokal aktif terdeteksi (PID: ${workerPid}).`);
      console.log(`💡 Disarankan merestart worker agar modul baru dimuat: kerakerja restart\n`);
    } else {
      console.log('');
    }
  } catch (err) {
    console.error(`\n❌ Gagal memeriksa/menerapkan pembaruan: ${err.message}`);
    process.exit(1);
  }
}

updateCommand.parseUpdateArgs = parseUpdateArgs;
updateCommand.dispatchUpdateToRemoteWorkers = dispatchUpdateToRemoteWorkers;

module.exports = updateCommand;
