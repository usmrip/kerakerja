const test = require('node:test');
const assert = require('node:assert');
const initCommand = require('../src/cli/commands/init');

test('init - formatProjectChoices memformat daftar proyek dan opsi input manual', () => {
  const choices = initCommand.formatProjectChoices([
    { id: 1, name: 'Proyek A', code: 'a', project_key: 'prj_aaa' },
    { id: 2, name: 'Proyek B', code: '', project_key: 'prj_bbb' }
  ]);

  assert.strictEqual(choices.length, 3);
  assert.strictEqual(choices[0].value, 'prj_aaa');
  assert.ok(choices[0].label.includes('Proyek A [#a]'));
  assert.strictEqual(choices[0].manual, false);

  assert.strictEqual(choices[1].value, 'prj_bbb');
  assert.ok(choices[1].label.includes('Proyek B'));

  assert.strictEqual(choices[2].manual, true);
  assert.strictEqual(choices[2].value, '__MANUAL__');
});

test('init - computeNextIndex memutar pilihan panah atas dan bawah dengan benar', () => {
  assert.strictEqual(initCommand.computeNextIndex(0, 'up', 3), 2);
  assert.strictEqual(initCommand.computeNextIndex(2, 'down', 3), 0);
  assert.strictEqual(initCommand.computeNextIndex(1, 'up', 3), 0);
  assert.strictEqual(initCommand.computeNextIndex(1, 'down', 3), 2);
});

test('init - fetchServerProjects menangani API Key kosong secara aman', async () => {
  const res = await initCommand.fetchServerProjects('https://biru.co.id/tele-vs-cli/', '');
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.projects, []);
});
