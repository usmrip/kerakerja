const path = require('path');
const readline = require('readline');
const ApiClient = require('../../api/client');
const { loadConfig, saveConfig, DEFAULT_SERVER_URL } = require('../../config/config');
const { registerWorkspace } = require('../../config/workspaces');
const {
  getAppInfo,
  getProjectSwitchGuideLines,
  testCommunication
} = require('../../utils/app_info');
const doctorCommand = require('./doctor');
const startCommand = require('./start');
const { computeNextIndex, selectFromListInteractive } = require('../../utils/prompt');

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

function formatProjectChoices(projects = []) {
  const choices = projects.map(p => {
    const key = p.project_key || String(p.id || '');
    const tag = p.code ? ` [#${p.code}]` : '';
    const name = p.name || key;
    return {
      label: `📁 ${name}${tag} (Key: ${key})`,
      value: key,
      manual: false
    };
  }).filter(c => c.value);

  choices.push({
    label: '✏️  Input manual Project ID / Key...',
    value: '__MANUAL__',
    manual: true
  });

  return choices;
}

async function fetchServerProjects(serverUrl, secret) {
  if (!secret) return { ok: false, projects: [], error: 'API Key kosong' };
  try {
    const client = new ApiClient(serverUrl, secret, '');
    const res = await client.request('projects');
    if (res.statusCode >= 200 && res.statusCode < 300 && res.data && Array.isArray(res.data.projects)) {
      return { ok: true, projects: res.data.projects };
    }
    return {
      ok: false,
      projects: [],
      error: (res.data && res.data.error) || `HTTP ${res.statusCode}`
    };
  } catch (err) {
    return { ok: false, projects: [], error: err.message };
  }
}

async function initCommand(args = []) {
  const cwd = process.cwd();
  const rootDir = path.resolve(__dirname, '..', '..', '..');
  const currentConfig = loadConfig(cwd);
  const prompts = getWizardPrompts(currentConfig);
  const appInfo = getAppInfo(rootDir);

  console.log('==============================================================================');
  console.log('🚀 PENGATURAN AWAL KERAKERJA (SETUP WIZARD)');
  console.log('==============================================================================');
  console.log(`📦 Versi Aplikasi  : v${appInfo.version}${appInfo.commitHash ? ` (${appInfo.commitHash})` : ''}`);
  console.log(`🕒 Terakhir Update : ${appInfo.lastUpdateDate}`);
  console.log('------------------------------------------------------------------------------');
  console.log('📌 PENTING: Daftarkan proyek Anda terlebih dahulu di Dashboard Website:');
  console.log(`   👉 ${prompts.serverUrl.defaultValue}`);
  console.log('   untuk mendapatkan Secret Key API (AGENTS_TELE_SECRET) & Project ID / Key.');
  console.log('==============================================================================\n');

  let serverUrl = '';
  let secret = '';
  let projectId = '';
  let agent = '';

  const rl1 = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    serverUrl = await askQuestion(rl1, prompts.serverUrl.query, prompts.serverUrl.defaultValue);
    secret = await askQuestion(rl1, prompts.secret.query, prompts.secret.defaultValue);
  } finally {
    rl1.close();
  }

  // Ambil daftar proyek dari server menggunakan API Key
  if (secret) {
    process.stdout.write('\n🔍 Mengambil daftar proyek dari server... ');
    const fetched = await fetchServerProjects(serverUrl, secret);
    if (fetched.ok && fetched.projects.length > 0) {
      console.log(`✅ Ditemukan ${fetched.projects.length} proyek.\n`);
      const choices = formatProjectChoices(fetched.projects);
      const picked = await selectFromListInteractive(
        '3. Pilih Proyek (gunakan panah ↑ / ↓ lalu tekan Enter):',
        choices
      );
      if (picked && !picked.manual) {
        projectId = picked.value;
        console.log(`   ✔ Proyek terpilih: ${projectId}\n`);
      }
    } else {
      console.log(`⚠️ Tidak dapat memuat daftar proyek (${fetched.error || 'kosong'}). Lanjut input manual.\n`);
    }
  }

  const rl2 = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    if (!projectId) {
      projectId = await askQuestion(rl2, prompts.projectId.query, prompts.projectId.defaultValue);
    }
    agent = await askQuestion(rl2, prompts.agent.query, prompts.agent.defaultValue);
  } finally {
    rl2.close();
  }

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

  const regRes = registerWorkspace({ ...newConfig, workDir: cwd });
  if (regRes.registered) {
    if (regRes.movedFrom) {
      console.log(`🔄 Direktori proyek '${newConfig.projectId}' dipindahkan: ${regRes.movedFrom} -> ${cwd}`);
    }
    console.log(`📌 Terdaftar ke Multi-Project Registry (${regRes.total} proyek): ${regRes.filePath}`);
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

  if (!args.includes('--skip-doctor')) {
    console.log('\n🩺 Menjalankan `kerakerja doctor` secara otomatis...');
    const doctorRes = await doctorCommand([]);
    if (doctorRes && doctorRes.ok && process.stdin.isTTY && !args.includes('--no-start-prompt')) {
      console.log('🚀 Diagnostik lolos tanpa error! Pilih mode eksekusi KeraKerja:');
      console.log('   [1] Jalankan biasa (foreground: kerakerja start)');
      console.log('   [2] Jalankan daemon (background: kerakerja start --daemon)');
      console.log('   [3] Jalankan daemon + verbose (kerakerja start --daemon --verbose)');
      console.log('   [4] Keluar');

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const choice = (await askQuestion(rl, '\nPilih [1/2/3/4] (default 4): ')).trim();
      rl.close();

      if (choice === '1') {
        await startCommand([]);
      } else if (choice === '2') {
        await startCommand(['--daemon']);
      } else if (choice === '3') {
        await startCommand(['--daemon', '--verbose']);
      } else {
        console.log('👋 Keluar. Anda dapat menjalankan `kerakerja start --daemon` kapan saja.\n');
      }
      return;
    }
  }

  console.log('\n💡 Langkah berikutnya:');
  console.log('   - Jalankan `kerakerja doctor` untuk mengecek kesiapan sistem lengkap.');
  console.log('   - Jalankan `kerakerja start --daemon` (1 proyek) atau `kerakerja start --all --daemon` (semua proyek terdaftar).');
  console.log('   - Kirim tugas dengan `kerakerja task "instruksi..."`.\n');
}

initCommand.askQuestion = askQuestion;
initCommand.getWizardPrompts = getWizardPrompts;
initCommand.formatProjectChoices = formatProjectChoices;
initCommand.computeNextIndex = computeNextIndex;
initCommand.fetchServerProjects = fetchServerProjects;

module.exports = initCommand;
