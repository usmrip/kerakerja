const fs = require('fs');
const { loadConfig } = require('../../config/config');
const { loadWorkspaces, getGlobalWorkspacesPath } = require('../../config/workspaces');
const ApiClient = require('../../api/client');
const { getRunningPid } = require('./daemon_ctl');
const { isProjectConfigured } = require('./start');

async function fetchProjectStatus(cfg) {
  const client = new ApiClient(cfg.serverUrl, cfg.secret, cfg.projectId);
  let tasks = [];
  let serverOk = false;
  let serverMsg = '';

  try {
    const res = await client.pullTasks();
    serverOk = true;
    if (res && res.data) {
      tasks = Array.isArray(res.data.tasks) ? res.data.tasks : (Array.isArray(res.data) ? res.data : []);
    }
  } catch (e) {
    serverMsg = e.message;
  }

  const pendingTasks = tasks.filter(t => t.status === 'PENDING' || t.status === 'WAITING' || t.status === 'QUEUE');
  const runningTasks = tasks.filter(t => t.status === 'IN_PROGRESS' || t.status === 'RUNNING');
  const doneTasks = tasks.filter(t => t.status === 'DONE' || t.status === 'SELESAI');

  return {
    tasks,
    serverOk,
    serverMsg,
    pendingTasks,
    runningTasks,
    doneTasks
  };
}

async function showMultiStatus(isJson, multiPid, workspacesFile = getGlobalWorkspacesPath()) {
  const registered = loadWorkspaces(workspacesFile);
  const results = [];

  for (const ws of registered) {
    const exists = Boolean(ws.workDir && fs.existsSync(ws.workDir));
    const localCfg = exists ? loadConfig(ws.workDir) : {};
    const effectiveCfg = {
      serverUrl: localCfg.serverUrl || ws.serverUrl,
      secret: localCfg.secret || ws.secret,
      projectId: (localCfg.projectId && localCfg.projectId !== 'default') ? localCfg.projectId : ws.projectId,
      agent: localCfg.agent || ws.agent || 'auto'
    };
    const st = (exists && isProjectConfigured(effectiveCfg))
      ? await fetchProjectStatus(effectiveCfg)
      : { tasks: [], serverOk: false, serverMsg: exists ? 'Konfigurasi belum lengkap' : 'Folder tidak ditemukan', pendingTasks: [], runningTasks: [], doneTasks: [] };

    results.push({
      projectId: effectiveCfg.projectId,
      workDir: ws.workDir,
      exists,
      agent: effectiveCfg.agent,
      serverUrl: effectiveCfg.serverUrl,
      connected: st.serverOk,
      error: st.serverMsg || null,
      tasks: {
        total: st.tasks.length,
        pending: st.pendingTasks.length,
        running: st.runningTasks.length,
        done: st.doneTasks.length,
        active: st.runningTasks[0] || null
      }
    });
  }

  if (isJson) {
    console.log(JSON.stringify({
      mode: 'multi-project',
      multiWorker: {
        status: multiPid ? 'online' : 'offline',
        pid: multiPid
      },
      registryFile: workspacesFile,
      totalWorkspaces: results.length,
      workspaces: results
    }, null, 2));
    return;
  }

  console.log('==============================================================================');
  console.log('📊 STATUS MULTI-PROYEK TELE-VS-CLI');
  console.log('==============================================================================');
  console.log(`\n🤖 Multi-Project Worker : ${multiPid ? `🟢 AKTIF (PID: ${multiPid})` : '⚪ MATI (Gunakan `tele start --all --daemon`)'}`);
  console.log(`📂 Registry Global      : ${workspacesFile} (${results.length} proyek)`);

  if (results.length === 0) {
    console.log('\n⚪ Belum ada proyek terdaftar. Masuk ke folder proyek (/a, /b) lalu jalankan `tele init`.');
  } else {
    console.log('\n🏢 Daftar Proyek Terdaftar:');
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const conn = r.connected ? '✅ Terhubung' : `❌ ${r.error || 'Terputus'}`;
      console.log(`\n  [${i + 1}] ${r.projectId} (${r.workDir})`);
      console.log(`      Agent: ${r.agent} | Server: ${conn}`);
      console.log(`      Antrean: ⏳ ${r.tasks.pending} pending | ⚙️ ${r.tasks.running} proses | ✅ ${r.tasks.done} selesai`);
    }
  }
  console.log('\n==============================================================================\n');
}

async function statusCommand(args = []) {
  const isJson = args.includes('--json');
  const isAll = args.includes('--all') || args.includes('-a');
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const workerPid = getRunningPid(cwd, false);
  const multiPid = getRunningPid(cwd, true);

  if (isAll || (!isProjectConfigured(config) && (multiPid || loadWorkspaces().length > 0))) {
    await showMultiStatus(isJson, multiPid);
    return;
  }

  const { tasks, serverOk, serverMsg, pendingTasks, runningTasks, doneTasks } = await fetchProjectStatus(config);

  if (isJson) {
    console.log(JSON.stringify({
      worker: {
        status: workerPid ? 'online' : 'offline',
        pid: workerPid,
        workDir: cwd,
        agent: config.agent
      },
      server: {
        url: config.serverUrl,
        connected: serverOk,
        error: serverMsg || null,
        projectId: config.projectId
      },
      tasks: {
        total: tasks.length,
        pending: pendingTasks.length,
        running: runningTasks.length,
        done: doneTasks.length,
        active: runningTasks[0] || null
      }
    }, null, 2));
    return;
  }

  console.log('==============================================================================');
  console.log('📊 STATUS SISTEM & ANTREAN TELE-VS-CLI');
  console.log('==============================================================================');

  const workerLabel = workerPid
    ? `🟢 AKTIF (PID: ${workerPid})`
    : (multiPid ? `🟢 AKTIF via Multi-Project Worker (PID: ${multiPid})` : '⚪ MATI (Gunakan `tele start --daemon` / `tele start --all --daemon`)');
  console.log(`\n🤖 Status Worker CLI : ${workerLabel}`);
  console.log(`📂 Direktori Kerja   : ${cwd}`);
  console.log(`🧠 AI Agent Dipakai  : ${config.agent}`);
  console.log(`🌐 Server Dashboard  : ${config.serverUrl} (${serverOk ? '✅ Terhubung' : '❌ ' + serverMsg})`);
  console.log(`🏢 Proyek Aktif      : ${config.projectId}`);

  console.log(`\n📋 Ringkasan Antrean:`);
  console.log(`  - ⏳ Menunggu (Pending) : ${pendingTasks.length}`);
  console.log(`  - ⚙️ Sedang Dikerjakan  : ${runningTasks.length}`);
  console.log(`  - ✅ Selesai (Done)     : ${doneTasks.length}`);

  if (runningTasks.length > 0) {
    console.log(`\n⚡ Tugas Sedang Berjalan:`);
    for (const t of runningTasks) {
      console.log(`  [#${t.id}] "${t.instruction}" (Agent: ${t.assigned_agent || t.agent || 'auto'})`);
    }
  }

  if (pendingTasks.length > 0) {
    console.log(`\n⏳ 3 Tugas Antrean Berikutnya:`);
    for (const t of pendingTasks.slice(0, 3)) {
      console.log(`  - [#${t.id}] "${t.instruction}"`);
    }
  }

  console.log('\n==============================================================================\n');
}

statusCommand.showMultiStatus = showMultiStatus;
module.exports = statusCommand;
