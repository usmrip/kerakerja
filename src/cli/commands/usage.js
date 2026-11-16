'use strict';

const { fetchReport, render, UsageError } = require('../../utils/agy_usage');

const USAGE_HELP = `
tele usage â€” Pantau sisa kuota Antigravity AI (Gemini, Claude, GPT, Argon)

PENGGUNAAN:
  tele usage [opsi]

OPSI:
  --json            Keluaran dalam format JSON
  -w, --watch [dt]  Pantau secara berkala setiap [dt] detik (bawaan: 60s, min: 10s)
  --hide-email      Sembunyikan email akun
  --no-color        Nonaktifkan pewarnaan terminal ANSI
  -h, --help        Tampilkan bantuan ini

CONTOH:
  tele usage
  tele usage --json
  tele usage --watch 30
`;

async function usageCommand(args = []) {
  const has = (...flags) => flags.some(f => args.includes(f));
  if (has('-h', '--help')) {
    console.log(USAGE_HELP);
    return;
  }

  const json = has('--json');
  const hideEmail = has('--hide-email');
  const color = Boolean(process.stdout.isTTY && !process.env.NO_COLOR && !has('--no-color'));
  const wi = args.findIndex(a => a === '-w' || a === '--watch');
  const interval = wi < 0 ? 0 : Math.max(10, Number(args[wi + 1]) || 60);

  const fetchOnce = async () => {
    const report = await fetchReport();
    if (hideEmail) report.email = null;
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(render(report, { color, hideEmail }));
    }
  };

  if (!interval) {
    try {
      await fetchOnce();
    } catch (e) {
      const msg = e instanceof UsageError ? e.message : (e.message || 'Gagal membaca kuota Antigravity.');
      console.error('â Œ Error: ' + msg);
      process.exitCode = 1;
    }
    return;
  }

  // Watch mode loop
  for (;;) {
    if (process.stdout.isTTY && !json) {
      process.stdout.write('\x1b[2J\x1b[H');
    }
    try {
      await fetchOnce();
    } catch (e) {
      const msg = e instanceof UsageError ? e.message : (e.message || 'Gagal membaca kuota Antigravity.');
      console.error('â Œ Error: ' + msg);
    }
    await new Promise(r => setTimeout(r, interval * 1000));
  }
}

module.exports = usageCommand;
