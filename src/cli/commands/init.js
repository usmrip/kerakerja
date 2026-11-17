const path = require('path');
const readline = require('readline');
const { loadConfig, saveConfig, DEFAULT_SERVER_URL } = require('../../config/config');
const { registerWorkspace } = require('../../config/workspaces');
const {
  getAppInfo,
  getProjectSwitchGuideLines,
  testCommunication
} = require('../../utils/app_info');

function askQuestion(rl, query, defaultValue = '') {
  return new Promise(resolve => {
    const prompt = defaultValue ? `${query} [${defaultValue}]: ` : `${query}: `;
    rl.question(prompt, answer => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function getWizardPrompts(currentConfig = {}) {
  return {
    serverUrl: {
      query: '1. URL Server Dashboard',
      defaultValue: currentConfig.serverUrl || DEFAULT_SERVER_URL
    },
    secret: {
      query: '2. Secret Key API (AGENTS_TELE_SECRET, misal: tvscli_*******)',
      defaultValue: ''
    },
    projectId: {
      query: '3. Project ID / Key (misal: prj_********* atau nama)',
      defaultValue: ''
    },
    agent: {
      query: '4. AI Agent Default (auto|agy|claude|gemini|cline)',
      defaultValue: currentConfig.agent || 'auto'
    }
  };
}

async function initCommand(args = []) {
  const cwd = process.cwd();
  const rootDir = path.resolve(__dirname, '..', '..', '..');
  const currentConfig = loadConfig(cwd);
  const prompts = getWizardPrompts(currentConfig);
  const appInfo = getAppInfo(rootDir);

  console.log('==============================================================================');
  console.log('🚀 PENGATURAN AWAL TELE-VS-CLI (SETUP WIZARD)');
  console.log('==============================================================================');
  console.log(`📦 Versi Aplikasi  : v${appInfo.version}${appInfo.commitHash ? ` (${appInfo.commitHash})` : ''}`);
  console.log(`🕒 Terakhir Update : ${appInfo.lastUpdateDate}`);
  console.log('------------------------------------------------------------------------------');
  console.log('📌 PENTING: Daftarkan proyek Anda terlebih dahulu di Dashboard Website:');
  console.log(`   👉 ${prompts.serverUrl.defaultValue}`);
  console.log('   untuk mendapatkan Secret Key API (AGENTS_TELE_SECRET) & Project ID / Key.');
  console.log('==============================================================================\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let newConfig;
  try {
    const serverUrl = await askQuestion(rl, prompts.serverUrl.query, prompts.serverUrl.defaultValue);
    const secret = await askQuestion(rl, prompts.secret.query, prompts.secret.defaultValue);
    const projectId = await askQuestion(rl, prompts.projectId.query, prompts.projectId.defaultValue);
    const agent = await askQuestion(rl, prompts.agent.query, prompts.agent.defaultValue);

    newConfig = {
      serverUrl,
      secret,
      projectId,
      agent,
      taskTimeout: 600000,
      pollInterval: 5000
    };

    const savedPath = saveConfig(newConfig, cwd);
    console.log(`\n🎉 Konfigurasi berhasil disimpan ke: ${savedPath}`);

    const regRes = registerWorkspace({ ...newConfig, workDir: cwd });
    if (regRes.registered) {
      console.log(`📌 Terdaftar ke Multi-Project Registry (${regRes.total} proyek): ${regRes.filePath}`);
    }
  } finally {
    rl.close();
  }

  // Test komunikasi Workstation <-> Dashboard <-> Telegram sebelum selesai instalasi
  let commResult = { ok: false, projectTag: '', messages: [] };
  if (!args.includes('--skip-test')) {
    console.log('\n📡 Menguji komunikasi antara Workstation, Dashboard & Telegram...');
    commResult = await testCommunication(newConfig);
    for (const msg of commResult.messages) {
      console.log(`   ${msg}`);
    }
  }

  console.log('\n==============================================================================');
  if (commResult.ok) {
    console.log('✅ INSTALASI & KONEKSI SELESAI — WORKSTATION, DASHBOARD & TELEGRAM TERHUBUNG!');
  } else {
    console.log('ℹ️ SETUP SELESAI (Periksa hasil test komunikasi di atas jika ada peringatan)');
  }
  console.log('==============================================================================');

  for (const line of getProjectSwitchGuideLines(commResult.projectTag)) {
    console.log(line);
  }

  console.log('\n💡 Langkah berikutnya:');
  console.log('   - Jalankan `tele doctor` untuk mengecek kesiapan sistem lengkap.');
  console.log('   - Jalankan `tele start --daemon` untuk menjalankan worker di latar belakang.');
  console.log('   - Kirim tugas dengan `tele task "instruksi..."`.\n');
}

initCommand.askQuestion = askQuestion;
initCommand.getWizardPrompts = getWizardPrompts;

module.exports = initCommand;
