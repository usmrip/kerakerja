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

test('Installer - install.cmd memperbarui PATH sesi CMD setelah endlocal', () => {
  const cmdSrc = fs.readFileSync(path.join(__dirname, '..', 'install.cmd'), 'utf-8');
  assert.ok(cmdSrc.includes('endlocal'));
  assert.ok(cmdSrc.includes('tele-vs-cli\\bin'));
  assert.ok(cmdSrc.includes('set "PATH=%PATH%;%_TELE_BIN%"'));
});

test('Windows - Tidak memunculkan popup konsol kosong (windowsHide: true & wscript launcher)', () => {
  const startSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'commands', 'start.js'), 'utf-8');
  assert.ok(startSrc.includes('windowsHide: true'));

  const cliExecSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'executor', 'cli.js'), 'utf-8');
  assert.ok(cliExecSrc.includes('windowsHide: true'));

  const serviceSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', 'commands', 'service.js'), 'utf-8');
  assert.ok(serviceSrc.includes('start-hidden.vbs'));
  assert.ok(serviceSrc.includes('wscript.exe'));
});

test('PowerShell - install.ps1 dan uninstall.ps1 murni ASCII agar aman dijalankan via irm | iex di PowerShell 5.1', () => {
  const installPs1 = fs.readFileSync(path.join(__dirname, '..', 'install.ps1'), 'utf-8');
  const uninstallPs1 = fs.readFileSync(path.join(__dirname, '..', 'uninstall.ps1'), 'utf-8');

  assert.ok(!installPs1.startsWith('#'), 'install.ps1 tidak boleh diawali komentar # agar aman untuk irm | iex');
  assert.strictEqual(/[^\x00-\x7F]/.test(installPs1), false, 'install.ps1 harus murni ASCII');
  assert.strictEqual(/[^\x00-\x7F]/.test(uninstallPs1), false, 'uninstall.ps1 harus murni ASCII');
});
