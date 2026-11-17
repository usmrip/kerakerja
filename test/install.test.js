const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { addDirToWindowsPath, normalizeWinPathEntry } = require('../scripts/install');
const { getInstallPaths } = require('../scripts/uninstall');

test('Installer - normalizeWinPathEntry menormalkan slash akhir dan huruf kapital', () => {
  assert.strictEqual(
    normalizeWinPathEntry('C:\\Users\\Demo\\AppData\\Local\\tele-vs-cli\\bin\\'),
    'c:\\users\\demo\\appdata\\local\\tele-vs-cli\\bin'
  );
  assert.strictEqual(
    normalizeWinPathEntry('  C:/Users/Demo/AppData/Local/tele-vs-cli/bin/  '),
    'c:/users/demo/appdata/local/tele-vs-cli/bin'
  );
});

test('Installer - addDirToWindowsPath menambahkan direktori baru dan mencegah duplikasi', () => {
  let writtenEnv = null;
  let callCount = 0;
  const mockExec = (cmd, opts) => {
    callCount++;
    if (cmd.includes('GetEnvironmentVariable')) {
      return 'C:\\Windows\\System32;C:\\Program Files\\nodejs;';
    }
    if (cmd.includes('SetEnvironmentVariable')) {
      writtenEnv = opts?.env?.__TELE_NEW_PATH || '';
      return '';
    }
    return '';
  };

  const target = 'C:\\Users\\iam\\AppData\\Local\\tele-vs-cli\\bin';
  const res1 = addDirToWindowsPath(target, mockExec);
  assert.strictEqual(res1.added, true);
  assert.strictEqual(writtenEnv, 'C:\\Windows\\System32;C:\\Program Files\\nodejs;C:\\Users\\iam\\AppData\\Local\\tele-vs-cli\\bin');
  assert.strictEqual(callCount, 2);

  // Jika sudah ada (dengan trailing slash & beda huruf besar/kecil), jangan duplikasi
  const mockExecExisting = (cmd) => {
    if (cmd.includes('GetEnvironmentVariable')) {
      return 'C:\\Windows\\System32;c:\\users\\iam\\appdata\\local\\tele-vs-cli\\bin\\';
    }
    throw new Error('SetEnvironmentVariable tidak boleh dipanggil jika sudah ada');
  };
  const res2 = addDirToWindowsPath(target, mockExecExisting);
  assert.strictEqual(res2.added, false);
});

test('Installer - install.ps1 me-refresh $env:Path sesi PowerShell setelah instalasi', () => {
  const ps1 = fs.readFileSync(path.join(__dirname, '..', 'install.ps1'), 'utf-8');
  assert.ok(ps1.includes('$env:Path ='));
  assert.ok(ps1.includes('tele-vs-cli\\bin'));
});

test('Installer - scripts/install.js tidak membuat tele.ps1 agar aman dari ExecutionPolicy Restricted', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install.js'), 'utf-8');
  assert.ok(src.includes('legacyPs1Path'));
  assert.ok(src.includes('fs.unlinkSync(legacyPs1Path)'));

  const winPaths = getInstallPaths('win32', 'C:\\Users\\Demo', 'C:\\Users\\Demo\\AppData\\Local');
  assert.ok(winPaths.launchers.some(p => p.endsWith('tele.cmd')));
  assert.ok(winPaths.launchers.some(p => p.endsWith('tele')));
});
