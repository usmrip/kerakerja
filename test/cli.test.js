const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const path = require('path');
const quotaCommand = require('../src/cli/commands/quota');

test('CLI - tele help berjalan dengan exit code 0 dan memuat quota serta verbose', () => {
  const binPath = path.join(__dirname, '..', 'bin', 'tele.js');
  const out = execSync(`node "${binPath}" help`, { encoding: 'utf-8' });
  assert.ok(out.includes('Tele-vs-CLI'));
  assert.ok(out.includes('doctor'));
  assert.ok(out.includes('start'));
  assert.ok(out.includes('quota'));
  assert.ok(out.includes('--verbose'));
});

test('CLI - tele quota --json menghasilkan struktur data kuota yang valid', () => {
  const binPath = path.join(__dirname, '..', 'bin', 'tele.js');
  const out = execSync(`node "${binPath}" quota --json`, { encoding: 'utf-8' });
  const data = JSON.parse(out);
  assert.ok(data.agent);
  assert.ok(data.models);
  assert.ok(Array.isArray(data.models));
  assert.ok(data.quota);
  assert.ok(Array.isArray(data.quota.groups));
  assert.strictEqual(data.agent.verboseSupported, true);
});

test('Quota helpers - renderProgressBar dan formatRefreshRemaining bekerja akurat', () => {
  assert.strictEqual(quotaCommand.renderProgressBar(1, 10), '[██████████]');
  assert.strictEqual(quotaCommand.renderProgressBar(0, 10), '[░░░░░░░░░░]');
  assert.strictEqual(quotaCommand.renderProgressBar(0.5, 10), '[█████░░░░░]');
  assert.strictEqual(quotaCommand.renderProgressBar(1.5, 10), '[██████████]');

  const now = Date.parse('2026-11-16T00:00:00Z');
  assert.strictEqual(quotaCommand.formatRefreshRemaining('2026-11-16T01:30:00Z', now), '1h 30m');
  assert.strictEqual(quotaCommand.formatRefreshRemaining('2026-11-15T23:00:00Z', now), 'Refreshing soon');
  assert.strictEqual(quotaCommand.formatRefreshRemaining('invalid', now), null);
});

test('Quota helpers - parseAgyQuotaOutput mem-parsing grup kuota AGY dengan benar', () => {
  const now = Date.parse('2026-11-16T04:00:00Z');
  const sample = JSON.stringify({
    command: {
      name: 'usage',
      data: {
        description: 'Sample quota description',
        groups: [
          {
            name: 'Gemini Models',
            description: 'Models within this group: Gemini 4 Hydrogen, Gemini 3.8 Flash',
            buckets: [
              {
                id: 'gemini-weekly',
                name: 'Weekly Limit Remaining',
                window: 'weekly',
                remaining_fraction: 0.7675,
                reset_time: '2026-11-21T05:29:00Z'
              }
            ]
          },
          {
            name: 'Claude and GPT models',
            description: 'Models within this group: Claude Opus 5.5',
            buckets: [
              {
                id: '3p-weekly',
                name: 'Weekly Limit Remaining',
                window: 'weekly',
                remaining_fraction: 1,
                reset_time: '2026-11-23T04:00:00Z'
              }
            ]
          }
        ]
      }
    }
  });

  const parsed = quotaCommand.parseAgyQuotaOutput(sample, now);
  assert.ok(parsed);
  assert.strictEqual(parsed.description, 'Sample quota description');
  assert.strictEqual(parsed.groups.length, 2);
  assert.strictEqual(parsed.groups[0].buckets[0].remainingPercent, 76.75);
  assert.strictEqual(parsed.groups[0].buckets[0].statusText, 'Refreshes in 121h 29m');
  assert.strictEqual(parsed.groups[1].buckets[0].remainingPercent, 100);
  assert.strictEqual(parsed.groups[1].buckets[0].statusText, 'Quota available');
  assert.strictEqual(quotaCommand.parseAgyQuotaOutput('not-json'), null);
});
