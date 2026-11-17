const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execSync } = require('child_process');

const TeleWorker = require('../src/worker/worker');
const { buildWhereData, formatWhereTelegramHtml } = require('../src/cli/commands/where');

test('Worker - parseWhereCommand mem-parsing /where dengan berbagai format', () => {
  assert.strictEqual(TeleWorker.parseWhereCommand('/where'), true);
  assert.strictEqual(TeleWorker.parseWhereCommand('/where@KeraKerjaBot'), true);
  assert.strictEqual(TeleWorker.parseWhereCommand('  /WHERE --json '), true);
  assert.strictEqual(TeleWorker.parseWhereCommand('tolong /where'), false);
  assert.strictEqual(TeleWorker.parseWhereCommand(''), false);
});

test('Worker - selectNextCliTask memprioritaskan /where sebagai system command', () => {
  const tasks = [
    { id: 'TASK-1', status: 'PENDING', instruction: 'Buat fitur A' },
    { id: 'TASK-2', status: 'PENDING', instruction: '/where' }
  ];
  const { task } = TeleWorker.selectNextCliTask(tasks, 'w-cli');
  assert.ok(task);
  assert.strictEqual(task.id, 'TASK-2');
});

test('Where - buildWhereData dan formatWhereTelegramHtml mengembalikan direktori kerja aktif', () => {
  const cwd = process.cwd();
  const data = buildWhereData(cwd);
  assert.strictEqual(data.workDir, path.resolve(cwd));
  assert.strictEqual(data.exists, true);
  assert.ok(data.projectId);
  assert.ok(data.hostname);

  const html = formatWhereTelegramHtml(data);
  assert.ok(html.includes('DIREKTORI KERJA AKTIF'));
  assert.ok(html.includes(data.workDir));
  assert.ok(html.includes(data.projectId));
});

test('TeleWorker - handleWhereInstruction menyelesaikan task dengan info workDir aktif', async () => {
  const worker = new TeleWorker({ workDir: process.cwd(), workerId: 'w-where-test' });
  const calls = { started: null, done: null, failed: null };

  worker.api = {
    async startTask(id, workerId, agent) {
      calls.started = { id, workerId, agent };
      return { status: 200, data: { ok: true } };
    },
    async doneTask(id, summary, commitHash, log, extra) {
      calls.done = { id, summary, commitHash, log, extra };
      return { status: 200, data: { ok: true } };
    },
    async failTask(id, msg) {
      calls.failed = { id, msg };
      return { status: 200, data: { ok: true } };
    }
  };

  await worker.handleWhereInstruction({ id: 'TASK-585e', instruction: '/where' });

  assert.strictEqual(calls.failed, null);
  assert.strictEqual(calls.started.id, 'TASK-585e');
  assert.strictEqual(calls.done.id, 'TASK-585e');
  assert.ok(calls.done.summary.includes(path.resolve(process.cwd())));
});

test('CLI - kerakerja where --json dan /where --json berjalan sukses', () => {
  const binPath = path.join(__dirname, '..', 'bin', 'kerakerja.js');
  const out = execSync(`node "${binPath}" where --json`, { encoding: 'utf-8' });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.workDir, path.resolve(process.cwd()));
  assert.strictEqual(parsed.exists, true);

  const slashOut = execSync(`node "${binPath}" /where --json`, { encoding: 'utf-8' });
  const slashParsed = JSON.parse(slashOut);
  assert.strictEqual(slashParsed.workDir, path.resolve(process.cwd()));
});
