const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  parseUninstallArgs,
  removeDirFromWindowsPath,
  getInstallPaths
} = require('../scripts/uninstall');

test('Uninstaller - Skrip uninstall multi-OS (Linux, macOS, Windows) tersedia dan valid', () => {
  const rootDir = path.join(__dirname, '..');
  const shPath = path.join(rootDir, 'uninstall.sh');
  const psPath = path.join(rootDir, 'uninstall.ps1');
  const cmdPath = path.join(rootDir, 'uninstall.cmd');
  const nodePath = path.join(rootDir, 'scripts', 'uninstall.js');

  assert.ok(fs.existsSync(shPath), 'uninstall.sh harus ada');
  assert.ok(fs.existsSync(psPath), 'uninstall.ps1 harus ada');
  assert.ok(fs.existsSync(cmdPath), 'uninstall.cmd harus ada');
  assert.ok(fs.existsSync(nodePath), 'scripts/uninstall.js harus ada');

  const shContent = fs.readFileSync(shPath, 'utf-8');
  assert.ok(shContent.includes('OS_NAME'));
  assert.ok(shContent.includes('scripts/uninstall.js'));
  assert.ok(shContent.includes('systemctl --user'));
  assert.ok(shContent.includes('launchctl unload'));

  const psContent = fs.readFileSync(psPath, 'utf-8');
  assert.ok(psContent.includes('TargetDir'));
  assert.ok(psContent.includes('scripts\\uninstall.js'));
  assert.ok(psContent.includes('TeleVsCliWorker'));

  const cmdContent = fs.readFileSync(cmdPath, 'utf-8');
  assert.ok(cmdContent.includes('uninstall.ps1'));
});

test('Uninstaller - parseUninstallArgs mem-parsing opsi CLI dengan benar', () => {
  assert.deepStrictEqual(parseUninstallArgs([]), {
    yes: false,
    purge: false,
    dryRun: false,
    help: false
  });

  assert.deepStrictEqual(parseUninstallArgs(['--yes', '--purge', '--dry-run']), {
    yes: true,
    purge: true,
    dryRun: true,
    help: false
  });

  assert.deepStrictEqual(parseUninstallArgs(['-y', '--all', '-h']), {
    yes: true,
    purge: true,
    dryRun: false,
    help: true
  });
});

test('Uninstaller - removeDirFromWindowsPath menghapus entri PATH secara aman', () => {
  const target = 'C:\\Users\\iam\\AppData\\Local\\tele-vs-cli\\bin';
  const input = `C:\\Windows\\System32;${target}\\;C:\\Program Files\\nodejs`;
  const res = removeDirFromWindowsPath(input, target);

  assert.strictEqual(res.changed, true);
  assert.strictEqual(res.newPath, 'C:\\Windows\\System32;C:\\Program Files\\nodejs');

  const noChange = removeDirFromWindowsPath('C:\\Windows\\System32;C:\\Program Files\\nodejs', target);
  assert.strictEqual(noChange.changed, false);
  assert.strictEqual(noChange.newPath, 'C:\\Windows\\System32;C:\\Program Files\\nodejs');
});

test('Uninstaller - getInstallPaths mengembalikan path sesuai OS (win32, linux, darwin)', () => {
  const winPaths = getInstallPaths('win32', 'C:\\Users\\test', 'C:\\Users\\test\\AppData\\Local');
  assert.strictEqual(winPaths.serviceName, 'TeleVsCliWorker');
  assert.ok(winPaths.appDir.endsWith(path.join('tele-vs-cli', 'app')));
  assert.strictEqual(winPaths.launchers.length, 3);

  const linuxPaths = getInstallPaths('linux', '/home/test');
  assert.strictEqual(linuxPaths.appDir, path.join('/home/test', '.tele-vs-cli'));
  assert.strictEqual(linuxPaths.launchers[0], path.join('/home/test', '.local', 'bin', 'tele'));
  assert.ok(linuxPaths.systemdUnit.endsWith('tele-vs-cli.service'));

  const macPaths = getInstallPaths('darwin', '/Users/test');
  assert.strictEqual(macPaths.appDir, path.join('/Users/test', '.tele-vs-cli'));
  assert.ok(macPaths.launchdPlist.endsWith('com.usmrip.tele-vs-cli.plist'));
});

test('Uninstaller - scripts/uninstall.js --help dan --dry-run berjalan sukses', () => {
  const nodePath = path.join(__dirname, '..', 'scripts', 'uninstall.js');
  const helpOut = execSync(`node "${nodePath}" --help`, { encoding: 'utf-8' });
  assert.ok(helpOut.includes('Tele-vs-CLI Universal Uninstaller'));
  assert.ok(helpOut.includes('--purge'));
  assert.ok(helpOut.includes('--dry-run'));

  const dryOut = execSync(`node "${nodePath}" --dry-run`, { encoding: 'utf-8' });
  assert.ok(dryOut.includes('DRY-RUN'));
  assert.ok(dryOut.includes('Simulasi Uninstall Selesai'));
});

test('CLI - tele help menampilkan perintah uninstall', () => {
  const binPath = path.join(__dirname, '..', 'bin', 'tele.js');
  const out = execSync(`node "${binPath}" help`, { encoding: 'utf-8' });
  assert.ok(out.includes('uninstall'));
});
