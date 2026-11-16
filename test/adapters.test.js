const test = require('node:test');
const assert = require('node:assert');
const { AGENT_ADAPTERS, resolveAgent } = require('../src/executor/adapters/registry');

test('Adapters - Menyediakan adapter untuk agy, claude, gemini, cline, codex', () => {
  assert.ok(AGENT_ADAPTERS.agy, 'Harus ada adapter agy');
  assert.ok(AGENT_ADAPTERS.claude, 'Harus ada adapter claude');
  assert.ok(AGENT_ADAPTERS.gemini, 'Harus ada adapter gemini');
  assert.ok(AGENT_ADAPTERS.cline, 'Harus ada adapter cline');
  assert.ok(AGENT_ADAPTERS.codex, 'Harus ada adapter codex');
});

test('Adapters - getArgs menghasilkan argumen non-interaktif yang tepat', () => {
  const prompt = 'Test instruksi';
  const agyArgs = AGENT_ADAPTERS.agy.getArgs(prompt);
  assert.deepStrictEqual(agyArgs, ['-p', prompt, '--dangerously-skip-permissions']);

  const claudeArgs = AGENT_ADAPTERS.claude.getArgs(prompt);
  assert.deepStrictEqual(claudeArgs, ['-p', prompt]);

  const geminiArgs = AGENT_ADAPTERS.gemini.getArgs(prompt);
  assert.deepStrictEqual(geminiArgs, ['-p', prompt]);

  const codexArgs = AGENT_ADAPTERS.codex.getArgs(prompt);
  assert.deepStrictEqual(codexArgs, ['exec', prompt]);
});

test('Adapters - resolveAgent mengembalikan adapter saat dicari eksplisit', () => {
  const res = resolveAgent('claude');
  assert.ok(res);
  assert.strictEqual(res.key, 'claude');
});
