const https = require('https');
const ApiClient = require('../api/client');

function escapeTelegramHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function postTelegramApi(botToken, method, payloadObj) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(payloadObj || {});
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 8000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: Boolean(parsed && parsed.ok), data: parsed, error: parsed && parsed.description });
        } catch (e) {
          resolve({ ok: false, error: 'Invalid Telegram response' });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    req.write(payload);
    req.end();
  });
}

async function resolveTelegramCredentials(config) {
  let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || '';

  if (config && config.serverUrl && config.secret) {
    try {
      const api = new ApiClient(config.serverUrl, config.secret, config.projectId);
      const res = await api.request('projects');
      const projects = (res && res.data && Array.isArray(res.data.projects)) ? res.data.projects : [];
      const target = projects.find((p) => (
        p.project_key === config.projectId ||
        String(p.id) === String(config.projectId) ||
        (p.code && p.code.toLowerCase() === String(config.projectId || '').toLowerCase()) ||
        p.name === config.projectId
      )) || projects[0];
      if (target) {
        if (target.bot_token) botToken = target.bot_token;
        if (target.telegram_chat_id) chatId = target.telegram_chat_id;
      }
    } catch (e) {}
  }

  return { botToken, chatId };
}

async function sendTelegramHtml(config, htmlText, extraPayload = {}) {
  const { botToken, chatId } = await resolveTelegramCredentials(config);
  if (!botToken || !chatId) {
    return { ok: false, error: 'Kredensial Telegram (bot_token/chat_id) tidak tersedia' };
  }
  return postTelegramApi(botToken, 'sendMessage', {
    chat_id: chatId,
    text: htmlText,
    parse_mode: 'HTML',
    ...(extraPayload && typeof extraPayload === 'object' ? extraPayload : {})
  });
}

module.exports = {
  escapeTelegramHtml,
  postTelegramApi,
  resolveTelegramCredentials,
  sendTelegramHtml
};
