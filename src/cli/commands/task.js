const ApiClient = require('../../api/client');
const { loadConfig } = require('../../config/config');

async function taskCommand(args) {
  if (args.length === 0) {
    console.log('Penggunaan: tele task "<instruksi>" [--agent <nama>] [--priority <NORMAL|HIGH>] [--verbose]');
    return;
  }

  let instruction = '';
  let agent = '';
  let priority = 'NORMAL';
  let isVerbose = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--agent' && i + 1 < args.length) {
      agent = args[++i];
    } else if (a === '--priority' && i + 1 < args.length) {
      priority = args[++i].toUpperCase();
    } else if (a === '--verbose' || a === '-v') {
      isVerbose = true;
    } else if (!a.startsWith('--') && !instruction) {
      instruction = a;
    }
  }

  if (!instruction) {
    console.error('❌ Instruksi tugas tidak boleh kosong.');
    process.exit(1);
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);

  console.log(`📤 Mengirim tugas ke Server Biru (${config.serverUrl})...`);
  console.log(`📌 Instruksi : "${instruction}"`);
  console.log(`🏢 Proyek    : ${config.projectId}`);

  const client = new ApiClient(config.serverUrl, config.secret, config.projectId);
  try {
    const res = await client.addTask(instruction, {
      sender: 'Terminal CLI',
      executor: 'cli',
      agent: agent || config.agent,
      priority,
      verbose: isVerbose
    });

    const data = res.data;
    if (data.status === 'success' || data.task_id || data.id) {
      const taskId = data.task_id || data.id || 'TASK-NEW';
      console.log(`\n🎉 Tugas #${taskId} berhasil ditambahkan ke antrean!`);
      console.log(`   Status   : PENDING`);
      console.log(`   Executor : CLI (Headless Worker)`);
      if (isVerbose) console.log(`   Verbose  : AKTIF (menampilkan progres berjalan agent)`);
      console.log(`\n💡 Pantau eksekusi dengan: tele status atau tele logs -f`);
    } else {
      console.log(`\n⚠️ Respon server: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.error(`❌ Gagal mengirim tugas: ${err.message}`);
    process.exit(1);
  }
}

module.exports = taskCommand;
