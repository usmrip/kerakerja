const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig } = require('../../config/config');
const { loadWorkspaces, getGlobalWorkspacesPath, getGlobalDir } = require('../../config/workspaces');
const { sendTelegramHtml, escapeTelegramHtml } = require('../../utils/telegram');
const { formatBytes } = require('./sampah');

function formatUptime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}h`);
  if (hours > 0 || days > 0) parts.push(`${hours}j`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

function isProcessAlive(pid) {
  const num = Number(pid);
  if (!Number.isInteger(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

function readPidSafe(pidFile) {
  try {
    if (!fs.existsSync(pidFile)) return null;
    const raw = fs.readFileSync(pidFile, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    return null;
  }
}

function isWorkerCommandLine(cmdLine = '') {
  const text = String(cmdLine || '').toLowerCase();
  if (!text) return false;
  if (text.includes('kerakerja') && (text.includes('start') || text.includes('worker') || text.includes('multi_worker'))) {
    return true;
  }
  if (text.includes('multi_worker.js') || text.includes('worker\\worker.js') || text.includes('worker/worker.js')) {
    return true;
  }
  if (text.includes('tele-worker.js')) {
    return true;
  }
  return false;
}

function collectKnownWorkerPids(workDir, workspacesFile = getGlobalWorkspacesPath()) {
  const known = new Map();

  const multiPid = readPidSafe(path.join(getGlobalDir(), 'multi-worker.pid'));
  if (multiPid && isProcessAlive(multiPid)) {
    known.set(multiPid, {
      pid: multiPid,
      label: 'multi-worker',
      mode: 'multi-project',
      workDir: ''
    });
  }

  const localPidFiles = [
    path.join(workDir, 'kerakerja-worker.pid'),
    path.join(workDir, 'tele-worker.pid')
  ];
  for (const pf of localPidFiles) {
    const pid = readPidSafe(pf);
    if (pid && isProcessAlive(pid) && !known.has(pid)) {
      known.set(pid, {
        pid,
        label: path.basename(workDir) || 'local',
        mode: 'single-project',
        workDir
      });
    }
  }

  const registered = loadWorkspaces(workspacesFile);
  for (const ws of registered) {
    if (!ws || !ws.workDir) continue;
    const pid = readPidSafe(path.join(ws.workDir, 'kerakerja-worker.pid'));
    if (pid && isProcessAlive(pid) && !known.has(pid)) {
      known.set(pid, {
        pid,
        label: ws.projectId || path.basename(ws.workDir),
        mode: 'single-project',
        workDir: ws.workDir
      });
    }
  }

  return known;
}

function queryWindowsNodeProcesses(cpuCores = 1) {
  const psScript = [
    '$procs = Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Select-Object ProcessId, WorkingSetSize, CommandLine;',
    '$perf = @{};',
    'Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name like \'node%\'" | ForEach-Object { $perf[[int]$_.IDProcess] = @{ cpu = [double]$_.PercentProcessorTime; mem = [double]$_.WorkingSetPrivate } };',
    '$out = @();',
    'foreach ($p in $procs) {',
    '  $id = [int]$p.ProcessId;',
    '  $pf = $perf[$id];',
    '  $cpu = if ($pf) { $pf.cpu } else { 0 };',
    '  $mem = if ($pf -and $pf.mem -gt 0) { $pf.mem } else { [double]$p.WorkingSetSize };',
    '  $out += [PSCustomObject]@{ pid = $id; cpuRaw = $cpu; memoryBytes = $mem; cmd = [string]$p.CommandLine };',
    '}',
    '$out | ConvertTo-Json -Compress'
  ].join(' ');

  try {
    const raw = execFileSync('powershell', ['-NoProfile', '-Command', psScript], {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 8000
    }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const cores = Math.max(1, cpuCores);
    return list.map((item) => ({
      pid: Number(item.pid),
      cpuPercent: Number((Math.max(0, Number(item.cpuRaw) || 0) / cores).toFixed(1)),
      memoryBytes: Math.max(0, Math.round(Number(item.memoryBytes) || 0)),
      commandLine: String(item.cmd || '')
    })).filter((p) => Number.isInteger(p.pid) && p.pid > 0);
  } catch (e) {
    return [];
  }
}

function queryUnixNodeProcesses() {
  try {
    const raw = execFileSync('ps', ['-eo', 'pid=,pcpu=,rss=,args='], {
      encoding: 'utf-8',
      timeout: 5000
    });
    const rows = [];
    for (const line of raw.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+([\d.,]+)\s+(\d+)\s+(.+)$/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      const cpuPercent = parseFloat(m[2].replace(',', '.')) || 0;
      const memoryBytes = (parseInt(m[3], 10) || 0) * 1024;
      const commandLine = m[4] || '';
      rows.push({
        pid,
        cpuPercent: Number(cpuPercent.toFixed(1)),
        memoryBytes,
        commandLine
      });
    }
    return rows;
  } catch (e) {
    return [];
  }
}

function getMachineInfo() {
  const cpus = os.cpus() || [];
  const cpuCores = Math.max(1, cpus.length);
  const cpuModel = (cpus[0] && cpus[0].model) ? cpus[0].model.trim() : 'Unknown CPU';
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const usedMemBytes = Math.max(0, totalMemBytes - freeMemBytes);
  const memUsedPercent = totalMemBytes > 0
    ? Number(((usedMemBytes / totalMemBytes) * 100).toFixed(1))
    : 0;
  const loadAvg = os.loadavg ? os.loadavg() : [0, 0, 0];

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel,
    cpuCores,
    loadAvg: loadAvg.map((v) => Number((Number(v) || 0).toFixed(2))),
    totalMemBytes,
    usedMemBytes,
    freeMemBytes,
    memUsedPercent,
    uptimeSeconds: Math.floor(os.uptime()),
    nodeVersion: process.version
  };
}

function collectSysinfo(options = {}) {
  const workDir = options.workDir || process.cwd();
  const workspacesFile = options.workspacesFile || getGlobalWorkspacesPath();
  const machine = getMachineInfo();
  const known = collectKnownWorkerPids(workDir, workspacesFile);

  const osProcs = (typeof options.processScanner === 'function')
    ? options.processScanner(machine.cpuCores)
    : (process.platform === 'win32'
      ? queryWindowsNodeProcesses(machine.cpuCores)
      : queryUnixNodeProcesses());

  const procMap = new Map();
  for (const p of osProcs) {
    procMap.set(p.pid, p);
  }

  const workersMap = new Map();

  // Masukkan seluruh worker yang terdeteksi dari PID file
  for (const [pid, meta] of known.entries()) {
    const proc = procMap.get(pid);
    const memoryBytes = proc ? proc.memoryBytes : 0;
    const cpuPercent = proc ? proc.cpuPercent : 0;
    workersMap.set(pid, {
      pid,
      label: meta.label,
      mode: meta.mode,
      workDir: meta.workDir,
      cpuPercent,
      memoryBytes,
      memoryPercent: machine.totalMemBytes > 0
        ? Number(((memoryBytes / machine.totalMemBytes) * 100).toFixed(2))
        : 0
    });
  }

  // Tambahkan proses worker KeraKerja lain yang ditemukan lewat OS process scan
  for (const proc of osProcs) {
    if (workersMap.has(proc.pid)) continue;
    if (!isWorkerCommandLine(proc.commandLine)) continue;
    const isMulti = proc.commandLine.toLowerCase().includes('multi_worker') ||
      proc.commandLine.toLowerCase().includes('--all');
    workersMap.set(proc.pid, {
      pid: proc.pid,
      label: isMulti ? 'multi-worker' : 'kerakerja-worker',
      mode: isMulti ? 'multi-project' : 'single-project',
      workDir: '',
      cpuPercent: proc.cpuPercent,
      memoryBytes: proc.memoryBytes,
      memoryPercent: machine.totalMemBytes > 0
        ? Number(((proc.memoryBytes / machine.totalMemBytes) * 100).toFixed(2))
        : 0
    });
  }

  const workers = Array.from(workersMap.values()).sort((a, b) => a.pid - b.pid);
  const totalCpuPercent = Number(
    workers.reduce((sum, w) => sum + (Number(w.cpuPercent) || 0), 0).toFixed(1)
  );
  const totalMemoryBytes = workers.reduce((sum, w) => sum + (Number(w.memoryBytes) || 0), 0);
  const totalMemoryPercent = machine.totalMemBytes > 0
    ? Number(((totalMemoryBytes / machine.totalMemBytes) * 100).toFixed(2))
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    machine,
    workers,
    workerTotals: {
      runningCount: workers.length,
      totalCpuPercent,
      totalMemoryBytes,
      totalMemoryPercent
    }
  };
}

function padCell(value, width) {
  const str = String(value || '');
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

function formatWorkersTable(workers) {
  if (!workers || workers.length === 0) {
    return 'Tidak ada worker KeraKerja yang sedang berjalan.';
  }
  const rows = workers.map((w, idx) => ({
    no: String(idx + 1),
    pid: String(w.pid),
    label: String(w.label || w.mode),
    cpu: `${w.cpuPercent.toFixed(1)}%`,
    mem: formatBytes(w.memoryBytes),
    ramPct: `${w.memoryPercent.toFixed(2)}%`
  }));

  const wNo = Math.max(2, ...rows.map((r) => r.no.length));
  const wPid = Math.max(3, ...rows.map((r) => r.pid.length));
  const wLabel = Math.min(22, Math.max(6, ...rows.map((r) => r.label.length)));
  const wCpu = Math.max(5, ...rows.map((r) => r.cpu.length));
  const wMem = Math.max(6, ...rows.map((r) => r.mem.length));
  const wRam = Math.max(5, ...rows.map((r) => r.ramPct.length));

  const sep = `+-${'-'.repeat(wNo)}-+-${'-'.repeat(wPid)}-+-${'-'.repeat(wLabel)}-+-${'-'.repeat(wCpu)}-+-${'-'.repeat(wMem)}-+-${'-'.repeat(wRam)}-+`;
  const header = `| ${padCell('No', wNo)} | ${padCell('PID', wPid)} | ${padCell('Worker', wLabel)} | ${padCell('CPU', wCpu)} | ${padCell('Memory', wMem)} | ${padCell('% RAM', wRam)} |`;
  const lines = [sep, header, sep];
  for (const r of rows) {
    lines.push(`| ${padCell(r.no, wNo)} | ${padCell(r.pid, wPid)} | ${padCell(r.label, wLabel)} | ${padCell(r.cpu, wCpu)} | ${padCell(r.mem, wMem)} | ${padCell(r.ramPct, wRam)} |`);
  }
  lines.push(sep);
  return lines.join('\n');
}

function formatSysinfoText(info) {
  const m = info.machine;
  const t = info.workerTotals;
  const lines = [
    '==============================================================================',
    '🖥️  SYSTEM INFO & WORKER USAGE (KERAKERJA)',
    '==============================================================================',
    `Hostname   : ${m.hostname}`,
    `OS         : ${m.platform} ${m.release} (${m.arch})`,
    `CPU        : ${m.cpuModel} (${m.cpuCores} core)`,
    `Memory     : ${formatBytes(m.usedMemBytes)} / ${formatBytes(m.totalMemBytes)} (${m.memUsedPercent}% terpakai, ${formatBytes(m.freeMemBytes)} bebas)`,
    ...(m.platform !== 'win32' ? [`Load Avg   : ${m.loadAvg.join(', ')}`] : []),
    `Uptime     : ${formatUptime(m.uptimeSeconds)}`,
    `Node.js    : ${m.nodeVersion}`,
    '',
    `⚙️  WORKER KERAKERJA AKTIF (${t.runningCount} running):`,
    formatWorkersTable(info.workers),
    '',
    '📊 TOTAL USAGE SYSTEM WORKER KERAKERJA:',
    `   • Worker Running : ${t.runningCount} proses`,
    `   • Total CPU      : ${t.totalCpuPercent.toFixed(1)}%`,
    `   • Total Memory   : ${formatBytes(t.totalMemoryBytes)} (${t.totalMemoryPercent.toFixed(2)}% dari RAM mesin)`
  ];
  return lines.join('\n');
}

function formatSysinfoTelegramHtml(info, options = {}) {
  const m = info.machine;
  const t = info.workerTotals;
  const table = formatWorkersTable(info.workers);
  const projectLine = options.projectId
    ? `📁 <b>Proyek:</b> <code>${escapeTelegramHtml(options.projectId)}</code>\n`
    : '';

  return [
    '🖥️ <b>SYSTEM INFO &amp; WORKER USAGE (KERAKERJA)</b>',
    '━━━━━━━━━━━━━━━━━━━━━━',
    projectLine +
    `💻 <b>Mesin:</b> <code>${escapeTelegramHtml(m.hostname)}</code> (${escapeTelegramHtml(m.platform)} ${escapeTelegramHtml(m.arch)})`,
    `🧠 <b>CPU:</b> ${escapeTelegramHtml(m.cpuModel)} (<code>${m.cpuCores}</code> core)`,
    `💾 <b>RAM Mesin:</b> <code>${escapeTelegramHtml(formatBytes(m.usedMemBytes))}</code> / <code>${escapeTelegramHtml(formatBytes(m.totalMemBytes))}</code> (<code>${m.memUsedPercent}%</code>)`,
    `⏱️ <b>Uptime:</b> <code>${escapeTelegramHtml(formatUptime(m.uptimeSeconds))}</code> | <b>Node:</b> <code>${escapeTelegramHtml(m.nodeVersion)}</code>`,
    '',
    `⚙️ <b>Worker Running (${t.runningCount}):</b>`,
    `<pre>${escapeTelegramHtml(table)}</pre>`,
    '📊 <b>Total Usage Worker KeraKerja:</b>',
    `• <b>Worker Aktif:</b> <code>${t.runningCount}</code> proses`,
    `• <b>Total CPU:</b> <code>${t.totalCpuPercent.toFixed(1)}%</code>`,
    `• <b>Total Memory:</b> <code>${escapeTelegramHtml(formatBytes(t.totalMemoryBytes))}</code> (<code>${t.totalMemoryPercent.toFixed(2)}%</code> RAM mesin)`
  ].join('\n');
}

async function sysinfoCommand(args = []) {
  const isJson = args.includes('--json');
  const sendTg = args.includes('--telegram');
  const workDir = process.cwd();
  const info = collectSysinfo({ workDir });

  if (isJson) {
    console.log(JSON.stringify(info, null, 2));
    return info;
  }

  console.log(formatSysinfoText(info));

  if (sendTg) {
    const cfg = loadConfig(workDir);
    const html = formatSysinfoTelegramHtml(info, { projectId: cfg.projectId });
    const res = await sendTelegramHtml(cfg, html);
    if (res && res.ok) {
      console.log('\n📨 Laporan /sysinfo terkirim ke Telegram.');
    } else {
      console.log(`\n⚠️ Gagal mengirim ke Telegram: ${(res && res.error) || 'Unknown error'}`);
    }
  }

  return info;
}

module.exports = {
  sysinfoCommand,
  collectSysinfo,
  getMachineInfo,
  formatSysinfoText,
  formatSysinfoTelegramHtml,
  formatWorkersTable,
  formatUptime,
  isWorkerCommandLine
};
