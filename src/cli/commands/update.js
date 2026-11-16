const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getRunningPid } = require('./daemon_ctl');

async function updateCommand(args = []) {
  const isCheckOnly = args.includes('--check') || args.includes('-c');
  const rootDir = path.resolve(__dirname, '..', '..', '..');
  const gitDir = path.join(rootDir, '.git');

  console.log('==============================================================================');
  console.log('🔄 PEMBARUAN TELE-VS-CLI (AUTO-UPDATE)');
  console.log('==============================================================================\n');

  if (!fs.existsSync(gitDir)) {
    console.log(`⚠️ Direktori instalasi (${rootDir}) bukan merupakan repositori Git.`);
    console.log(`💡 Untuk memperbarui instalasi global, jalankan ulang skrip installer:`);
    console.log(`   Linux / macOS : curl -fsSL https://raw.githubusercontent.com/usmrip/tele-vs-cli/main/install.sh | bash`);
    console.log(`   Windows       : irm https://raw.githubusercontent.com/usmrip/tele-vs-cli/main/install.ps1 | iex\n`);
    return;
  }

  try {
    process.stdout.write('🔍 Memeriksa pembaruan dari remote GitHub (origin/main)... ');
    execSync('git fetch origin main', { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
    console.log('✅ Terhubung.');

    const localCommit = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf-8' }).trim();
    const remoteCommit = execSync('git rev-parse origin/main', { cwd: rootDir, encoding: 'utf-8' }).trim();

    if (localCommit === remoteCommit) {
      console.log(`\n🟢 Anda sudah menggunakan versi Tele-vs-CLI TERBARU (${localCommit.substring(0, 7)}).`);
      console.log('Tidak ada pembaruan yang diperlukan.\n');
      return;
    }

    const logDiff = execSync('git log HEAD..origin/main --oneline', { cwd: rootDir, encoding: 'utf-8' }).trim();
    console.log(`\n📦 Ditemukan pembaruan baru di remote:\n`);
    for (const line of logDiff.split(/\r?\n/).slice(0, 5)) {
      console.log(`   ✨ ${line}`);
    }

    if (isCheckOnly) {
      console.log(`\n💡 Jalankan 'tele update' tanpa opsi untuk menerapkan pembaruan.\n`);
      return;
    }

    console.log(`\n⬇️ Mengunduh dan menerapkan pembaruan (git pull)...`);
    const pullOut = execSync('git pull origin main', { cwd: rootDir, encoding: 'utf-8' }).trim();
    console.log(pullOut);

    // Refresh launcher jika ada skrip install
    const installScript = path.join(rootDir, 'scripts', 'install.js');
    if (fs.existsSync(installScript)) {
      try {
        execSync(`node "${installScript}"`, { stdio: 'ignore' });
      } catch (e) {}
    }

    console.log('\n==============================================================================');
    console.log('🎉 Tele-vs-CLI Berhasil Diperbarui ke Versi Terbaru!');
    console.log('==============================================================================');

    // Cek apakah ada background worker yang aktif
    const workerPid = getRunningPid(process.cwd());
    if (workerPid) {
      console.log(`\n⚡ Background worker aktif terdeteksi (PID: ${workerPid}).`);
      console.log(`💡 Disarankan merestart worker agar modul baru dimuat: tele restart\n`);
    }
  } catch (err) {
    console.error(`\n❌ Gagal memeriksa/menerapkan pembaruan: ${err.message}`);
    process.exit(1);
  }
}

module.exports = updateCommand;
