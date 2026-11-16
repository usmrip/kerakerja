const { execFile } = require('child_process');
const { promisify } = require('util');
const { loadConfig } = require('../../config/config');
const ApiClient = require('../../api/client');
const { resolveAgent, AGENT_ADAPTERS } = require('../../executor/adapters/registry');
const { getRunningPid } = require('./daemon_ctl');
const { fetchReport, fmtReset } = require('../../utils/agy_usage');

const execFileAsync = promisify(execFile);

function formatRefreshRemaining(resetTimeIso, nowMs = Date.now()) {
  if (!resetTimeIso) return null;
  const resetMs = Date.parse(resetTimeIso);
  if (!Number.isFinite(resetMs)) return null;

  const diffMs = resetMs - nowMs;
  if (diffMs <= 0) return 'Refreshing soon';

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function renderProgressBar(fraction, width = 40) {
  const numeric = Number(fraction);
  const clamped = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
  const filled = Math.round(clamped * width);
  const empty = Math.max(0, width - filled);
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

function parseAgyQuotaOutput(rawOutput, nowMs = Date.now()) {
  if (!rawOutput || typeof rawOutput !== 'string') return null;

  let parsed;
  try {
    parsed = JSON.parse(rawOutput.trim());
  } catch {
    return null;
  }

  const data = parsed?.command?.data;
  if (!data || !Array.isArray(data.groups)) return null;

  const groups = data.groups.map((group) => {
    const buckets = Array.isArray(group.buckets)
      ? group.buckets.map((bucket) => {
          const remainingFraction = Number.isFinite(Number(bucket.remaining_fraction))
            ? Math.max(0, Math.min(1, Number(bucket.remaining_fraction)))
            : 0;
          const remainingPercent = Number((remainingFraction * 100).toFixed(2));
          const refreshesIn = formatRefreshRemaining(bucket.reset_time, nowMs);
          const isFull = remainingFraction >= 0.9999;
          const statusText = isFull
            ? 'Quota available'
            : refreshesIn
              ? (refreshesIn === 'Refreshing soon' ? refreshesIn : `Refreshes in ${refreshesIn}`)
              : (bucket.description || 'Quota active');

          return {
            id: bucket.id || null,
            name: bucket.name || 'Quota Limit',
            window: bucket.window || null,
            remainingFraction,
            remainingPercent,
            resetTime: bucket.reset_time || null,
            refreshesIn,
            statusText
          };
        })
      : [];

    return {
      name: group.name || 'Model Group',
      description: group.description || '',
      buckets
    };
  });

  return {
    description: data.description || null,
    groups
  };
}

function wrapText(text, maxWidth = 76, indent = '  ') {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += ' ' + word;
    } else {
      lines.push(indent + current);
      current = word;
    }
  }
  if (current) lines.push(indent + current);
  return lines;
}

async function fetchAgyModels(binaryPath) {
  const { stdout } = await execFileAsync(binaryPath, ['models'], {
    encoding: 'utf-8',
    timeout: 8000,
    windowsHide: true
  });
  const modelList = [];
  const lines = stdout.split(/\r?\n/).filter(l => l.trim() && !l.toLowerCase().includes('fetching'));
  for (const line of lines) {
    const parts = line.split('\t');
    const id = parts[0]?.trim();
    const name = parts[1]?.trim() || id;
    if (id) modelList.push({ id, name });
  }
  return modelList;
}

async function fetchAgyQuota(binaryPath) {
  try {
    const report = await fetchReport();
    if (report && Array.isArray(report.windows)) {
      return {
        description: report.plan ? `Paket: ${report.plan} ${report.email ? `(${report.email})` : ''}` : null,
        groups: [
          {
            name: 'Limit & Kuota AI (Antigravity Cloud Code)',
            description: 'Pemantauan konsumsi kuota Gemini, Claude & GPT secara real-time.',
            buckets: report.windows.map(w => {
              const remFrac = w.remainingFraction !== null ? w.remainingFraction : Math.max(0, (100 - (w.usedPct || 0)) / 100);
              const remPct = w.usedPct !== null ? Math.round((100 - w.usedPct) * 10) / 10 : 0;
              return {
                id: w.id,
                name: w.label,
                window: w.id,
                remainingFraction: remFrac,
                remainingPercent: remPct,
                resetTime: w.resetsAt,
                refreshesIn: formatRefreshRemaining(w.resetsAt),
                statusText: `Sisa ${remPct}% (reset: ${fmtReset(w.resetsAt)})`
              };
            })
          }
        ]
      };
    }
  } catch (err) {
    // Fallback to CLI flag jika Cloud Code API gagal
  }

  try {
    const { stdout } = await execFileAsync(binaryPath, ['-p', '/quota', '--output-format', 'json'], {
      encoding: 'utf-8',
      timeout: 15000,
      windowsHide: true
    });
    return parseAgyQuotaOutput(stdout);
  } catch {
    return null;
  }
}

async function quotaCommand(args = []) {
  const isJson = args.includes('--json');
  let selectedAgent = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent' && i + 1 < args.length) {
      selectedAgent = args[++i];
    }
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const agentKey = selectedAgent || config.agent || 'agy';
  const workerPid = getRunningPid(cwd);

  const resolved = resolveAgent(agentKey);
  const isInstalled = Boolean(resolved);

  let modelList = [];
  let agyQuota = null;
  let agyQuotaError = null;

  const client = new ApiClient(config.serverUrl, config.secret, config.projectId);
  const statusPromise = client.getStatus();

  if (resolved && resolved.key === 'agy') {
    const [modelsRes, quotaRes] = await Promise.allSettled([
      fetchAgyModels(resolved.binaryPath),
      fetchAgyQuota(resolved.binaryPath)
    ]);

    if (modelsRes.status === 'fulfilled') {
      modelList = modelsRes.value;
    }
    if (quotaRes.status === 'fulfilled' && quotaRes.value) {
      agyQuota = quotaRes.value;
    } else if (quotaRes.status === 'rejected') {
      agyQuotaError = quotaRes.reason?.message || 'Gagal mengambil kuota AGY';
    }
  }

  // Fallback / default common models for display if offline or non-agy
  if (modelList.length === 0) {
    if (agentKey === 'agy' || agentKey === 'auto') {
      modelList = [
        { id: 'gemini-4-argon', name: 'Gemini 4 Argon (Pro / High / Medium / Low)' },
        { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen (Thinking / High / Medium)' },
        { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (High / Medium / Low)' },
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (High / Medium)' },
        { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (High / Medium)' },
        { id: 'gpt-oss-120b', name: 'GPT-OSS 120B (Medium)' }
      ];
    } else if (agentKey === 'claude') {
      modelList = [
        { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet (Hybrid Reasoning)' },
        { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku' }
      ];
    } else if (agentKey === 'gemini') {
      modelList = [
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }
      ];
    }
  }

  // Fetch project status & task metrics from server
  let serverOk = false;
  let serverError = null;
  let completedToday = 0;
  let completedWeek = 0;
  let pendingCount = 0;
  let inProgressCount = 0;
  let failedCount = 0;
  let totalDone = 0;
  let serverProject = null;

  try {
    const res = await statusPromise;
    serverOk = true;
    const data = res && res.data ? res.data : {};
    if (data.summary) {
      pendingCount = Number(data.summary.PENDING || 0);
      inProgressCount = Number(data.summary.IN_PROGRESS || 0);
      totalDone = Number(data.summary.DONE || 0);
      failedCount = Number(data.summary.FAILED || 0);
    }
    if (data.metrics) {
      completedToday = Number(data.metrics.done_today || 0);
      completedWeek = Number(data.metrics.done_week || 0);
    } else {
      completedToday = totalDone;
      completedWeek = totalDone;
    }
    if (data.project) {
      serverProject = data.project;
    }
  } catch (err) {
    serverError = err.message;
  }

  const quotaPayload = {
    agent: {
      key: agentKey,
      name: resolved ? resolved.adapter.name : (AGENT_ADAPTERS[agentKey]?.name || agentKey),
      installed: isInstalled,
      binaryPath: resolved?.binaryPath || null,
      status: isInstalled ? 'READY' : 'NOT_FOUND',
      workerPid: workerPid || null,
      verboseSupported: true
    },
    models: modelList,
    quota: {
      status: 'NORMAL',
      fairUse: 'UNRESTRICTED',
      perModelQuotaSource: agyQuota
        ? 'Antigravity CLI (agy -p /quota)'
        : 'Antigravity IDE/Account (fallback)',
      groups: agyQuota ? agyQuota.groups : [],
      description: agyQuota ? agyQuota.description : null,
      error: agyQuotaError,
      completedToday,
      completedWeek,
      totalDone,
      pendingCount,
      inProgressCount,
      failedCount
    },
    project: {
      id: config.projectId,
      name: serverProject?.name || null,
      code: serverProject?.code || null,
      lastSeen: serverProject?.last_seen || null,
      serverUrl: config.serverUrl,
      connected: serverOk,
      error: serverError
    }
  };

  if (isJson) {
    console.log(JSON.stringify(quotaPayload, null, 2));
    return;
  }

  console.log('==============================================================================');
  console.log('🧠 STATUS KUOTA & AI AGENT AKTIF (TELE-VS-CLI)');
  console.log('==============================================================================');

  console.log(`\n🤖 AI Agent Terpilih : ${quotaPayload.agent.name} [${agentKey}]`);
  console.log(`📍 Path Binary Exec  : ${resolved ? resolved.binaryPath : '❌ Tidak ditemukan di PATH'}`);
  console.log(`🟢 Status Kesiapan   : ${isInstalled ? '✅ 100% SIAP & TERSEDIA' : '❌ Perlu diinstal'}`);
  console.log(`⚡ Background Worker : ${workerPid ? `🟢 AKTIF (PID: ${workerPid})` : '⚪ MATI (Gunakan `tele start --daemon`)'}`);
  console.log(`🔍 Parameter Verbose : ✅ Didukung (--verbose / -v)`);

  if (agyQuota && agyQuota.groups.length > 0) {
    console.log(`\n🔋 Models & Quota Antigravity (Live AGY):`);
    for (const group of agyQuota.groups) {
      console.log(`\n  ${group.name.toUpperCase()}`);
      if (group.description) {
        for (const line of wrapText(group.description, 74, '  ')) {
          console.log(line);
        }
      }
      for (const bucket of group.buckets) {
        const bar = renderProgressBar(bucket.remainingFraction, 40);
        const pct = bucket.remainingPercent.toFixed(2);
        console.log(`\n    ${bucket.name}`);
        console.log(`    ${bar} ${pct}%`);
        console.log(`    ${bucket.statusText}`);
      }
    }
    if (agyQuota.description) {
      console.log('');
      for (const line of wrapText(agyQuota.description, 74, '  ')) {
        console.log(line);
      }
    }
  } else {
    console.log(`\n🔋 Kuota Model Antigravity:`);
    console.log(`  ⚠️  Data kuota live AGY tidak tersedia${agyQuotaError ? ` (${agyQuotaError})` : ''}.`);
  }

  console.log(`\n📊 Daftar Model AI Aktif & Tersedia (${modelList.length} model):`);
  for (const m of modelList) {
    console.log(`  • ${m.name} [${m.id}]`);
  }

  const prjLabel = serverProject?.name ? `${serverProject.name} (#${serverProject.code || config.projectId})` : config.projectId;
  console.log(`\n📈 Metrik Tugas & Kuota (Proyek: ${prjLabel}):`);
  console.log(`  • Tugas Tuntas Hari Ini  : ${completedToday} tugas`);
  console.log(`  • Tugas Tuntas 7 Hari    : ${completedWeek} tugas`);
  console.log(`  • Total Tugas Selesai    : ${totalDone} tugas`);
  console.log(`  • Antrean Pending        : ${pendingCount} tugas`);
  console.log(`  • Sedang Berjalan        : ${inProgressCount} tugas`);
  console.log(`  • Gagal                  : ${failedCount} tugas`);
  console.log(`  • Status Batas Kuota     : 🟢 ${agyQuota ? 'Live AGY Terhubung (per-grup model di atas)' : 'Normal (Sisa % kuota per-model mengikuti akun AGY lokal)'}`);
  console.log(`  • Server Biru Dashboard  : ${config.serverUrl} (${serverOk ? '✅ Terhubung' : '❌ ' + (serverError || 'Error')})`);

  console.log(`\n💡 TIPS PENGGUNAAN:`);
  console.log(`  - Jalankan worker dengan live progress: tele start --verbose`);
  console.log(`  - Kirim tugas dengan streaming log  : tele task "<instruksi>" --verbose`);
  console.log(`  - Cek dari Telegram                 : ketik /quota atau /model di chat bot`);
  console.log('==============================================================================\n');
}

quotaCommand.formatRefreshRemaining = formatRefreshRemaining;
quotaCommand.renderProgressBar = renderProgressBar;
quotaCommand.parseAgyQuotaOutput = parseAgyQuotaOutput;

module.exports = quotaCommand;
