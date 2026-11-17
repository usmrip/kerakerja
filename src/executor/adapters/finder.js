const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Find executable binary in PATH or standard user directories
 * @param {string} binName 
 * @returns {string|null}
 */
function findCli(binName) {
  const isWin = process.platform === 'win32';
  const checkCmd = isWin ? `where.exe "${binName}" 2>nul` : `which "${binName}" 2>/dev/null`;

  try {
    const out = execSync(checkCmd, { encoding: 'utf-8', timeout: 3000, windowsHide: true }).trim();
    if (out) {
      const firstLine = out.split(/\r?\n/)[0].trim();
      if (fs.existsSync(firstLine)) return firstLine;
    }
  } catch (e) {}

  // Fallback to standard installation paths
  const homedir = process.env.USERPROFILE || process.env.HOME || '';
  const standardPaths = [];

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';

    standardPaths.push(
      path.join(localAppData, binName, 'bin', `${binName}.exe`),
      path.join(localAppData, 'Programs', binName, `${binName}.exe`),
      path.join(appData, 'npm', `${binName}.cmd`),
      path.join(programFiles, 'nodejs', `${binName}.cmd`),
      path.join(homedir, '.gemini', 'antigravity', 'bin', `${binName}.exe`),
      path.join(localAppData, 'agy', 'bin', `${binName}.exe`)
    );
  } else {
    standardPaths.push(
      `/usr/local/bin/${binName}`,
      `/usr/bin/${binName}`,
      path.join(homedir, '.local', 'bin', binName),
      path.join(homedir, '.npm-global', 'bin', binName)
    );
  }

  for (const p of standardPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

module.exports = {
  findCli
};
