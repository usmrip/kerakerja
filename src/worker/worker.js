const os = require('os');
const path = require('path');
const fs = require('fs');
const ApiClient = require('../api/client');
const CliExecutor = require('../executor/cli');
const { loadConfig } = require('../config/config');
const { isDangerousSystemCommand } = require('../security/guard');
const {
  matchesTaskId,
  writeActiveTask,
  clearActiveTask
} = require('../utils/process');

const KILLED_STATUSES = new Set(['FAILED', 'CANCELLED', 'CANCELED', 'KILLED']);

/**
 * Parses a `/kill <task_id> [reason]` instruction.
 * @param {string} instruction
 * @returns {{ targetTaskId: string | null, reason: string } | null}
 */
function parseKillCommand(instruction) {
  const text = String(instruction || '').trim();
  const match = text.match(/^\/kill(?:@\w+)?(?:\s+(#?TASK-[A-Za-z0-9_-]+|[A-Za-z0-9_-]+))?(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  return {
    targetTaskId: match[1] ? match[1].trim() : null,
    reason: match[2] ? match[2].trim() : ''
  };
}

function parseUpdateCommand(instruction) {
  const text = String(instruction || '').trim();
  return /^\/(upgrade|update)(?:@\w+)?(?:\s+.*)?$/i.test(text) || text === 'system:update';
}

class TeleWorker {
  constructor(options = {}) {
    this.workDir = options.workDir || process.cwd();
    this.verbose = Boolean(options.verbose || process.env.TELE_VERBOSE);
    this.config = loadConfig(this.workDir);
    this.api = new ApiClient(this.config.serverUrl, this.config.secret, this.config.projectId);
    this.workerId = options.workerId || `worker-${os.hostname()}-${process.pid}`;
    this.executor = new CliExecutor({
      agent: this.config.agent,
      workDir: this.workDir,
      timeout: this.config.taskTimeout,
      verbose: this.verbose
    });
    this.running = false;
    this.activeTask = null;
    this.activeAbortController = null;
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.lastUpdateCheck = 0;
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
          await this.checkForSilentUpdate();
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

    const killCmd = parseKillCommand(pending.instruction);
    if (killCmd) {
      await this.handleKillInstruction(pending, killCmd);
      return;
    }

    if (parseUpdateCommand(pending.instruction)) {
      await this.handleUpdateInstruction(pending);
      return;
    }

    await this.executeTask(pending);
  }

  async checkForSilentUpdate() {
    const now = Date.now();
    // Cek auto-update setiap 30 menit saat idle
    if (now - this.lastUpdateCheck < 1800000) return;
    this.lastUpdateCheck = now;

    const rootDir = path.resolve(__dirname, '..', '..');
    const gitDir = path.join(rootDir, '.git');
    if (!fs.existsSync(gitDir)) return;

    try {
      const { execSync } = require('child_process');
      execSync('git fetch origin main', { cwd: rootDir, stdio: 'ignore', timeout: 10000 });
      const localCommit = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf-8' }).trim();
      const remoteCommit = execSync('git rev-parse origin/main', { cwd: rootDir, encoding: 'utf-8' }).trim();

      if (localCommit && remoteCommit && localCommit !== remoteCommit) {
        this.log(`🔄 [AUTO-UPDATE] Terdeteksi versi baru di remote (${remoteCommit.substring(0, 7)}). Mengunduh pembaruan otomatis...`);
        execSync('git pull origin main', { cwd: rootDir, stdio: 'ignore', timeout: 15000 });
        this.log(`✅ [AUTO-UPDATE] Tele-vs-CLI berhasil diperbarui otomatis ke commit ${remoteCommit.substring(0, 7)}!`);
      }
    } catch (e) {
      // Abaikan jika offline / git error
    }
  }

  async handleUpdateInstruction(task) {
    this.log(`🔄 Memproses perintah pembaruan sistem (#${task.id})...`);
    try {
      await this.api.startTask(task.id, this.workerId, this.config.agent);
      const rootDir = path.resolve(__dirname, '..', '..');
      const gitDir = path.join(rootDir, '.git');

      if (!fs.existsSync(gitDir)) {
        await this.api.doneTask(task.id, 'Direktori instalasi bukan git repository. Update manual via installer diperlukan.');
        return;
      }

      const { execSync } = require('child_process');
      execSync('git fetch origin main', { cwd: rootDir, stdio: 'ignore', timeout: 10000 });
      const beforeCommit = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf-8' }).trim();
      const pullOut = execSync('git pull origin main', { cwd: rootDir, encoding: 'utf-8' }).trim();
      const afterCommit = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf-8' }).trim();

      const summary = (beforeCommit === afterCommit)
        ? `Worker sudah menggunakan versi terbaru (${afterCommit.substring(0, 7)}).`
        : `Worker berhasil diupdate otomatis dari ${beforeCommit.substring(0, 7)} ke ${afterCommit.substring(0, 7)}:\n${pullOut}`;

      await this.api.doneTask(task.id, summary, afterCommit);
      this.log(`✅ Pembaruan tugas #${task.id} selesai: ${summary}`);
    } catch (e) {
      this.log(`❌ Gagal update #${task.id}: ${e.message}`);
      await this.api.failTask(task.id, `Gagal auto-update: ${e.message}`);
    }
  }

  async handleKillInstruction(killTask, parsed) {
    this.log(`🛑 Memproses perintah /kill (#${killTask.id}): target=${parsed.targetTaskId || '(tidak disebutkan)'}`);
    try {
      await this.api.startTask(killTask.id, this.workerId, this.config.agent);
      if (!parsed.targetTaskId) {
        await this.api.failTask(killTask.id, 'Format perintah tidak lengkap. Gunakan: /kill <task_id>');
        return;
      }

      let resolvedId = parsed.targetTaskId;
      try {
        const res = await this.api.getTask(parsed.targetTaskId);
        const remote = res && res.data && res.data.task;
        if (remote) {
          resolvedId = remote.id;
          if (remote.status === 'DONE') {
            await this.api.doneTask(killTask.id, `Tugas ${resolvedId} sudah berstatus DONE dan tidak dapat di-kill.`);
            return;
          }
        }
      } catch (e) {}

      const reason = parsed.reason || `Dihentikan paksa (/kill) melalui ${killTask.id}`;
      await this.api.killTask(resolvedId, reason);
      await this.api.doneTask(killTask.id, `Tugas ${resolvedId} berhasil dihentikan (/kill).`);
      this.log(`✅ Target ${resolvedId} berhasil di-kill melalui ${killTask.id}.`);
    } catch (e) {
      this.log(`❌ Gagal memproses /kill #${killTask.id}: ${e.message}`);
      try {
        await this.api.failTask(killTask.id, `Gagal memproses /kill: ${e.message}`);
      } catch (err) {}
    }
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

    let watchdogTimer = null;
    let killedRemotely = false;
    this.activeAbortController = new AbortController();

    try {
      // Claim task atomically
      await this.api.startTask(task.id, this.workerId, this.config.agent);
      this.log(`Status tugas #${task.id} diubah menjadi IN_PROGRESS.`);

      const watchdogMs = Math.min(this.config.pollInterval || 5000, 5000);
      watchdogTimer = setInterval(async () => {
        if (!this.activeAbortController || this.activeAbortController.signal.aborted) return;
        try {
          const taskRes = await this.api.getTask(task.id);
          const remoteTask = taskRes && taskRes.data && taskRes.data.task;
          if (remoteTask && KILLED_STATUSES.has(String(remoteTask.status || '').toUpperCase())) {
            killedRemotely = true;
            this.log(`🛑 Tugas #${task.id} dihentikan dari server (${remoteTask.status}). Menghentikan proses agent...`);
            this.activeAbortController.abort();
            return;
          }

          const pullRes = await this.api.pullTasks();
          const pullList = (pullRes && pullRes.data && Array.isArray(pullRes.data.tasks))
            ? pullRes.data.tasks
            : (Array.isArray(pullRes && pullRes.data) ? pullRes.data : []);
          for (const candidate of pullList) {
            if (!['PENDING', 'WAITING', 'QUEUE'].includes(candidate.status)) continue;
            const parsedKill = parseKillCommand(candidate.instruction);
            if (!parsedKill) continue;
            if (!parsedKill.targetTaskId || matchesTaskId(parsedKill.targetTaskId, task.id)) {
              killedRemotely = true;
              const reason = parsedKill.reason || `Dihentikan paksa (/kill) melalui ${candidate.id}`;
              this.log(`🛑 Menerima perintah /kill (${candidate.id}) untuk tugas aktif #${task.id}. Menghentikan proses agent...`);
              this.activeAbortController.abort();
              try {
                await this.api.killTask(task.id, reason);
                await this.api.doneTask(candidate.id, `Tugas #${task.id} berhasil dihentikan (/kill).`);
              } catch (e) {}
              return;
            }
          }
        } catch (e) {}
      }, watchdogMs);

      const isTaskVerbose = Boolean(
        this.verbose ||
        task.verbose ||
        (task.instruction && (/\b--verbose\b/i.test(task.instruction) || /\b-v\b/.test(task.instruction)))
      );

      if (isTaskVerbose) {
        this.log(`🔍 [VERBOSE] Mode verbose aktif untuk tugas #${task.id}. Menampilkan progres berjalan agent secara live.`);
      }

      // Execute via CLI executor
      const startTime = Date.now();
      const res = await this.executor.execute(task, {
        workDir: this.workDir,
        agent: task.assigned_agent || task.agent || this.config.agent,
        verbose: isTaskVerbose,
        signal: this.activeAbortController.signal,
        onSpawn: (child) => {
          writeActiveTask(this.workDir, {
            taskId: task.id,
            pid: child.pid,
            workerId: this.workerId,
            startedAt: new Date().toISOString()
          });
        },
        onProgress: (chunk, isErr) => {
          if (isTaskVerbose) {
            const prefix = isErr ? '[AGENT-ERR]' : '[AGENT-PROG]';
            const clean = chunk.trim();
            if (clean) this.log(`${prefix} ${clean}`);
          }
        }
      });
      const durationSec = Math.round((Date.now() - startTime) / 1000);

      if (res.killed) {
        this.log(`🛑 Tugas #${task.id} dihentikan (/kill) setelah ${durationSec}s.`);
        if (!killedRemotely) {
          await this.api.failTask(task.id, res.summary, res.log);
        }
      } else if (res.success) {
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
      if (watchdogTimer) clearInterval(watchdogTimer);
      clearActiveTask(this.workDir, task.id);
      this.activeAbortController = null;
      this.activeTask = null;
    }
  }

  async stop() {
    this.log(`Menghentikan worker...`);
    this.running = false;
    clearInterval(this.heartbeatTimer);
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }
    try {
      await this.api.unregisterWorker(this.workerId);
    } catch (e) {}
    this.log(`Worker dihentikan.`);
  }
}

TeleWorker.parseKillCommand = parseKillCommand;

module.exports = TeleWorker;
