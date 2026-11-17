const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ApiClient = require('../api/client');
const CliExecutor = require('../executor/cli');
const { loadConfig, saveConfig } = require('../config/config');
const { isDangerousSystemCommand } = require('../security/guard');
const {
  matchesTaskId,
  writeActiveTask,
  clearActiveTask,
  isActiveTaskLocked,
  hasLocalQueueInProgress,
  reconcileLocalQueueStatus
} = require('../utils/process');
const { fetchReport } = require('../utils/agy_usage');
const { formatLocalTimestamp } = require('../utils/time');
const {
  cleanTeleVsCliTrash,
  formatCleanupTable,
  formatCleanupTelegramHtml,
  sendTelegramReport,
  formatBytes
} = require('../cli/commands/sampah');
const {
  resolveSnapshotInputs,
  createSnapshot,
  restoreSnapshot,
  buildRestoreTelegramPayload,
  formatSnapshotSuccessHtml,
  formatRestoreSuccessHtml
} = require('../cli/commands/snapshot');
const { buildInfoData, formatInfoTelegramHtml } = require('../cli/commands/info');
const { buildWhereData, formatWhereTelegramHtml } = require('../cli/commands/where');
const { sendTelegramHtml } = require('../utils/telegram');
const {
  collectSysinfo,
  formatSysinfoText,
  formatSysinfoTelegramHtml
} = require('../cli/commands/sysinfo');

const KILLED_STATUSES = new Set(['FAILED', 'CANCELLED', 'CANCELED', 'KILLED']);
const PENDING_STATUSES = new Set(['PENDING', 'WAITING', 'QUEUE']);
const IN_PROGRESS_STATUSES = new Set(['IN_PROGRESS', 'RUNNING']);
const CLI_EXECUTORS = new Set(['', 'all', 'any', 'cli', 'kerakerja', 'tele-vs-cli', 'headless', 'terminal']);

function normalizeExecutor(executor) {
  return String(executor || '').trim().toLowerCase();
}

function isCliExecutor(executor) {
  return CLI_EXECUTORS.has(normalizeExecutor(executor));
}

function isTaskForCliExecutor(task, workerId = null) {
  if (!task || typeof task !== 'object') return false;
  const rawExecutor = task.executor ?? task.target_executor ?? task.assigned_executor ?? '';
  if (!isCliExecutor(rawExecutor)) return false;

  const owner = task.worker_id || task.locked_by || '';
  if (owner && workerId && owner !== workerId) return false;
  if (owner && !workerId) return false;

  return true;
}

function isClaimAccepted(res, workerId) {
  if (!res) return true;
  if (typeof res.statusCode === 'number' && res.statusCode >= 400) return false;
  const data = res.data;
  if (!data || typeof data !== 'object') return true;
  if (data.ok === false || data.claimed === false || data.conflict === true) return false;
  if (String(data.status || '').toLowerCase() === 'error') return false;

  const claimedTask = data.task;
  if (claimedTask && typeof claimedTask === 'object') {
    if (claimedTask.worker_id && workerId && claimedTask.worker_id !== workerId) {
      return false;
    }
    const execName = claimedTask.executor ?? claimedTask.target_executor ?? '';
    if (execName && !isCliExecutor(execName)) {
      return false;
    }
  }
  return true;
}

function selectNextCliTask(tasks = [], workerId = null) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { task: null, blockedBy: null, blockedReason: null };
  }

  // System commands for CLI take priority so they execute immediately without waiting behind AI tasks
  const urgentSystemTask = tasks.find(t => {
    const status = String(t.status || '').toUpperCase();
    if (!PENDING_STATUSES.has(status)) return false;
    if (!isTaskForCliExecutor(t, workerId)) return false;
    return Boolean(
      parseKillCommand(t.instruction) ||
      parseUpdateCommand(t.instruction) ||
      parseInfoCommand(t.instruction) ||
      parseWhereCommand(t.instruction) ||
      parseSysinfoCommand(t.instruction) ||
      parseSampahCommand(t.instruction) ||
      parseSnapshotCommand(t.instruction) ||
      parseRestoreCommand(t.instruction)
    );
  });
  if (urgentSystemTask) {
    return { task: urgentSystemTask, blockedBy: null, blockedReason: null };
  }

  // Prevent concurrent execution if another CLI worker is already IN_PROGRESS
  const activeRemote = tasks.find(t => {
    const status = String(t.status || '').toUpperCase();
    if (!IN_PROGRESS_STATUSES.has(status)) return false;
    if (workerId && t.worker_id && t.worker_id === workerId) return false;
    return true;
  });
  if (activeRemote) {
    const owner = activeRemote.executor || activeRemote.worker_id || 'worker lain';
    return {
      task: null,
      blockedBy: activeRemote,
      blockedReason: `Tugas #${activeRemote.id} sedang dikerjakan oleh ${owner}`
    };
  }

  const pending = tasks.find(t => {
    const status = String(t.status || '').toUpperCase();
    return PENDING_STATUSES.has(status) && isTaskForCliExecutor(t, workerId);
  });

  return {
    task: pending || null,
    blockedBy: null,
    blockedReason: null
  };
}

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

function parseSampahCommand(instruction) {
  const text = String(instruction || '').trim();
  const match = text.match(/^\/sampah(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const argText = (match[1] || '').trim().toLowerCase();
  return {
    dryRun: argText.includes('--dry-run') || argText.includes('dry-run')
  };
}

function parseSnapshotCommand(instruction) {
  const text = String(instruction || '').trim();
  const match = text.match(/^\/snapshot(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const rawArgs = (match[1] || '').trim();
  return {
    args: rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : []
  };
}

function parseRestoreCommand(instruction) {
  const text = String(instruction || '').trim();
  const match = text.match(/^\/restore(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const rawArgs = (match[1] || '').trim();
  return {
    code: rawArgs ? rawArgs.split(/\s+/)[0].trim() : ''
  };
}

function parseInfoCommand(instruction) {
  const text = String(instruction || '').trim();
  return /^\/info(?:@\w+)?(?:\s+.*)?$/i.test(text);
}

function parseWhereCommand(instruction) {
  const text = String(instruction || '').trim();
  return /^\/where(?:@\w+)?(?:\s+.*)?$/i.test(text);
}

function parseSysinfoCommand(instruction) {
  const text = String(instruction || '').trim();
  const match = text.match(/^\/sysinfo(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const argText = (match[1] || '').trim().toLowerCase();
  return {
    json: argText.includes('--json')
  };
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
    this.isManagedByMulti = Boolean(options.isManagedByMulti);
    this.activeTask = null;
    this.activeAbortController = null;
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.taskAgentsTimer = null;
    this.taskAgentsTimerSec = Math.max(0, parseInt(this.config.taskAgentsTimer || 0, 10) || 0);
    this.lastTaskAgentsRead = null;
    this.lastTaskAgentsStatus = '';
    this.lastUpdateCheck = 0;
    this._cachedUsage = null;
    this._lastUsageFetch = 0;
    this._lastConflictLog = 0;
    this._restarting = false;
  }

  logThrottled(msg, intervalMs = 30000) {
    const now = Date.now();
    if (now - this._lastConflictLog >= intervalMs) {
      this._lastConflictLog = now;
      this.log(msg);
    }
  }

  log(msg) {
    const time = formatLocalTimestamp();
    console.log(`[${time}] [${this.workerId}] ${msg}`);
  }

  async getAgyUsageSnapshot() {
    const now = Date.now();
    // Cache usage up to 5 menit agar tidak membebani Cloud Code API
    if (this._cachedUsage && (now - this._lastUsageFetch < 5 * 60 * 1000)) {
      return this._cachedUsage;
    }
    try {
      const rep = await fetchReport();
      this._cachedUsage = rep;
      this._lastUsageFetch = now;
      return rep;
    } catch {
      return this._cachedUsage || null;
    }
  }

  startTaskAgentsTimer(intervalSec) {
    if (this.taskAgentsTimer) {
      clearInterval(this.taskAgentsTimer);
      this.taskAgentsTimer = null;
    }
    const sec = Math.max(0, parseInt(intervalSec, 10) || 0);
    this.taskAgentsTimerSec = sec;
    if (sec > 0 && this.running) {
      this.log(`⏱️ Timer membaca TASK_AGENTS.md aktif setiap ${sec} detik.`);
      this.readTaskAgentsMd();
      this.taskAgentsTimer = setInterval(() => {
        if (!this.running) return;
        this.readTaskAgentsMd();
      }, sec * 1000);
    }
  }

  readTaskAgentsMd() {
    const filePath = path.join(this.workDir, 'TASK_AGENTS.md');
    this.lastTaskAgentsRead = formatLocalTimestamp();
    if (!fs.existsSync(filePath)) {
      this.lastTaskAgentsStatus = 'File TASK_AGENTS.md belum ada';
      return { exists: false, pendingCount: 0 };
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const pendingMatches = content.match(/###\s+\[PENDING\]/gi) || [];
      this.lastTaskAgentsStatus = pendingMatches.length > 0
        ? `Ditemukan ${pendingMatches.length} tugas [PENDING]`
        : `Dibaca (${content.length} byte)`;
      if (this.verbose) {
        this.log(`📄 [TASK_AGENTS.md] ${this.lastTaskAgentsStatus}`);
      }
      return { exists: true, pendingCount: pendingMatches.length };
    } catch (e) {
      this.lastTaskAgentsStatus = `Error: ${e.message}`;
      return { exists: false, error: e.message };
    }
  }

  async restartSelf() {
    if (this._restarting) return;
    this._restarting = true;
    try {
      const scriptPath = path.join(__dirname, '..', '..', 'bin', 'kerakerja.js');
      const args = [scriptPath, 'restart', '--force'];
      if (this.isManagedByMulti) args.push('--all');
      if (this.verbose) args.push('--verbose');
      const child = spawn(process.execPath, args, {
        cwd: this.workDir,
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
      });
      child.unref();
    } catch (e) {
      this.log(`⚠️ Gagal memicu restart otomatis: ${e.message}`);
    }
    await this.stop();
    if (!this.isManagedByMulti) {
      process.exit(0);
    }
  }

  async handleHeartbeatResponse(data) {
    if (!data || typeof data !== 'object') return;

    if (data.task_agents_timer !== undefined && data.task_agents_timer !== null) {
      const serverTimer = Math.max(0, parseInt(data.task_agents_timer, 10) || 0);
      if (serverTimer !== this.taskAgentsTimerSec) {
        this.log(`⏱️ Sinkronisasi timer TASK_AGENTS.md dari dashboard: ${serverTimer} detik.`);
        this.startTaskAgentsTimer(serverTimer);
        try {
          saveConfig({ taskAgentsTimer: serverTimer }, this.workDir);
        } catch {}
      }
    }

    const cmd = String(data.command || '').trim().toLowerCase();
    if (cmd === 'stop' || cmd === 'kill') {
      this.log(`🛑 Menerima perintah ${cmd.toUpperCase()} dari dashboard. Menghentikan worker...`);
      await this.stop();
      if (!this.isManagedByMulti) {
        process.exit(0);
      }
    } else if (cmd === 'restart') {
      this.log(`🔄 Menerima perintah RESTART dari dashboard. Memulai ulang worker...`);
      await this.restartSelf();
    } else if (cmd === 'wakeup') {
      this.log(`🔔 Menerima perintah WAKEUP dari Telegram/Dashboard. Memeriksa antrean segera...`);
      await this.checkAndProcessNextTask();
    } else if (cmd === 'set_timer') {
      const cmdData = (data.command_data && typeof data.command_data === 'object') ? data.command_data : {};
      const timerSec = Math.max(0, parseInt(cmdData.timer ?? data.task_agents_timer ?? 0, 10) || 0);
      this.log(`⏱️ Timer TASK_AGENTS.md diatur ke ${timerSec} detik dari dashboard.`);
      this.startTaskAgentsTimer(timerSec);
      try {
        saveConfig({ taskAgentsTimer: timerSec }, this.workDir);
      } catch {}
    }
  }

  async sendHeartbeat(extraMeta = {}) {
    try {
      const usage = await this.getAgyUsageSnapshot();
      const res = await this.api.registerWorker(this.workerId, {
        agent: this.config.agent,
        workDir: this.workDir,
        hostname: os.hostname(),
        pid: process.pid,
        activeTask: this.activeTask ? this.activeTask.id : null,
        activeTaskTitle: this.activeTask ? String(this.activeTask.instruction || '').substring(0, 140) : '',
        status: this.activeTask ? 'busy' : 'idle',
        taskAgentsTimer: this.taskAgentsTimerSec,
        lastTaskAgentsRead: this.lastTaskAgentsRead || '',
        lastTaskAgentsStatus: this.lastTaskAgentsStatus || '',
        agy_usage: usage,
        ...extraMeta
      });
      if (res && res.data) {
        await this.handleHeartbeatResponse(res.data);
      }
    } catch (e) {
      // Non-blocking
    }
  }

  async start() {
    this.running = true;
    this.log(`KeraKerja Worker dimulai.`);
    this.log(`Target Server : ${this.config.serverUrl}`);
    this.log(`Project ID    : ${this.config.projectId}`);
    this.log(`Agent CLI     : ${this.config.agent}`);
    this.log(`Workdir       : ${this.workDir}`);

    // Register worker with usage snapshot
    try {
      await this.sendHeartbeat();
      this.log(`Terkoneksi & terdaftar di Server Biru.`);
    } catch (e) {
      this.log(`[WARN] Registrasi awal worker gagal: ${e.message}`);
    }

    // Heartbeat every 30s
    this.heartbeatTimer = setInterval(async () => {
      if (!this.running) return;
      await this.sendHeartbeat();
    }, 30000);

    // Start TASK_AGENTS.md timer if configured
    if (this.taskAgentsTimerSec > 0) {
      this.startTaskAgentsTimer(this.taskAgentsTimerSec);
    }

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
    const localLock = isActiveTaskLocked(this.workDir, this.workerId, process.pid);
    if (localLock.locked) {
      const ownerLabel = (localLock.owner && (localLock.owner.executor || localLock.owner.workerId || localLock.owner.taskId)) || 'worker lain';
      this.logThrottled(`⏳ Menunggu eksekusi lokal aktif (${ownerLabel}) selesai sebelum mengambil tugas baru...`);
      return;
    }

    const res = await this.api.pullTasks({ executor: 'cli', workerId: this.workerId });
    if (!res || !res.data) return;

    let tasks = [];
    if (Array.isArray(res.data.tasks)) {
      tasks = res.data.tasks;
    } else if (Array.isArray(res.data)) {
      tasks = res.data;
    }

    const { task: pending, blockedBy, blockedReason } = selectNextCliTask(tasks, this.workerId);
    if (blockedBy) {
      this.logThrottled(`⏳ ${blockedReason}. Menunda eksekusi CLI untuk mencegah bentrok.`);
      return;
    }
    if (!pending) return;

    const killCmd = parseKillCommand(pending.instruction);
    if (killCmd) {
      await this.handleKillInstruction(pending, killCmd);
      return;
    }

    if (parseUpdateCommand(pending.instruction)) {
      await this.handleUpdateInstruction(pending);
      return;
    }

    const parsedSampah = parseSampahCommand(pending.instruction);
    if (parsedSampah) {
      await this.handleSampahInstruction(pending, parsedSampah);
      return;
    }

    const parsedSnapshot = parseSnapshotCommand(pending.instruction);
    if (parsedSnapshot) {
      await this.handleSnapshotInstruction(pending, parsedSnapshot);
      return;
    }

    const parsedRestore = parseRestoreCommand(pending.instruction);
    if (parsedRestore) {
      await this.handleRestoreInstruction(pending, parsedRestore);
      return;
    }

    if (parseInfoCommand(pending.instruction)) {
      await this.handleInfoInstruction(pending);
      return;
    }

    if (parseWhereCommand(pending.instruction)) {
      await this.handleWhereInstruction(pending);
      return;
    }

    const parsedSysinfo = parseSysinfoCommand(pending.instruction);
    if (parsedSysinfo) {
      await this.handleSysinfoInstruction(pending, parsedSysinfo);
      return;
    }

    if (process.env.TELE_IGNORE_LOCAL_QUEUE !== '1') {
      const localQueue = hasLocalQueueInProgress(this.workDir, pending.id);
      if (localQueue.active) {
        let shouldWait = true;
        if (typeof this.api.getStatus === 'function') {
          try {
            const stRes = await this.api.getStatus();
            const srvInProg = stRes && stRes.data && stRes.data.summary
              ? Number(stRes.data.summary.IN_PROGRESS || 0)
              : null;
            if (srvInProg === 0 && !isActiveTaskLocked(this.workDir, this.workerId).locked) {
              let targetStatus = 'PENDING';
              if (typeof this.api.getTask === 'function') {
                try {
                  const tRes = await this.api.getTask(localQueue.taskId);
                  const srvStatus = tRes && tRes.data && tRes.data.task && String(tRes.data.task.status || '').toUpperCase();
                  if (srvStatus && srvStatus !== 'IN_PROGRESS' && srvStatus !== 'RUNNING') {
                    targetStatus = srvStatus;
                  }
                } catch (_) {}
              }
              reconcileLocalQueueStatus(this.workDir, localQueue.taskId, targetStatus);
              this.log(`🔄 Sinkronisasi TASK_QUEUE.md: ${localQueue.taskId} sudah berstatus [${targetStatus}] di server (stale lock dibersihkan).`);
              shouldWait = false;
            }
          } catch (_) {}
        }
        if (shouldWait) {
          this.logThrottled(`⏳ Tugas ${localQueue.taskId} masih [IN_PROGRESS] di TASK_QUEUE.md (worker lain). Menunggu selesai...`);
          return;
        }
      }
    }

    // Pastikan tidak ada tugas lain yang sedang IN_PROGRESS di server (aturan sekuensial per proyek)
    if (typeof this.api.getStatus === 'function') {
      try {
        const statusRes = await this.api.getStatus();
        const inProgCount = statusRes && statusRes.data && statusRes.data.summary
          ? Number(statusRes.data.summary.IN_PROGRESS || 0)
          : 0;
        if (inProgCount > 0) {
          this.logThrottled(`⏳ Masih ada ${inProgCount} tugas [IN_PROGRESS] di server. Menunda #${pending.id} (tetap PENDING).`);
          return;
        }
      } catch (e) {}
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
        this.log(`✅ [AUTO-UPDATE] KeraKerja berhasil diperbarui otomatis ke commit ${remoteCommit.substring(0, 7)}!`);
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

  async handleSampahInstruction(task, options = {}) {
    this.log(`🧹 Memproses perintah /sampah (#${task.id})...`);
    try {
      await this.api.startTask(task.id, this.workerId, this.config.agent);
      const report = cleanTeleVsCliTrash({
        workDir: this.workDir,
        dryRun: Boolean(options.dryRun)
      });

      const tableText = formatCleanupTable(report);
      const htmlReport = formatCleanupTelegramHtml(report, { projectId: this.config.projectId });
      const tgRes = await sendTelegramReport(this.config, htmlReport);

      const summary = `Pembersihan sampah tele-vs-cli selesai (${report.cleanedCount} dihapus, ${report.migratedCount} dimigrasi, ${formatBytes(report.totalBytes)}).\n\n${tableText}`;
      const extra = (tgRes && tgRes.ok) ? { skip_notify: '1' } : {};
      await this.api.doneTask(task.id, summary, '', tableText, extra);
      this.log(`✅ Pembersihan /sampah #${task.id} selesai (Telegram: ${tgRes && tgRes.ok ? 'terkirim' : 'via server'}).`);
    } catch (e) {
      this.log(`❌ Gagal memproses /sampah #${task.id}: ${e.message}`);
      try {
        await this.api.failTask(task.id, `Gagal memproses /sampah: ${e.message}`);
      } catch (err) {}
    }
  }

  async handleSysinfoInstruction(task) {
    this.log(`🖥️ Memproses perintah /sysinfo (#${task.id})...`);
    try {
      await this.api.startTask(task.id, this.workerId, this.config.agent);
      const info = collectSysinfo({ workDir: this.workDir });
      const textReport = formatSysinfoText(info);
      const htmlReport = formatSysinfoTelegramHtml(info, { projectId: this.config.projectId });
      const tgRes = await sendTelegramHtml(this.config, htmlReport);

      const t = info.workerTotals;
      const summary = `Sysinfo ${info.machine.hostname}: ${t.runningCount} worker aktif, Total CPU ${t.totalCpuPercent.toFixed(1)}%, Total RAM ${formatBytes(t.totalMemoryBytes)} (${t.totalMemoryPercent.toFixed(2)}%).\n\n${textReport}`;
      const extra = (tgRes && tgRes.ok) ? { skip_notify: '1' } : {};
      await this.api.doneTask(task.id, summary, '', textReport, extra);
      this.log(`✅ /sysinfo #${task.id} selesai (Telegram: ${tgRes && tgRes.ok ? 'terkirim' : 'via server'}).`);
    } catch (e) {
      this.log(`❌ Gagal memproses /sysinfo #${task.id}: ${e.message}`);
      try {
        await this.api.failTask(task.id, `Gagal memproses /sysinfo: ${e.message}`);
      } catch (err) {}
    }
  }

  async handleSnapshotInstruction(task, parsed) {
    this.log(`📸 Memproses perintah /snapshot (#${task.id})...`);
    try {
      await this.api.startTask(task.id, this.workerId, this.config.agent);
      const resolved = resolveSnapshotInputs(parsed.args || [], this.workDir);
      if (!resolved.ok) {
        await this.api.failTask(task.id, resolved.error);
        return;
      }

      const res = createSnapshot({
        workDir: this.workDir,
        baseCode: resolved.baseCode,
        paramRes: resolved.paramRes,
        projectId: this.config.projectId
      });

      const tgRes = await sendTelegramHtml(this.config, formatSnapshotSuccessHtml(res));
      const summary = `Snapshot '${res.meta.code}' (${res.meta.params}) berhasil dibuat di ${res.snapshotDir} (${formatBytes(res.meta.stats.totalBytes)}).`;
      const extra = (tgRes && tgRes.ok) ? { skip_notify: '1' } : {};
      await this.api.doneTask(task.id, summary, '', '', extra);
      this.log(`✅ Snapshot ${res.meta.code} selesai (#${task.id}).`);
    } catch (e) {
      this.log(`❌ Gagal memproses /snapshot #${task.id}: ${e.message}`);
      try {
        await this.api.failTask(task.id, `Gagal memproses /snapshot: ${e.message}`);
      } catch (err) {}
    }
  }

  async handleRestoreInstruction(task, parsed) {
    this.log(`♻️ Memproses perintah /restore (#${task.id}): target=${parsed.code || '(pilih tombol)'}`);
    try {
      await this.api.startTask(task.id, this.workerId, this.config.agent);
      const res = restoreSnapshot({
        workDir: this.workDir,
        code: parsed.code || ''
      });

      if (!res.ok) {
        const payload = buildRestoreTelegramPayload(res.latest, this.config.projectId);
        const tgRes = await sendTelegramHtml(this.config, payload.html, payload.extra);
        const listText = (res.latest && res.latest.length > 0)
          ? res.latest.map((s) => `• ${s.code} (${s.params}, ${formatBytes(s.totalBytes)})`).join('\n')
          : 'Belum ada snapshot tersedia.';
        const summary = `${res.error}\n\n4 Snapshot Terakhir:\n${listText}`;
        const extra = (tgRes && tgRes.ok) ? { skip_notify: '1' } : {};
        await this.api.doneTask(task.id, summary, '', '', extra);
        return;
      }

      const tgRes = await sendTelegramHtml(this.config, formatRestoreSuccessHtml(res));
      const summary = `Restore snapshot '${res.code}' selesai (Kode ${res.restored.kodeFiles} file, DB ${res.restored.dbFiles} file, Upload ${res.restored.uploadFiles} file).`;
      const extra = (tgRes && tgRes.ok) ? { skip_notify: '1' } : {};
      await this.api.doneTask(task.id, summary, '', '', extra);
      this.log(`✅ Restore ${res.code} selesai (#${task.id}).`);
    } catch (e) {
      this.log(`❌ Gagal memproses /restore #${task.id}: ${e.message}`);
      try {
        await this.api.failTask(task.id, `Gagal memproses /restore: ${e.message}`);
      } catch (err) {}
    }
  }

  async handleInfoInstruction(task) {
    this.log(`ℹ️ Memproses perintah /info (#${task.id})...`);
    try {
      await this.api.startTask(task.id, this.workerId, this.config.agent);
      const info = buildInfoData(this.workDir);
      const tgRes = await sendTelegramHtml(this.config, formatInfoTelegramHtml(info));
      const summary = `KeraKerja v${info.version} (${info.commitHash}) | Update Terakhir: ${info.lastUpdateDate}`;
      const extra = (tgRes && tgRes.ok) ? { skip_notify: '1' } : {};
      await this.api.doneTask(task.id, summary, info.commitHash !== '-' ? info.commitHash : '', '', extra);
      this.log(`✅ Info versi terkirim (#${task.id}): ${summary}`);
    } catch (e) {
      this.log(`❌ Gagal memproses /info #${task.id}: ${e.message}`);
      try {
        await this.api.failTask(task.id, `Gagal memproses /info: ${e.message}`);
      } catch (err) {}
    }
  }

  async handleWhereInstruction(task) {
    this.log(`📂 Memproses perintah /where (#${task.id})...`);
    try {
      await this.api.startTask(task.id, this.workerId, this.config.agent);
      const data = buildWhereData(this.workDir);
      const tgRes = await sendTelegramHtml(this.config, formatWhereTelegramHtml(data));
      const summary = `Direktori kerja aktif: ${data.workDir} (Proyek: ${data.projectId})`;
      const extra = (tgRes && tgRes.ok) ? { skip_notify: '1' } : {};
      await this.api.doneTask(task.id, summary, '', '', extra);
      this.log(`✅ Info direktori kerja terkirim (#${task.id}): ${data.workDir}`);
    } catch (e) {
      this.log(`❌ Gagal memproses /where #${task.id}: ${e.message}`);
      try {
        await this.api.failTask(task.id, `Gagal memproses /where: ${e.message}`);
      } catch (err) {}
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
      // Acquire local execution lock before claiming on server to prevent local race
      writeActiveTask(this.workDir, {
        taskId: task.id,
        pid: null,
        workerPid: process.pid,
        workerId: this.workerId,
        executor: 'cli',
        startedAt: new Date().toISOString()
      });

      // Claim task atomically and verify server accepted our claim
      let claimRes;
      try {
        claimRes = await this.api.startTask(task.id, this.workerId, this.config.agent);
      } catch (claimErr) {
        if (/Server error HTTP 5\d\d|Koneksi timeout|Gagal menghubungi server/i.test(claimErr.message || '')) {
          this.log(`⚠️ Gagal klaim #${task.id} karena gangguan sementara server (${claimErr.message}). Tetap PENDING untuk dicoba ulang otomatis.`);
          return;
        }
        throw claimErr;
      }
      if (!isClaimAccepted(claimRes, this.workerId)) {
        const errMsg = (claimRes && claimRes.data && claimRes.data.error) ? String(claimRes.data.error) : '';
        const isSeqBlock = /IN_PROGRESS|sekuensial|sedang dikerjakan/i.test(errMsg);
        if (isSeqBlock) {
          this.logThrottled(`⏳ Tugas #${task.id} ditunda (${errMsg}). Tetap berada di antrean PENDING.`);
        } else {
          const owner = (claimRes && claimRes.data && claimRes.data.task && (claimRes.data.task.executor || claimRes.data.task.worker_id)) || 'worker/executor lain';
          this.log(`⚠️ Tugas #${task.id} sudah diklaim oleh ${owner}. Membatalkan eksekusi CLI untuk mencegah bentrok.`);
        }
        return;
      }
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
            if (!PENDING_STATUSES.has(String(candidate.status || '').toUpperCase())) continue;
            const parsedKill = parseKillCommand(candidate.instruction);
            if (!parsedKill) continue;
            if (!parsedKill.targetTaskId && !isTaskForCliExecutor(candidate, this.workerId)) continue;
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
            workerPid: process.pid,
            workerId: this.workerId,
            executor: 'cli',
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
    if (this.taskAgentsTimer) {
      clearInterval(this.taskAgentsTimer);
      this.taskAgentsTimer = null;
    }
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
TeleWorker.parseSampahCommand = parseSampahCommand;
TeleWorker.parseInfoCommand = parseInfoCommand;
TeleWorker.parseWhereCommand = parseWhereCommand;
TeleWorker.parseSnapshotCommand = parseSnapshotCommand;
TeleWorker.parseRestoreCommand = parseRestoreCommand;
TeleWorker.parseSysinfoCommand = parseSysinfoCommand;
TeleWorker.normalizeExecutor = normalizeExecutor;
TeleWorker.isCliExecutor = isCliExecutor;
TeleWorker.isTaskForCliExecutor = isTaskForCliExecutor;
TeleWorker.isClaimAccepted = isClaimAccepted;
TeleWorker.selectNextCliTask = selectNextCliTask;

module.exports = TeleWorker;
