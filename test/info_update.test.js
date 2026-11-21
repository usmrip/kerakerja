const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execSync } = require('child_process');

const TeleWorker = require('../src/worker/worker');
const { buildInfoData, formatInfoTelegramHtml } = require('../src/cli/commands/info');
const updateCommand = require('../src/cli/commands/update');

test('Worker - parseInfoCommand mem-parsing /info dengan berbagai format', () => {
  assert.strictEqual(TeleWorker.parseInfoCommand('/info'), true);
  assert.strictEqual(TeleWorker.parseInfoCommand('/info@KeraKerjaBot'), true);
  assert.strictEqual(TeleWorker.parseInfoCommand('tolong /info'), false);
});

test('Info - buildInfoData dan formatInfoTelegramHtml mengembalikan versi & tanggal update terakhir', () => {
  const info = buildInfoData(process.cwd());
  assert.ok(info.version);
  assert.ok(info.lastUpdateDate);
  const html = formatInfoTelegramHtml(info);
  assert.ok(html.includes('INFORMASI VERSI KERAKERJA'));
  assert.ok(html.includes(`v${info.version}`));
  assert.ok(html.includes(info.lastUpdateDate));
});

test('CLI - kerakerja info --json dan /info --json berjalan sukses', () => {
  const binPath = path.join(__dirname, '..', 'bin', 'kerakerja.js');
  const out = execSync(`node "${binPath}" info --json`, { encoding: 'utf-8' });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.name, 'KeraKerja');
  assert.ok(parsed.version);
  assert.ok(parsed.lastUpdateDate);

  const slashOut = execSync(`node "${binPath}" /info --json`, { encoding: 'utf-8' });
  const slashParsed = JSON.parse(slashOut);
  assert.strictEqual(slashParsed.name, 'KeraKerja');
});

test('Update - parseUpdateArgs mem-parsing --check dan --all / workers', () => {
  assert.deepStrictEqual(updateCommand.parseUpdateArgs(['--check']), {
    checkOnly: true,
    allWorkers: false,
    noRestart: false
  });
  assert.deepStrictEqual(updateCommand.parseUpdateArgs(['--all']), {
    checkOnly: false,
    allWorkers: true,
    noRestart: false
  });
  assert.deepStrictEqual(updateCommand.parseUpdateArgs(['workers', '--no-restart']), {
    checkOnly: false,
    allWorkers: true,
    noRestart: true
  });
});

test('Update - dispatchUpdateToRemoteWorkers mengirim /update ke worker online proyek lain tanpa duplikat', async () => {
  const pushed = [];
  const fakeApiClient = {
    getWorkers: async () => ({
      data: {
        ok: true,
        workers: [
          { is_online: true, project_key: 'prj_local', project_name: 'Local', project_code: 'cli', hostname: 'my-pc' },
          { is_online: true, project_key: 'prj_ayo', project_name: 'ayoke', project_code: 'ayo', hostname: 'biru-click' },
          { is_online: true, project_key: 'prj_ayo', project_name: 'ayoke', project_code: 'ayo', hostname: 'biru-click-2' },
          { is_online: false, project_key: 'prj_off', project_name: 'Offline', project_code: 'off', hostname: 'old-pc' },
          { is_online: true, project_key: 'prj_biru', project_name: 'Biru', project_code: 'biru', hostname: 'biru-click' }
        ]
      }
    })
  };

  const res = await updateCommand.dispatchUpdateToRemoteWorkers({
    config: { serverUrl: 'https://biru.co.id/kerakerja/', secret: 'sec', projectId: 'prj_local' },
    hostname: 'my-pc',
    apiClient: fakeApiClient,
    createProjectClient: (projectKey) => ({
      addTask: async (instruction, opts) => {
        pushed.push({ projectKey, instruction, opts });
        return { data: { ok: true, id: `TASK-${projectKey}` } };
      }
    })
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.totalOnline, 4);
  assert.strictEqual(res.dispatchedCount, 2);
  assert.deepStrictEqual(pushed.map(p => p.projectKey), ['prj_ayo', 'prj_biru']);
  assert.strictEqual(pushed[0].instruction, '/update');
  assert.strictEqual(pushed[0].opts.priority, 'HIGH');
});
