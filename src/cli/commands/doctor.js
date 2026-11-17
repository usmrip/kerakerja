const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../../config/config');
const { findCli } = require('../../executor/adapters/finder');
const ApiClient = require('../../api/client');

async function doctorCommand(args) {
  console.log('==============================================================================');
  console.log('🩺 DIAGNOSTIK KESEHATAN SISTEM KERAKERJA');
  console.log('==============================================================================');

  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const issues = [];

  // 1. Node runtime
  console.log(`\n[1/5] Runtime Lingkungan:`);
  console.log(`  - Node.js   : ${process.version} (OK)`);
  console.log(`  - Platform  : ${process.platform} (${process.arch})`);
  console.log(`  - WorkDir   : ${cwd}`);

  // 2. Konfigurasi
  console.log(`\n[2/5] Konfigurasi Proyek:`);
  console.log(`  - Server URL : ${config.serverUrl}`);
  console.log(`  - Project ID : ${config.projectId || '(Belum disetel)'}`);
  console.log(`  - Secret Key : ${config.secret ? 'Terkonfigurasi (' + config.secret.substring(0, 8) + '...)' : '❌ BELUM DISETEL'}`);
  console.log(`  - Agent Pref : ${config.agent}`);
  if (!config.secret) issues.push('Secret Key belum disetel.');
  if (!config.projectId) issues.push('Project ID belum disetel.');

  // 3. Tes Koneksi Server
  console.log(`\n[3/5] Konektivitas Server Biru:`);
  const client = new ApiClient(config.serverUrl, config.secret, config.projectId);
  try {
    const res = await client.pullTasks();
    console.log(`  - Status Koneksi: ✅ TERHUBUNG (HTTP ${res.statusCode})`);
  } catch (e) {
    console.log(`  - Status Koneksi: ⚠️ PERINGATAN (${e.message})`);
    issues.push(`Koneksi server gagal: ${e.message}`);
  }

  // 4. Deteksi Binary Agent
  console.log(`\n[4/5] Deteksi CLI AI Agent di Sistem:`);
  const agentsToCheck = [
    { name: 'Antigravity CLI (agy)', bin: 'agy' },
    { name: 'Claude Code CLI (claude)', bin: 'claude' },
    { name: 'Gemini CLI (gemini)', bin: 'gemini' },
    { name: 'Codex CLI (codex)', bin: 'codex' },
    { name: 'Cline CLI (cline)', bin: 'cline' }
  ];

  let foundCount = 0;
  for (const ag of agentsToCheck) {
    const foundPath = findCli(ag.bin);
    if (foundPath) {
      console.log(`  - ${ag.name.padEnd(28)}: ✅ Ditemukan (${foundPath})`);
      foundCount++;
    } else {
      console.log(`  - ${ag.name.padEnd(28)}: ⚪ Belum terpasang di PATH`);
    }
  }

  if (foundCount === 0) {
    console.log(`\n  ⚠️ CATATAN: Belum ada CLI AI Agent yang terpasang di PATH.`);
    console.log(`     Disarankan memasang Antigravity CLI (agy), Claude Code (claude), atau Gemini CLI.`);
    issues.push('Belum ada CLI AI Agent yang terpasang di PATH.');
  }

  // 5. Izin File & Logs
  console.log(`\n[5/5] Izin Filesystem & Logs:`);
  const logsDir = path.join(cwd, 'logs');
  try {
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const testFile = path.join(logsDir, '.write_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log(`  - Akses folder logs : ✅ BISA TULIS & BACA (${logsDir})`);
  } catch (e) {
    console.log(`  - Akses folder logs : ❌ GAGAL (${e.message})`);
    issues.push(`Akses folder logs gagal: ${e.message}`);
  }

  console.log('\n==============================================================================');
  console.log('🎉 Diagnostik Selesai.');
  console.log('==============================================================================\n');

  return {
    ok: issues.length === 0,
    issues,
    foundCount,
    config
  };
}

module.exports = doctorCommand;
