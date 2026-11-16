const path = require('path');

/**
 * Masking secret tokens and sensitive data in strings
 * @param {string} text 
 * @returns {string}
 */
function maskSecrets(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    // Telegram Bot Tokens: 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ (25-45 char hash)
    .replace(/\b\d{8,12}:[A-Za-z0-9_-]{25,45}\b/g, '[TELEGRAM_BOT_TOKEN_PROTECTED]')
    // Tele-vs-Code / CLI API Secret Keys: tvsc_...
    .replace(/\btvsc_[a-zA-Z0-9_\-]{16,64}\b/g, '[API_SECRET_PROTECTED]')
    // Common API Keys and Tokens
    .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]{16,}/gi, '$1[BEARER_TOKEN_PROTECTED]')
    .replace(/(password|secret|token)\s*[:=]\s*["']?([^\s"';&]+)["']?/gi, '$1=***PROTECTED***')
    // Project keys
    .replace(/\b(prj_[a-f0-9]{4,32})\b/gi, '$1');
}

/**
 * Validate and resolve workdir to prevent path traversal
 * @param {string} requestedDir 
 * @param {string} allowedRoot 
 * @returns {string}
 */
function validateWorkDir(requestedDir, allowedRoot = process.cwd()) {
  const resolved = path.resolve(allowedRoot, requestedDir || '.');
  const normalizedRoot = path.resolve(allowedRoot);

  if (requestedDir && requestedDir.includes('..')) {
    // Check if it escapes root
    const relative = path.relative(normalizedRoot, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`[SECURITY] Path traversal ditolak: ${requestedDir} keluar dari workspace yang diizinkan (${normalizedRoot})`);
    }
  }

  return resolved;
}

/**
 * Check if instruction contains dangerous low-level system commands
 * @param {string} instruction 
 * @returns {boolean}
 */
function isDangerousSystemCommand(instruction) {
  if (!instruction || typeof instruction !== 'string') return false;
  const lower = instruction.toLowerCase().trim();

  const dangerousPatterns = [
    /\b(reboot|shutdown|poweroff|halt|init\s+[06])\b/i,
    /\b(restart-computer|stop-computer)\b/i,
    /\b(rm\s+-rf\s+[\/\*]|rmdir\s+\/s\s+\/q\s+[a-z]:\\)/i,
    /\bformat\s+[a-z]:/i,
    /\bmkfs\.[a-z0-9]+/i,
    /(:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\};\s*:)/, // Fork bomb
    /\bdd\s+if=.*of=\/dev\/(sd[a-z]|nvme[0-9]n[0-9])/i
  ];

  return dangerousPatterns.some(pattern => pattern.test(lower));
}

module.exports = {
  maskSecrets,
  validateWorkDir,
  isDangerousSystemCommand
};
