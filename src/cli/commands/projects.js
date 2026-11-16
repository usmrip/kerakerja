const { loadConfig, saveConfig } = require('../../config/config');
const ApiClient = require('../../api/client');

async function projectsCommand(args) {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const client = new ApiClient(config.serverUrl, config.secret, config.projectId);

  try {
    const res = await client.request('get_projects');
    const projects = (res.data && res.data.projects) ? res.data.projects : [];
    console.log(`\n🏢 Daftar Proyek di Server (${config.serverUrl}):\n`);
    for (const p of projects) {
      const isCurrent = p.project_id === config.projectId || p.name === config.projectId;
      console.log(`  ${isCurrent ? '👉 [AKTIF]' : '   '} ${p.name || p.project_id} (ID: ${p.project_id})`);
    }
    console.log('\nGunakan `tele use <nama_atau_id>` untuk beralih proyek aktif.\n');
  } catch (e) {
    console.log(`Proyek lokal saat ini: ${config.projectId}`);
  }
}

async function useCommand(args) {
  const target = args[0];
  if (!target) {
    console.log('Penggunaan: tele use <nama_atau_project_id>');
    return;
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  config.projectId = target;
  saveConfig(config, cwd);
  console.log(`✅ Proyek aktif lokal berhasil diubah menjadi: '${target}' (disimpan di tele.config.json)`);
}

module.exports = {
  projectsCommand,
  useCommand
};
