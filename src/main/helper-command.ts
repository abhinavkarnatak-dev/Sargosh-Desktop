import { existsSync } from 'node:fs';
import path from 'node:path';
export function helperCommand(root: string, dataDir: string, executable?: string) {
  if (executable) {
    if (!existsSync(executable)) throw new Error('The installed Windows helper is missing. Reinstall Sargosh.');
    return { command: executable, args: ['--data-dir', dataDir] };
  }
  const localPython = path.join(root, '.venv', 'Scripts', 'python.exe');
  return { command: process.env.SARGOSH_PYTHON || (existsSync(localPython) ? localPython : 'python'), args: [path.join(root, 'helper', 'main.py'), '--data-dir', dataDir] };
}
