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

function computeNextIndex(current, direction, length) {
  if (length <= 0) return 0;
  if (direction === 'up') return (current - 1 + length) % length;
  if (direction === 'down') return (current + 1) % length;
  return current;
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

function selectFromListInteractive(title, choices) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      // Fallback non-TTY
      return resolve(choices[0]);
    }

    let selectedIndex = 0;
    const totalLines = choices.length + 1;

    const render = (isFirst = false) => {
      if (!isFirst) {
        process.stdout.write(`\x1b[${totalLines}A`);
      }
      process.stdout.write(`\x1b[2K${title}\n`);
      for (let i = 0; i < choices.length; i++) {
        const isSel = i === selectedIndex;
        const prefix = isSel ? '\x1b[36m❯\x1b[0m' : ' ';
        const text = isSel ? `\x1b[1m\x1b[36m${choices[i].label}\x1b[0m` : choices[i].label;
        process.stdout.write(`\x1b[2K  ${prefix} ${text}\n`);
      }
    };

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write('\x1b[?25l'); // sembunyikan kursor

    render(true);

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      try { process.stdin.setRawMode(Boolean(wasRaw)); } catch (e) {}
      process.stdin.pause();
      process.stdout.write('\x1b[?25h'); // tampilkan kursor kembali
    };

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(130);
      }

      if (key.name === 'up' || key.name === 'k') {
        selectedIndex = computeNextIndex(selectedIndex, 'up', choices.length);
        render(false);
      } else if (key.name === 'down' || key.name === 'j') {
        selectedIndex = computeNextIndex(selectedIndex, 'down', choices.length);
        render(false);
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(choices[selectedIndex]);
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
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
