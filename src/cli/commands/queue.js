const { loadConfig } = require('../../config/config');
const ApiClient = require('../../api/client');

async function queueCommand(args = []) {
  const isJson = args.includes('--json');
  const showAll = args.includes('--all') || args.includes('-a');
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const client = new ApiClient(config.serverUrl, config.secret, config.projectId);

  try {
    const res = await client.pullTasks();
    let tasks = [];
    if (res && res.data) {
      tasks = Array.isArray(res.data.tasks) ? res.data.tasks : (Array.isArray(res.data) ? res.data : []);
    }

    const inProgress = tasks.filter(t => t.status === 'IN_PROGRESS' || t.status === 'RUNNING');
    const pending = tasks.filter(t => t.status === 'PENDING' || t.status === 'WAITING' || t.status === 'QUEUE');
    const done = tasks.filter(t => t.status === 'DONE' || t.status === 'SELESAI');
    const failed = tasks.filter(t => t.status === 'FAILED' || t.status === 'GAGAL');

    if (isJson) {
      console.log(JSON.stringify({
        project: config.projectId,
        serverUrl: config.serverUrl,
        summary: {
          inProgress: inProgress.length,
          pending: pending.length,
          done: done.length,
          failed: failed.length,
          total: tasks.length
        },
        inProgress,
        pending,
        recentDone: done.slice(0, 5),
        recentFailed: failed.slice(0, 5)
      }, null, 2));
      return;
    }

    console.log('==============================================================================');
    console.log(`📋 ANTREAN TUGAS (TASK QUEUE) — PROYEK: ${config.projectId}`);
    console.log('==============================================================================\n');

    if (inProgress.length === 0 && pending.length === 0) {
      console.log('🟢 Antrean aktif kosong! Tidak ada tugas yang sedang diproses atau menunggu.\n');
    }

    if (inProgress.length > 0) {
      console.log('⚡ SEDANG DIKERJAKAN (IN_PROGRESS):');
      for (const t of inProgress) {
        console.log(`  • [#${t.id}] "${t.instruction}"`);
        console.log(`     └ Agent: ${t.assigned_agent || t.agent || config.agent} | Pengirim: ${t.sender || 'Unknown'}`);
      }
      console.log('');
    }

    if (pending.length > 0) {
      console.log(`⏳ ANTREAN MENUNGGU (${pending.length} Tugas):`);
      const limit = showAll ? pending.length : Math.min(pending.length, 10);
      for (let i = 0; i < limit; i++) {
        const t = pending[i];
        const prio = (t.priority || 'NORMAL') === 'HIGH' ? ' ⚡[HIGH]' : '';
        console.log(`  ${i + 1}. [#${t.id}]${prio} "${t.instruction}"`);
      }
      if (!showAll && pending.length > 10) {
        console.log(`  ...dan ${pending.length - 10} tugas lainnya (gunakan 'tele queue --all' untuk melihat semua).`);
      }
      console.log('');
    }

    if (done.length > 0) {
      console.log('✅ RIWAYAT SELESAI TERAKHIR:');
      for (const t of done.slice(0, 3)) {
        console.log(`  • [#${t.id}] "${t.instruction.substring(0, 60)}"`);
        if (t.commit_hash) console.log(`    └ Commit: ${t.commit_hash}`);
      }
      console.log('');
    }

    console.log('------------------------------------------------------------------------------');
    console.log(`📊 Statistik Ringkasan: ⚡ ${inProgress.length} proses | ⏳ ${pending.length} antre | ✅ ${done.length} selesai | ❌ ${failed.length} gagal`);
    console.log('💡 Tips:');
    console.log('  - Kirim tugas baru : tele task "<instruksi>" [--verbose]');
    console.log('  - Batalkan tugas    : tele cancel <task_id>');
    console.log('  - Hentikan paksa    : tele kill <task_id>');
    console.log('==============================================================================\n');
  } catch (err) {
    console.error(`❌ Gagal mengambil antrean tugas: ${err.message}`);
    process.exit(1);
  }
}

module.exports = queueCommand;
