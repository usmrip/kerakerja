const { loadConfig } = require('../../config/config');
const ApiClient = require('../../api/client');
const {
  matchesTaskId,
  killProcessTree,
  readActiveTask,
  clearActiveTask
} = require('../../utils/process');

async function listCommand(args) {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const client = new ApiClient(config.serverUrl, config.secret, config.projectId);

  try {
    const res = await client.pullTasks();
    let tasks = [];
    if (res && res.data) {
      tasks = Array.isArray(res.data.tasks) ? res.data.tasks : (Array.isArray(res.data) ? res.data : []);
    }

    if (tasks.length === 0) {
      console.log('⚪ Tidak ada tugas di server.');
      return;
    }

    console.log(`\n📋 Daftar Tugas untuk Proyek '${config.projectId}':\n`);
    for (const t of tasks.slice(0, 20)) {
      const badge = t.status === 'DONE' ? '✅' : (t.status === 'IN_PROGRESS' ? '⚙️' : (t.status === 'FAILED' ? '❌' : '⏳'));
      console.log(`${badge} [${t.status.padEnd(11)}] #${t.id.padEnd(8)} "${t.instruction.substring(0, 50)}"`);
      if (t.commit_hash) console.log(`    Commit: ${t.commit_hash}`);
    }
    console.log('\n');
  } catch (e) {
    console.error(`❌ Gagal mengambil daftar tugas: ${e.message}`);
  }
}

async function cancelCommand(args) {
  const taskId = args[0];
  if (!taskId) {
    console.log('Penggunaan: kerakerja cancel <task_id>');
    return;
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const client = new ApiClient(config.serverUrl, config.secret, config.projectId);

  console.log(`Membatalkan tugas #${taskId}...`);
  try {
    const res = await client.request('cancel', { id: taskId }, 'POST');
    console.log(`✅ Tugas #${taskId} berhasil dibatalkan.`);
  } catch (e) {
    console.error(`❌ Gagal membatalkan tugas: ${e.message}`);
  }
}

async function retryCommand(args) {
  const taskId = args[0];
  if (!taskId) {
    console.log('Penggunaan: kerakerja retry <task_id>');
    return;
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const client = new ApiClient(config.serverUrl, config.secret, config.projectId);

  console.log(`Mencoba ulang tugas #${taskId}...`);
  try {
    const res = await client.request('retry', { id: taskId }, 'POST');
    console.log(`✅ Tugas #${taskId} berhasil dijadwalkan ulang ke antrean!`);
  } catch (e) {
    console.error(`❌ Gagal retry tugas: ${e.message}`);
  }
}

function parseKillArgs(args = []) {
  let taskId = '';
  let reason = '';
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--reason' || arg === '-r') {
      if (i + 1 < args.length) {
        reason = args[++i];
      }
    } else if (!arg.startsWith('-') && !taskId) {
      taskId = arg.trim();
    } else if (!arg.startsWith('-') && taskId) {
      reason = reason ? `${reason} ${arg}` : arg;
    }
  }

  return {
    taskId,
    reason: reason || 'Dihentikan paksa (/kill) melalui CLI',
    force
  };
}

async function killCommand(args) {
  const { taskId, reason, force } = parseKillArgs(args);
  if (!taskId) {
    console.log('Penggunaan: kerakerja kill <task_id> [--reason "<alasan>"] [--force]');
    console.log('Contoh    : kerakerja kill TASK-92fe');
    return;
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const client = new ApiClient(config.serverUrl, config.secret, config.projectId);

  const active = readActiveTask(cwd);
  let killedLocalPid = null;
  if (active && active.taskId && matchesTaskId(active.taskId, taskId)) {
    if (killProcessTree(active.pid)) {
      killedLocalPid = active.pid;
      console.log(`🛑 Proses lokal agent (PID: ${active.pid}) untuk tugas ${active.taskId} dihentikan.`);
    }
    clearActiveTask(cwd, active.taskId);
  }

  let resolvedId = taskId;
  try {
    const taskRes = await client.getTask(taskId);
    const remoteTask = taskRes && taskRes.data && taskRes.data.task;
    if (remoteTask) {
      resolvedId = remoteTask.id;
      if (remoteTask.status === 'DONE' && !force) {
        console.log(`⚠️ Tugas ${resolvedId} sudah berstatus DONE. Gunakan --force jika ingin memaksa.`);
        return;
      }
    }
  } catch (e) {}

  console.log(`Menghentikan tugas ${resolvedId}...`);
  try {
    await client.killTask(resolvedId, reason);
    if (killedLocalPid) {
      console.log(`✅ Tugas ${resolvedId} berhasil di-kill (proses PID ${killedLocalPid} dihentikan & status server diperbarui).`);
    } else {
      console.log(`✅ Tugas ${resolvedId} berhasil di-kill di server.`);
    }
  } catch (e) {
    console.error(`❌ Gagal menghentikan tugas ${resolvedId}: ${e.message}`);
  }
}

module.exports = {
  listCommand,
  cancelCommand,
  killCommand,
  retryCommand,
  parseKillArgs
};
