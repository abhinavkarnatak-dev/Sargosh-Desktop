import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = process.cwd();
process.env.electron_config_cache ||= path.join(root, 'work', 'electron-cache');
const children = [];
const node = process.execPath;
const cli = packageName => require.resolve(packageName);
function start(command, args, extraEnv = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, ...extraEnv } });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping && code !== 0) stop(code || 1); });
  return child;
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {} }
      else child.kill('SIGTERM');
    }
  }
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Development service did not start: ' + url);
}
try {
  // Refuse to attach to somebody else's process on our development ports.
  for (const port of [5173, 4318]) {
    const net = await import('node:net');
    await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', () => reject(new Error('Port ' + port + ' is already in use. Stop the existing development run first.'))); server.listen(port, '127.0.0.1', () => server.close(resolve)); });
  }
  execFileSync(node, [cli('typescript/bin/tsc'), '-p', 'tsconfig.main.json'], { stdio: 'inherit' });
  start(node, [path.join(path.dirname(cli('vite/package.json')), 'bin', 'vite.js'), '--host', '127.0.0.1']);
  start(node, [cli('tsx/cli'), 'watch', 'src/server/index.ts']);
  await Promise.all([waitFor('http://127.0.0.1:5173'), waitFor('http://127.0.0.1:4318/health')]);
  if (!process.argv.includes('--preview')) {
    const electron = require('electron');
    start(electron, ['.'], { SARGOSH_RENDERER_URL: 'http://127.0.0.1:5173', ELECTRON_RUN_AS_NODE: undefined });
  }
  console.log('Sargosh is running. UI: http://127.0.0.1:5173 | API: http://127.0.0.1:4318/health');
  console.log('UI changes refresh automatically. Restart this command after desktop or helper changes.');
} catch (error) { console.error(error.message); stop(1); }
