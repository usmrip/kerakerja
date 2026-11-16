const { loadConfig } = require('../../config/config');
const ApiClient = require('../../api/client');

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
    console.log('Penggunaan: tele cancel <task_id>');
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
    console.log('Penggunaan: tele retry <task_id>');
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

module.exports = {
  listCommand,
  cancelCommand,
  retryCommand
};
