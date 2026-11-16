const os = require('os');
const path = require('path');
const fs = require('fs');
const ApiClient = require('../api/client');
const CliExecutor = require('../executor/cli');
const { loadConfig } = require('../config/config');
const { isDangerousSystemCommand } = require('../security/guard');

class TeleWorker {
  constructor(options = {}) {
    this.workDir = options.workDir || process.cwd();
    this.config = loadConfig(this.workDir);
    this.api = new ApiClient(this.config.serverUrl, this.config.secret, this.config.projectId);
    this.workerId = options.workerId || `worker-${os.hostname()}-${process.pid}`;
    this.executor = new CliExecutor({
      agent: this.config.agent,
      workDir: this.workDir,
      timeout: this.config.taskTimeout
    });
    this.running = false;
    this.activeTask = null;
    this.pollTimer = null;
    this.heartbeatTimer = null;
  }

  log(msg) {
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${time}] [${this.workerId}] ${msg}`);
  }

  async start() {
    this.running = true;
    this.log(`Tele-vs-CLI Worker dimulai.`);
    this.log(`Target Server : ${this.config.serverUrl}`);
    this.log(`Project ID    : ${this.config.projectId}`);
    this.log(`Agent CLI     : ${this.config.agent}`);
    this.log(`Workdir       : ${this.workDir}`);

    // Register worker
    try {
      await this.api.registerWorker(this.workerId, {
        agent: this.config.agent,
        workDir: this.workDir,
        pid: process.pid
      });
      this.log(`Terkoneksi & terdaftar di Server Biru.`);
    } catch (e) {
      this.log(`[WARN] Registrasi awal worker gagal: ${e.message}`);
    }

    // Heartbeat every 30s
    this.heartbeatTimer = setInterval(async () => {
      if (!this.running) return;
      try {
        await this.api.registerWorker(this.workerId, {
          activeTask: this.activeTask ? this.activeTask.id : null,
          status: this.activeTask ? 'busy' : 'idle'
        });
      } catch (e) {}
    }, 30000);

    // Main polling loop
    this.pollLoop();
  }

  async pollLoop() {
    while (this.running) {
      if (!this.activeTask) {
        try {
          await this.checkAndProcessNextTask();
        } catch (err) {
          this.log(`[POLL ERROR] ${err.message}`);
        }
      }
      await new Promise(r => setTimeout(r, this.config.pollInterval));
    }
  }

  async checkAndProcessNextTask() {
    const res = await this.api.pullTasks();
    if (!res || !res.data) return;

    let tasks = [];
    if (Array.isArray(res.data.tasks)) {
      tasks = res.data.tasks;
    } else if (Array.isArray(res.data)) {
      tasks = res.data;
    }

    const pending = tasks.find(t => t.status === 'PENDING' || t.status === 'WAITING' || t.status === 'QUEUE');
    if (!pending) return;

    // Check if task executor is suitable
    if (pending.executor && pending.executor !== 'cli' && pending.executor !== 'all') {
      return;
    }

    await this.executeTask(pending);
  }

  async executeTask(task) {
    this.activeTask = task;
    this.log(`\n======================================================`);
    this.log(`🚀 Mengambil Tugas #${task.id}: "${task.instruction}"`);
    this.log(`======================================================`);

    // Guard: Prevent dangerous system commands
    if (isDangerousSystemCommand(task.instruction)) {
      const errMsg = `[SECURITY BLOCKED] Instruksi #${task.id} mengandung perintah sistem berbahaya dan ditolak otomatis.`;
      this.log(errMsg);
      await this.api.failTask(task.id, errMsg);
      this.activeTask = null;
      return;
    }

    try {
      // Claim task atomically
      await this.api.startTask(task.id, this.workerId, this.config.agent);
      this.log(`Status tugas #${task.id} diubah menjadi IN_PROGRESS.`);

      // Execute via CLI executor
      const startTime = Date.now();
      const res = await this.executor.execute(task, {
        workDir: this.workDir,
        agent: task.assigned_agent || task.agent || this.config.agent
      });
      const durationSec = Math.round((Date.now() - startTime) / 1000);

      if (res.success) {
        this.log(`✅ Tugas #${task.id} SELESAI dalam ${durationSec}s!`);
        if (res.commitHash) this.log(`📌 Git Commit: ${res.commitHash}`);
        await this.api.doneTask(task.id, res.summary || 'Selesai 100%', res.commitHash, res.log);
      } else {
        this.log(`❌ Tugas #${task.id} GAGAL: ${res.summary}`);
        await this.api.failTask(task.id, res.summary, res.log);
      }
    } catch (e) {
      this.log(`❌ Exception saat mengeksekusi #${task.id}: ${e.message}`);
      await this.api.failTask(task.id, e.message, e.stack);
    } finally {
      this.activeTask = null;
    }
  }

  async stop() {
    this.log(`Menghentikan worker...`);
    this.running = false;
    clearInterval(this.heartbeatTimer);
    try {
      await this.api.unregisterWorker(this.workerId);
    } catch (e) {}
    this.log(`Worker dihentikan.`);
  }
}

module.exports = TeleWorker;
