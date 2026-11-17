const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  getAppInfo,
  getProjectSwitchGuideLines,
  testCommunication
} = require('../src/utils/app_info');

test('app_info - getAppInfo mengembalikan versi aplikasi dan tanggal update terakhir', () => {
  const rootDir = path.resolve(__dirname, '..');
  const info = getAppInfo(rootDir);
  assert.strictEqual(typeof info.version, 'string');
  assert.ok(info.version.length > 0);
  assert.strictEqual(typeof info.lastUpdateDate, 'string');
  assert.ok(info.lastUpdateDate.length > 0);
  assert.strictEqual(info.hasGit, true);
  assert.ok(info.commitHash.length >= 7);
});

test('app_info - getProjectSwitchGuideLines menampilkan panduan /use <#tag> dan dropdown dashboard', () => {
  const defaultLines = getProjectSwitchGuideLines().join('\n');
  assert.ok(defaultLines.includes('/use <#tag>'));
  assert.ok(defaultLines.includes('Dashboard'));
  assert.ok(defaultLines.includes('dropdown'));

  const taggedLines = getProjectSwitchGuideLines('tvscli').join('\n');
  assert.ok(taggedLines.includes('/use #tvscli'));
  assert.ok(taggedLines.includes('#tvscli'));
});

test('app_info - testCommunication memverifikasi koneksi Workstation, Dashboard & Telegram (sukses)', async () => {
  const mockClient = {
    async request(endpoint) {
      assert.strictEqual(endpoint, 'projects');
      return {
        statusCode: 200,
        data: {
          ok: true,
          projects: [
            {
              id: 1,
              project_key: 'prj_abc123',
              name: 'Tele vs CLI',
              code: 'tvscli',
              bot_token: '123456:TESTTOKEN',
              chat_id: '987654321'
            }
          ]
        }
      };
    }
  };

  let sentTelegramUrl = '';
  let sentBody = null;
  const mockFetch = async (url, opts) => {
    sentTelegramUrl = url;
    sentBody = JSON.parse(opts.body);
    return {
      async json() {
        return { ok: true, result: { message_id: 42 } };
      }
    };
  };

  const result = await testCommunication(
    {
      serverUrl: 'https://biru.co.id/kerakerja/',
      secret: 'tvscli_testsecret',
      projectId: 'prj_abc123'
    },
    { client: mockClient, fetch: mockFetch }
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.dashboardOk, true);
  assert.strictEqual(result.telegramOk, true);
  assert.strictEqual(result.projectFound, true);
  assert.strictEqual(result.projectTag, 'tvscli');
  assert.ok(sentTelegramUrl.includes('123456:TESTTOKEN/sendMessage'));
  assert.strictEqual(sentBody.chat_id, '987654321');
  assert.ok(sentBody.text.includes('Test Komunikasi Tele-vs-CLI Berhasil'));
});

test('app_info - testCommunication menangani proyek belum terdaftar di website', async () => {
  const mockClient = {
    async request() {
      return {
        statusCode: 200,
        data: { ok: true, projects: [] }
      };
    }
  };

  const result = await testCommunication(
    {
      serverUrl: 'https://biru.co.id/kerakerja/',
      secret: 'tvscli_testsecret',
      projectId: 'prj_unregistered'
    },
    { client: mockClient, fetch: async () => ({ json: async () => ({ ok: true }) }) }
  );

  assert.strictEqual(result.dashboardOk, true);
  assert.strictEqual(result.projectFound, false);
  assert.strictEqual(result.telegramOk, false);
  assert.strictEqual(result.ok, false);
  assert.ok(result.messages.some(m => m.includes('belum terdaftar')));
});

test('app_info - testCommunication menangani kegagalan koneksi Dashboard', async () => {
  const mockClient = {
    async request() {
      throw new Error('Koneksi timeout');
    }
  };

  const result = await testCommunication(
    {
      serverUrl: 'https://biru.co.id/kerakerja/',
      secret: 'tvscli_testsecret',
      projectId: 'prj_abc123'
    },
    { client: mockClient }
  );

  assert.strictEqual(result.dashboardOk, false);
  assert.strictEqual(result.telegramOk, false);
  assert.strictEqual(result.ok, false);
  assert.ok(result.messages.some(m => m.includes('Koneksi timeout')));
});
