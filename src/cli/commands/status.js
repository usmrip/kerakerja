const fs = require('fs');
const { loadConfig } = require('../../config/config');
const { loadWorkspaces, getGlobalWorkspacesPath } = require('../../config/workspaces');
const ApiClient = require('../../api/client');
const { getRunningPid } = require('./daemon_ctl');
const { isProjectConfigured } = require('./start');

async function fetchProjectStatus(cfg) {
  const client = new ApiClient(cfg.serverUrl, cfg.secret, cfg.projectId);
  let tasks = [];
  let summary = null;
  let projectInfo = null;
  let serverOk = false;
  let serverMsg = '';

  const [statusRes, pullRes] = await Promise.allSettled([
    client.getStatus(),
    client.request('pull', { limit: 10 })
  ]);

  if (statusRes.status === 'fulfilled' && statusRes.value && statusRes.value.data && statusRes.value.data.ok) {
    serverOk = true;
    summary = statusRes.value.data.summary || null;
    projectInfo = statusRes.value.data.project || null;
  } else if (statusRes.status === 'rejected') {
    serverMsg = statusRes.reason ? statusRes.reason.message : 'Gagal menghubungi server';
  }

  if (pullRes.status === 'fulfilled' && pullRes.value && pullRes.value.data) {
    serverOk = true;
    const d = pullRes.value.data;
    tasks = Array.isArray(d.tasks) ? d.tasks : (Array.isArray(d) ? d : []);
  } else if (!serverOk && pullRes.status === 'rejected') {
    serverMsg = pullRes.reason ? pullRes.reason.message : serverMsg;
  }

  const pendingTasks = tasks.filter(t => t.status === 'PENDING' || t.status === 'WAITING' || t.status === 'QUEUE');
  const runningTasks = tasks.filter(t => t.status === 'IN_PROGRESS' || t.status === 'RUNNING');
  const doneTasks = tasks.filter(t => t.status === 'DONE' || t.status === 'SELESAI');

  const pendingCount = summary && typeof summary.PENDING === 'number' ? summary.PENDING : pendingTasks.length;
  const runningCount = summary && typeof summary.IN_PROGRESS === 'number' ? summary.IN_PROGRESS : runningTasks.length;
  const doneCount = summary && typeof summary.DONE === 'number' ? summary.DONE : doneTasks.length;
  const failedCount = summary && typeof summary.FAILED === 'number' ? summary.FAILED : 0;

  return {
    tasks,
    summary,
    projectInfo,
    serverOk,
    serverMsg,
    pendingTasks,
    runningTasks,
    doneTasks,
    counts: {
      pending: pendingCount,
      running: runningCount,
      done: doneCount,
      failed: failedCount,
      total: pendingCount + runningCount + doneCount + failedCount
    }
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
      : { tasks: [], projectInfo: null, serverOk: false, serverMsg: exists ? 'Konfigurasi belum lengkap' : 'Folder tidak ditemukan', pendingTasks: [], runningTasks: [], doneTasks: [], counts: { pending: 0, running: 0, done: 0, failed: 0, total: 0 } };

    results.push({
      projectId: effectiveCfg.projectId,
      projectName: st.projectInfo ? st.projectInfo.name : null,
      projectCode: st.projectInfo ? st.projectInfo.code : null,
      workDir: ws.workDir,
      exists,
      agent: effectiveCfg.agent,
      serverUrl: effectiveCfg.serverUrl,
      connected: st.serverOk,
      error: st.serverMsg || null,
      tasks: {
        total: st.counts.total,
        pending: st.counts.pending,
        running: st.counts.running,
        done: st.counts.done,
        failed: st.counts.failed,
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
  console.log('📊 STATUS MULTI-PROYEK KERAKERJA');
  console.log('==============================================================================');
  console.log(`\n🤖 Multi-Project Worker : ${multiPid ? `🟢 AKTIF (PID: ${multiPid})` : '⚪ MATI (Gunakan `kerakerja start --all --daemon`)'}`);
  console.log(`📂 Registry Global      : ${workspacesFile} (${results.length} proyek)`);

  if (results.length === 0) {
    console.log('\n⚪ Belum ada proyek terdaftar. Masuk ke folder proyek (/a, /b) lalu jalankan `kerakerja init`.');
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

  const { projectInfo, serverOk, serverMsg, pendingTasks, runningTasks, counts } = await fetchProjectStatus(config);

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
        projectId: config.projectId,
        projectName: projectInfo ? projectInfo.name : null,
        projectCode: projectInfo ? projectInfo.code : null
      },
      tasks: {
        total: counts.total,
        pending: counts.pending,
        running: counts.running,
        done: counts.done,
        failed: counts.failed,
        active: runningTasks[0] || null
      }
    }, null, 2));
    return;
  }

  console.log('==============================================================================');
  console.log('📊 STATUS SISTEM & ANTREAN KERAKERJA');
  console.log('==============================================================================');

  const workerLabel = workerPid
    ? `🟢 AKTIF (PID: ${workerPid})`
    : (multiPid ? `🟢 AKTIF via Multi-Project Worker (PID: ${multiPid})` : '⚪ MATI (Gunakan `kerakerja start --daemon` / `kerakerja start --all --daemon`)');
  const prjDisplay = projectInfo && projectInfo.name
    ? `${projectInfo.name}${projectInfo.code ? ` (#${projectInfo.code})` : ''} [${config.projectId}]`
    : config.projectId;
  console.log(`\n🤖 Status Worker CLI : ${workerLabel}`);
  console.log(`📂 Direktori Kerja   : ${cwd}`);
  console.log(`🧠 AI Agent Dipakai  : ${config.agent}`);
  console.log(`🌐 Server Dashboard  : ${config.serverUrl} (${serverOk ? '✅ Terhubung' : '❌ ' + serverMsg})`);
  console.log(`🏢 Proyek Aktif      : ${prjDisplay}`);

  console.log(`\n📋 Ringkasan Antrean:`);
  console.log(`  - ⏳ Menunggu (Pending) : ${counts.pending}`);
  console.log(`  - ⚙️ Sedang Dikerjakan  : ${counts.running}`);
  console.log(`  - ✅ Selesai (Done)     : ${counts.done}`);
  if (counts.failed > 0) {
    console.log(`  - ❌ Gagal (Failed)     : ${counts.failed}`);
  }

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
