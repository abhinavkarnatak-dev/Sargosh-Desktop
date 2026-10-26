import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build this beta on 64-bit Windows.');
const root = process.cwd();
const localPython = path.join(root, '.venv', 'Scripts', 'python.exe');
const python = process.env.SARGOSH_PYTHON || (existsSync(localPython) ? localPython : 'python');
function run(args) {
  const result = spawnSync(python, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Windows helper build failed. Install helper/requirements-build.txt in .venv first.');
}
run(['-c', "import struct; assert struct.calcsize('P') == 8, 'Use 64-bit Python'; import PyInstaller; import comtypes.client; comtypes.client.GetModule('UIAutomationCore.dll')"]);
mkdirSync('helper/build', { recursive: true });
run(['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console', '--name', 'sargosh-helper', '--distpath', 'helper/dist', '--workpath', 'helper/build', '--specpath', 'helper/build', '--paths', 'helper', '--hidden-import', 'comtypes.gen.UIAutomationClient', '--collect-submodules', 'comtypes.gen', 'helper/main.py']);
console.log('Windows helper bundled with its Python runtime.');
