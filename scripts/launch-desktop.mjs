import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
process.env.electron_config_cache ||= path.join(process.cwd(), 'work', 'electron-cache');
try {
  await Promise.all([
    fetch('http://127.0.0.1:5173', { signal: AbortSignal.timeout(2000) }).then(response => { if (!response.ok) throw new Error(); }),
    fetch('http://127.0.0.1:4318/health', { signal: AbortSignal.timeout(2000) }).then(response => { if (!response.ok) throw new Error(); })
  ]);
  const env = { ...process.env, SARGOSH_RENDERER_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['.'], { stdio: 'inherit', windowsHide: true, env });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(); });
} catch {
  console.error('Start the local services first with npm run dev:preview, then run npm run dev:desktop.');
  process.exitCode = 1;
}
