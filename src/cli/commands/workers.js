const path = require('path');
const { loadConfig } = require('../../config/config');
const { getGlobalWorkspacesPath } = require('../../config/workspaces');
const ApiClient = require('../../api/client');
const { escapeTelegramHtml } = require('../../utils/telegram');
const { collectKnownWorkerPids } = require('./sysinfo');

/**
 * Parse CLI arguments for `kerakerja workers`.
 * @param {string[]} [args]
 */
function parseWorkersArgs(args = []) {
  const opts = {
    json: false,
    onlineOnly: false,
    offlineOnly: false,
    localOnly: false,
    all: true,
    filter: ''
  };

  for (const arg of args) {
    const raw = String(arg || '').trim();
    const low = raw.toLowerCase();
    if (!low) continue;
    if (low === '--json') opts.json = true;
    else if (low === '--online' || low === 'online' || low === 'aktif') opts.onlineOnly = true;
    else if (low === '--offline' || low === 'offline') opts.offlineOnly = true;
    else if (low === '--local') opts.localOnly = true;
    else if (low === '--project') opts.all = false;
    else if (!low.startsWith('-')) opts.filter = raw;
  }

  return opts;
}

function sortWorkers(workers = []) {
  return [...workers].sort((a, b) => {
    const aOn = a.is_online ? 1 : 0;
    const bOn = b.is_online ? 1 : 0;
    if (aOn !== bOn) return bOn - aOn;
    const aBusy = a.display_status === 'BUSY' ? 1 : 0;
    const bBusy = b.display_status === 'BUSY' ? 1 : 0;
    if (aBusy !== bBusy) return bBusy - aBusy;
    const aTs = a.last_seen ? Date.parse(a.last_seen) || 0 : 0;
    const bTs = b.last_seen ? Date.parse(b.last_seen) || 0 : 0;
    return bTs - aTs;
  });
}

function filterWorkersList(workers = [], opts = {}) {
  let list = [...workers];
  if (opts.onlineOnly) {
    list = list.filter((w) => Boolean(w.is_online));
  } else if (opts.offlineOnly) {
    list = list.filter((w) => !w.is_online);
  }

  if (opts.filter) {
    const q = opts.filter.toLowerCase().replace(/^#+/, '');
    list = list.filter((w) => {
      const code = String(w.project_code || '').toLowerCase();
      const name = String(w.project_name || '').toLowerCase();
      const host = String(w.hostname || '').toLowerCase();
      const wid = String(w.worker_id || '').toLowerCase();
      return code === q || name.includes(q) || host.includes(q) || wid.includes(q);
    });
  }

  return sortWorkers(list);
}

/**
 * Fetch worker inventory from server API and local PID files.
 * @param {object} [options]
 */
async function fetchWorkersData(options = {}) {
  const workDir = path.resolve(options.workDir || process.cwd());
  const workspacesFile = options.workspacesFile || getGlobalWorkspacesPath();
  const config = options.config || loadConfig(workDir);

  const localMap = collectKnownWorkerPids(workDir, workspacesFile);
  const localWorkers = Array.from(localMap.values());

  let serverOk = false;
  let serverError = '';
  let rawServerWorkers = [];

  if (!options.localOnly && config.serverUrl && config.secret) {
    try {
      const client = options.apiClient || new ApiClient(config.serverUrl, config.secret, config.projectId);
      const res = await client.getWorkers({ all: options.all !== false });
      if (res && res.data && res.data.ok) {
        serverOk = true;
        rawServerWorkers = Array.isArray(res.data.workers) ? res.data.workers : [];
      } else {
        serverError = (res && res.data && res.data.error) || 'Respons server tidak valid';
      }
    } catch (err) {
      serverError = err.message;
    }
  } else if (!config.serverUrl || !config.secret) {
    serverError = 'Konfigurasi server/secret belum disetel';
  }

  const serverWorkers = filterWorkersList(rawServerWorkers, options);

  let online = 0;
  let busy = 0;
  let idle = 0;
  let offline = 0;
  for (const w of serverWorkers) {
    if (w.is_online) {
      online++;
      if (w.display_status === 'BUSY') busy++;
      else idle++;
    } else {
      offline++;
    }
  }

  return {
    workDir,
    projectId: config.projectId || '-',
    serverOk,
    serverError,
    serverWorkers,
    localWorkers,
    summary: {
      total: serverWorkers.length,
      online,
      busy,
      idle,
      offline,
      localRunning: localWorkers.length
    }
  };
}

/**
 * Format worker list as Telegram HTML.
 * @param {Awaited<ReturnType<typeof fetchWorkersData>>} data
 */
function formatWorkersTelegramHtml(data) {
  const workers = Array.isArray(data && data.serverWorkers) ? data.serverWorkers : [];
  const s = (data && data.summary) || { total: workers.length, online: 0, busy: 0, idle: 0, offline: 0 };

  if (workers.length === 0) {
    return (
      `🤖 <b>DAFTAR WORKER</b>\n`
      + `━━━━━━━━━━━━━━━━━━━━━━\n`
      + `⚪ <i>Tidak ada worker terdaftar.</i>\n\n`
      + `💡 Jalankan di terminal workstation:\n`
      + `<code>kerakerja start --daemon</code>`
    );
  }

  const lines = workers.slice(0, 15).map((wk, idx) => {
    const st = wk.display_status || (wk.is_online ? 'IDLE' : 'OFFLINE');
    const badge = st === 'BUSY' ? '⚙️ <b>BUSY</b>'
      : st === 'IDLE' ? '🟢 <b>IDLE</b>'
      : st === 'STOPPED' ? '🛑 <b>STOPPED</b>'
      : '⚪ <b>OFFLINE</b>';

    const host = escapeTelegramHtml(wk.hostname || wk.worker_id || 'worker');
    const pidStr = wk.pid ? `PID <code>${Number(wk.pid)}</code>` : 'PID -';
    const osStr = escapeTelegramHtml([wk.platform, wk.arch].filter(Boolean).join('/') || '-');
    const agentStr = escapeTelegramHtml(wk.agent || 'auto');
    const agoStr = escapeTelegramHtml(wk.last_seen_ago || '-');

    let prjLabel = 'Global / Multi';
    if (wk.project_name) {
      const codePart = wk.project_code ? ` #${escapeTelegramHtml(wk.project_code)}` : '';
      prjLabel = `${escapeTelegramHtml(wk.project_name)}${codePart}`;
    }

    let entry = `${idx + 1}. ${badge} — <b>${host}</b> (${pidStr})\n`
      + `   📁 <b>Proyek:</b> <code>${prjLabel}</code> | 🤖 <code>${agentStr}</code>\n`
      + `   💻 <code>${osStr}</code> | 🕒 <i>${agoStr}</i>`;

    if (wk.work_dir) {
      entry += `\n   📂 <code>${escapeTelegramHtml(String(wk.work_dir))}</code>`;
    }
    if (st === 'BUSY' && wk.active_task_id) {
      const tid = `#${String(wk.active_task_id).replace(/^#+/, '')}`;
      const title = wk.active_task_title ? ` — ${escapeTelegramHtml(String(wk.active_task_title).slice(0, 50))}` : '';
      entry += `\n   📌 <b>Tugas:</b> <code>${escapeTelegramHtml(tid)}</code>${title}`;
    }
    return entry;
  });

  if (workers.length > 15) {
    lines.push(`<i>... dan ${workers.length - 15} worker lainnya.</i>`);
  }

  return (
    `🤖 <b>DAFTAR WORKER</b>\n`
    + `📊 <b>Total:</b> ${s.total} | 🟢 <b>Online:</b> ${s.online} (⚙️ ${s.busy} | 💤 ${s.idle}) | ⚪ <b>Offline:</b> ${s.offline}\n`
    + `━━━━━━━━━━━━━━━━━━━━━━\n\n`
    + lines.join('\n\n')
  );
}

/**
 * CLI handler for `kerakerja workers`.
 * @param {string[]} [args]
 */
async function workersCommand(args = []) {
  const opts = parseWorkersArgs(args);
  const data = await fetchWorkersData(opts);

  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return data;
  }

  console.log('==============================================================================');
  console.log('🤖 DAFTAR WORKER KERAKERJA');
  console.log('==============================================================================');

  if (!opts.localOnly) {
    if (!data.serverOk) {
      console.log(`⚠️  Server Workers: Tidak dapat mengambil dari server (${data.serverError})`);
    } else {
      const s = data.summary;
      console.log(`📊 Server Workers: Total ${s.total} | Online ${s.online} (Busy ${s.busy}, Idle ${s.idle}) | Offline ${s.offline}`);
      if (data.serverWorkers.length === 0) {
        console.log('   (Belum ada worker terdaftar di server)');
      } else {
        console.log('');
        data.serverWorkers.forEach((wk, i) => {
          const st = wk.display_status || (wk.is_online ? 'IDLE' : 'OFFLINE');
          const icon = st === 'BUSY' ? '⚙️' : st === 'IDLE' ? '🟢' : st === 'STOPPED' ? '🛑' : '⚪';
          const host = wk.hostname || wk.worker_id || 'worker';
          const pid = wk.pid ? `PID ${wk.pid}` : 'PID -';
          const prj = wk.project_name
            ? `${wk.project_name}${wk.project_code ? ` (#${wk.project_code})` : ''}`
            : 'Global / Multi';
          const osStr = [wk.platform, wk.arch].filter(Boolean).join('/') || '-';
          console.log(`  ${i + 1}. ${icon} [${st}] ${host} (${pid})`);
          console.log(`     Proyek : ${prj} | Agent: ${wk.agent || 'auto'} | OS: ${osStr}`);
          console.log(`     Terlihat: ${wk.last_seen_ago || '-'}`);
          if (wk.work_dir) console.log(`     Folder : ${wk.work_dir}`);
          if (st === 'BUSY' && wk.active_task_id) {
            const tid = `#${String(wk.active_task_id).replace(/^#+/, '')}`;
            console.log(`     Tugas  : ${tid}${wk.active_task_title ? ` - ${wk.active_task_title}` : ''}`);
          }
          if (wk.pending_command) {
            console.log(`     Pending: /${wk.pending_command}`);
          }
        });
      }
    }
  }

  console.log('------------------------------------------------------------------------------');
  console.log(`💻 Local Worker Processes (Mesin Ini): ${data.localWorkers.length} aktif`);
  if (data.localWorkers.length === 0) {
    console.log('   ⚪ Tidak ada proses worker lokal yang sedang berjalan.');
  } else {
    data.localWorkers.forEach((lw, i) => {
      console.log(`   ${i + 1}. 🟢 PID ${lw.pid} [${lw.mode}] — ${lw.label}${lw.workDir ? ` (${lw.workDir})` : ''}`);
    });
  }
  console.log('==============================================================================\n');
  return data;
}

module.exports = {
  parseWorkersArgs,
  filterWorkersList,
  fetchWorkersData,
  formatWorkersTelegramHtml,
  workersCommand
};
