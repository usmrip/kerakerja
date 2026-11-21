const { spawn, execSync } = require('child_process');
const BaseExecutor = require('./base');
const { resolveAgent } = require('./adapters/registry');
const { maskSecrets, validateWorkDir } = require('../security/guard');
const { killProcessTree } = require('../utils/process');
const { buildTaskPrompt, extractTaskSummary } = require('./report');

class CliExecutor extends BaseExecutor {
  constructor(options = {}) {
    super('cli', options);
    this.agent = options.agent || 'auto';
    this.workDir = options.workDir || process.cwd();
    this.timeout = options.timeout || 600000; // 10 menit
    this.verbose = Boolean(options.verbose || process.env.TELE_VERBOSE);
  }

  getRecentGitCommit(cwd) {
    try {
      const hash = execSync('git log -1 --format="%h - %s"', { cwd, encoding: 'utf-8', timeout: 3000, windowsHide: true }).trim();
      return hash || '';
    } catch (e) {
      return '';
    }
  }

  async execute(task, context = {}) {
    const cwd = validateWorkDir(context.workDir || this.workDir);
    const agentChoice = task.agent || context.agent || this.agent;
    const resolved = resolveAgent(agentChoice);

    if (!resolved) {
      throw new Error(`Tidak ada CLI AI Agent yang terpasang di sistem untuk '${agentChoice}'. Pasang agy, claude, gemini, atau cline.`);
    }

    const { adapter, binaryPath, key } = resolved;
    const initialCommit = this.getRecentGitCommit(cwd);

    const rawInstruction = task.instruction || task.prompt || '';
    const hasVerboseFlag = /\b--verbose\b/i.test(rawInstruction) || /\b-v\b/.test(rawInstruction);
    const isVerbose = Boolean(
      context.verbose !== undefined ? context.verbose :
      (task.verbose !== undefined ? task.verbose :
      (hasVerboseFlag || this.verbose))
    );

    const cleanInstruction = rawInstruction
      .replace(/\s*--verbose\b/gi, '')
      .replace(/\s*-v\b/g, '')
      .trim();

    const promptText = buildTaskPrompt(task, cleanInstruction || rawInstruction);
    const args = adapter.getArgs(promptText);

    console.log(`[EXECUTOR-CLI] Menjalankan agent '${adapter.name}' (${binaryPath})`);
    console.log(`[EXECUTOR-CLI] Direktori kerja: ${cwd}`);
    if (isVerbose) {
      console.log(`[EXECUTOR-CLI] [VERBOSE] Mode verbose aktif untuk #${task.id || 'CLI'}. Menampilkan progres berjalan...`);
    }

    return new Promise((resolve, reject) => {
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let isTimedOut = false;
      let isKilled = false;

      if (context.signal && context.signal.aborted) {
        return resolve({
          success: false,
          killed: true,
          summary: `Eksekusi tugas #${task.id || 'CLI'} dihentikan paksa (/kill).`,
          commitHash: '',
          log: '',
          agent: key
        });
      }

      const child = spawn(binaryPath, args, {
        cwd,
        env: { ...process.env, TELE_TASK_ID: task.id || '', TELE_VERBOSE: isVerbose ? '1' : '' },
        shell: process.platform === 'win32' && binaryPath.endsWith('.cmd'),
        windowsHide: true
      });

      if (typeof context.onSpawn === 'function') {
        try { context.onSpawn(child); } catch (e) {}
      }

      const onAbort = () => {
        if (isTimedOut || isKilled) return;
        isKilled = true;
        clearTimeout(timer);
        killProcessTree(child.pid);
        const fullLog = maskSecrets(`--- STDOUT ---\n${stdoutBuffer}\n--- STDERR ---\n${stderrBuffer}`);
        resolve({
          success: false,
          killed: true,
          summary: `Eksekusi tugas #${task.id || 'CLI'} dihentikan paksa (/kill).`,
          commitHash: '',
          log: fullLog,
          agent: key
        });
      };

      if (context.signal) {
        context.signal.addEventListener('abort', onAbort, { once: true });
      }

      const timer = setTimeout(() => {
        if (isKilled) return;
        isTimedOut = true;
        if (context.signal) {
          context.signal.removeEventListener('abort', onAbort);
        }
        killProcessTree(child.pid);
        reject(new Error(`Eksekusi tugas #${task.id} timeout setelah ${this.timeout / 1000} detik`));
      }, this.timeout);

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdoutBuffer += text;
        if (stdoutBuffer.length > 50000) {
          stdoutBuffer = stdoutBuffer.substring(stdoutBuffer.length - 50000);
        }
        if (isVerbose) {
          process.stdout.write(`[PROGRESS #${task.id || 'CLI'}] ${text}`);
        }
        if (typeof context.onProgress === 'function') {
          try { context.onProgress(text, false); } catch (e) {}
        }
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderrBuffer += text;
        if (stderrBuffer.length > 20000) {
          stderrBuffer = stderrBuffer.substring(stderrBuffer.length - 20000);
        }
        if (isVerbose) {
          process.stderr.write(`[PROGRESS-ERR #${task.id || 'CLI'}] ${text}`);
        }
        if (typeof context.onProgress === 'function') {
          try { context.onProgress(text, true); } catch (e) {}
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (context.signal) context.signal.removeEventListener('abort', onAbort);
        if (isKilled) return;
        reject(new Error(`Gagal spawn process '${binaryPath}': ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (context.signal) context.signal.removeEventListener('abort', onAbort);
        if (isTimedOut || isKilled) return;

        const latestCommit = this.getRecentGitCommit(cwd);
        const newCommit = (latestCommit && latestCommit !== initialCommit) ? latestCommit : '';

        const fullLog = maskSecrets(`--- STDOUT ---\n${stdoutBuffer}\n--- STDERR ---\n${stderrBuffer}`);
        const summary = extractTaskSummary(stdoutBuffer, stderrBuffer, code);

        if (code === 0) {
          resolve({
            success: true,
            summary: maskSecrets(summary),
            commitHash: newCommit,
            log: fullLog,
            agent: key
          });
        } else {
          resolve({
            success: false,
            summary: `Agent gagal dengan exit code ${code}: ${maskSecrets(summary)}`,
            commitHash: newCommit,
            log: fullLog,
            agent: key
          });
        }
      });
    });
  }
}

module.exports = CliExecutor;
