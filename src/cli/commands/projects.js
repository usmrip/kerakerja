const { loadConfig, saveConfig } = require('../../config/config');
const ApiClient = require('../../api/client');

async function projectsCommand(args) {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const client = new ApiClient(config.serverUrl, config.secret, config.projectId);

  try {
    const res = await client.request('projects');
    const projects = (res.data && res.data.projects) ? res.data.projects : [];
    console.log(`\n🏢 Daftar Proyek di Server (${config.serverUrl}):\n`);
    for (const p of projects) {
      const pKey = p.project_key || String(p.id);
      const isCurrent = pKey === config.projectId || p.name === config.projectId || (p.code && p.code.toLowerCase() === (config.projectId || '').toLowerCase());
      const tagStr = p.code ? ` [#${p.code}]` : '';
      console.log(`  ${isCurrent ? '👉 [AKTIF]' : '   '} ${p.name || pKey}${tagStr} (Key: ${pKey})`);
    }
    console.log('\nGunakan `tele use <kode_atau_key>` untuk beralih proyek aktif.\n');
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
