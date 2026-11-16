const readline = require('readline');
const { loadConfig, saveConfig, DEFAULT_SERVER_URL } = require('../../config/config');

function askQuestion(rl, query, defaultValue) {
  return new Promise(resolve => {
    const prompt = defaultValue ? `${query} [${defaultValue}]: ` : `${query}: `;
    rl.question(prompt, answer => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function initCommand(args) {
  const cwd = process.cwd();
  const currentConfig = loadConfig(cwd);

  console.log('==============================================================================');
  console.log('🚀 PENGATURAN AWAL TELE-VS-CLI (SETUP WIZARD)');
  console.log('==============================================================================\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const serverUrl = await askQuestion(rl, '1. URL Server Dashboard', currentConfig.serverUrl || DEFAULT_SERVER_URL);
    const secret = await askQuestion(rl, '2. Secret Key API (AGENTS_TELE_SECRET)', currentConfig.secret || '');
    const projectId = await askQuestion(rl, '3. Project ID / Key (misal: prj_xxx atau nama)', currentConfig.projectId || 'default');
    const agent = await askQuestion(rl, '4. AI Agent Default (auto|agy|claude|gemini|cline)', currentConfig.agent || 'auto');

    const newConfig = {
      serverUrl,
      secret,
      projectId,
      agent,
      taskTimeout: 600000,
      pollInterval: 5000
    };

    const savedPath = saveConfig(newConfig, cwd);
    console.log(`\n🎉 Konfigurasi berhasil disimpan ke: ${savedPath}`);
    console.log(`\n💡 Langkah berikutnya:`);
    console.log(`   - Jalankan 'tele doctor' untuk mengecek kesiapan sistem.`);
    console.log(`   - Jalankan 'tele start --daemon' untuk menjalankan worker di latar belakang.`);
    console.log(`   - Kirim tugas dengan 'tele task "instruksi..."'.\n`);
  } finally {
    rl.close();
  }
}

module.exports = initCommand;
