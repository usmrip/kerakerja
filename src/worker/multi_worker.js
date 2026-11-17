const fs = require('fs');
const os = require('os');
const TeleWorker = require('./worker');
const { loadWorkspaces, saveWorkspaces, getGlobalWorkspacesPath } = require('../config/workspaces');
const { loadConfig } = require('../config/config');
const { formatLocalTimestamp } = require('../utils/time');

class MultiProjectWorker {
  constructor(options = {}) {
    this.verbose = Boolean(options.verbose || process.env.TELE_VERBOSE);
    this.workspacesFile = options.workspacesFile || getGlobalWorkspacesPath();
    this.workers = [];
    this.running = false;
  }

  log(msg) {
    const time = formatLocalTimestamp();
    console.log(`[${time}] [multi-worker] ${msg}`);
  }

  resolveValidWorkspaces() {
    const registered = loadWorkspaces(this.workspacesFile);
    const valid = [];
    const seenProjects = new Set();
    let prunedCount = 0;

    for (const entry of registered) {
      if (!entry.workDir || !fs.existsSync(entry.workDir)) {
        this.log(`[PRUNE] Folder workspace tidak ditemukan, dihapus dari registry: ${entry.workDir}`);
        prunedCount++;
        continue;
      }
      // Gabungkan dengan config lokal folder agar selalu up-to-date
      const localCfg = loadConfig(entry.workDir);
      const secret = localCfg.secret || entry.secret;
      const projectId = (localCfg.projectId && localCfg.projectId !== 'default') ? localCfg.projectId : entry.projectId;

      if (!secret || !projectId || projectId === 'default') {
        this.log(`[SKIP] Konfigurasi belum lengkap di: ${entry.workDir}`);
        continue;
      }

      const projKey = String(projectId).trim().toLowerCase();
      if (seenProjects.has(projKey)) {
        this.log(`[PRUNE] Duplikasi proyek '${projectId}' di ${entry.workDir} dilewati.`);
        prunedCount++;
        continue;
      }
      seenProjects.add(projKey);

      valid.push({
        ...entry,
        projectId,
        secret
      });
    }

    if (prunedCount > 0) {
      saveWorkspaces(valid, this.workspacesFile);
    }

    return valid;
  }

  async start() {
    const workspaces = this.resolveValidWorkspaces();
    if (workspaces.length === 0) {
      throw new Error(
        `Belum ada proyek terdaftar di ${this.workspacesFile}.\n` +
        `Masuk ke masing-masing folder proyek lalu jalankan 'tele init' atau 'tele use <project_id>'.`
      );
    }

    this.running = true;
    this.log(`====================================================================`);
    this.log(`Memulai Tele-vs-CLI Multi-Project Worker (${workspaces.length} proyek)`);
    this.log(`Registry: ${this.workspacesFile}`);
    this.log(`====================================================================`);

    for (let i = 0; i < workspaces.length; i++) {
      const ws = workspaces[i];
      const safeId = String(ws.projectId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || `p${i + 1}`;
      const workerId = `worker-${os.hostname()}-${process.pid}-${safeId}-${i + 1}`;
      const worker = new TeleWorker({
        workDir: ws.workDir,
        verbose: this.verbose,
        workerId
      });
      this.workers.push(worker);
      this.log(`  [${i + 1}/${workspaces.length}] Proyek '${ws.projectId}' -> ${ws.workDir}`);
    }

    const results = await Promise.allSettled(this.workers.map(w => w.start()));
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      for (const f of failures) {
        this.log(`[WARN] Salah satu worker proyek gagal start: ${f.reason ? f.reason.message : 'unknown error'}`);
      }
      if (failures.length === this.workers.length) {
        throw failures[0].reason || new Error('Semua worker proyek gagal dijalankan.');
      }
    }
  }

  async stop() {
    this.running = false;
    this.log(`Menghentikan ${this.workers.length} worker proyek...`);
    await Promise.allSettled(this.workers.map(w => w.stop()));
    this.workers = [];
    this.log(`Semua worker proyek berhasil dihentikan.`);
  }
}

module.exports = MultiProjectWorker;
