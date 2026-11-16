const { spawn, execSync } = require('child_process');
const BaseExecutor = require('./base');
const { resolveAgent } = require('./adapters/registry');
const { maskSecrets, validateWorkDir } = require('../security/guard');

class CliExecutor extends BaseExecutor {
  constructor(options = {}) {
    super('cli', options);
    this.agent = options.agent || 'auto';
    this.workDir = options.workDir || process.cwd();
    this.timeout = options.timeout || 600000; // 10 menit
  }

  getRecentGitCommit(cwd) {
    try {
      const hash = execSync('git log -1 --format="%h - %s"', { cwd, encoding: 'utf-8', timeout: 3000 }).trim();
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

    const promptText = `Tugas #${task.id || 'CLI'}: ${task.instruction || task.prompt}. Selesaikan dengan baik sesuai standar proyek.`;
    const args = adapter.getArgs(promptText);

    console.log(`[EXECUTOR-CLI] Menjalankan agent '${adapter.name}' (${binaryPath})`);
    console.log(`[EXECUTOR-CLI] Direktori kerja: ${cwd}`);

    return new Promise((resolve, reject) => {
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let isTimedOut = false;

      const child = spawn(binaryPath, args, {
        cwd,
        env: { ...process.env, TELE_TASK_ID: task.id || '' },
        shell: process.platform === 'win32' && binaryPath.endsWith('.cmd')
      });

      const timer = setTimeout(() => {
        isTimedOut = true;
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /pid ${child.pid} /T /F 2>nul`);
          } else {
            process.kill(-child.pid, 'SIGKILL');
          }
        } catch (e) {}
        reject(new Error(`Eksekusi tugas #${task.id} timeout setelah ${this.timeout / 1000} detik`));
      }, this.timeout);

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdoutBuffer += text;
        if (stdoutBuffer.length > 50000) {
          stdoutBuffer = stdoutBuffer.substring(stdoutBuffer.length - 50000);
        }
      });

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderrBuffer += text;
        if (stderrBuffer.length > 20000) {
          stderrBuffer = stderrBuffer.substring(stderrBuffer.length - 20000);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Gagal spawn process '${binaryPath}': ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (isTimedOut) return;

        const latestCommit = this.getRecentGitCommit(cwd);
        const newCommit = (latestCommit && latestCommit !== initialCommit) ? latestCommit : '';

        const fullLog = maskSecrets(`--- STDOUT ---\n${stdoutBuffer}\n--- STDERR ---\n${stderrBuffer}`);
        const cleanStdout = stdoutBuffer.trim();
        const summary = cleanStdout ? cleanStdout.split('\n').slice(-5).join(' ').substring(0, 300) : `Selesai dengan exit code ${code}`;

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
