const { loadConfig } = require('../../config/config');
const ApiClient = require('../../api/client');
const { getRunningPid } = require('./daemon_ctl');

async function statusCommand(args) {
  const isJson = args.includes('--json');
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const workerPid = getRunningPid(cwd);

  const client = new ApiClient(config.serverUrl, config.secret, config.projectId);
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

  console.log(`\n🤖 Status Worker CLI : ${workerPid ? `🟢 AKTIF (PID: ${workerPid})` : '⚪ MATI (Gunakan `tele start --daemon`)'}`);
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

module.exports = statusCommand;
