import { createInterface } from 'node:readline';
import path from 'node:path';
import { Helper } from '../src/main/helper';
import type { WindowsState } from '../src/shared/windows';

const helper = new Helper();
const autoInsert = process.argv.includes('--insert-on-finish');
const delivered = new Set<string>();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await helper.stop();
  process.exit(0);
}
helper.onEvent((event, data) => {
  if (event !== 'windows.state') return;
  const state = data as WindowsState;
  console.log(JSON.stringify({ phase: state.phase, mode: state.mode, target: state.target?.application || null, attempted: state.deliveryAttempted, message: state.message }));
  if (autoInsert && state.phase === 'finished' && state.target && state.sessionId && !state.deliveryAttempted && !delivered.has(state.sessionId)) {
    delivered.add(state.sessionId);
    void helper.call('windows.insert-test', { sessionId: state.sessionId }).catch(() => console.error('Test delivery failed. Inspect the destination.'));
  }
});
async function main() {
  console.log('Automatic insertion:', autoInsert ? 'ENABLED - sends "Sargosh input test." after finishing.' : 'DISABLED - shortcuts and destination tracking only.');
  if (!autoInsert) console.log('For fixed-text delivery, run: npm run test:windows:insert');
  // Configuration checks must exit before starting the helper or installing hooks.
  if (process.argv.includes('--check-config')) return;

try {
  await helper.start(process.cwd(), path.join(process.cwd(), 'work', 'windows-proof'));
  const state = await helper.call<WindowsState>('windows.arm', { shortcut: 'Control+Alt+Space', ignoredProcessIds: [process.pid] });
  console.log('Windows input test:', state.enabled ? 'ready' : state.message);
  console.log('Shortcut: Control+Alt+Space. Hold/release, or double-tap twice. Type quit here to remove the hook and exit.');
  if (autoInsert) console.log('On finish, the fixed sentence "Sargosh input test." will be inserted into the selected field. No microphone or cloud calls.');
  if (!state.enabled) { await helper.stop(); process.exitCode = 1; }
  else {
    const input = createInterface({ input: process.stdin });
    input.on('line', line => { if (line.trim() === 'quit') void close(); });
    input.on('close', () => void close());
    process.on('SIGINT', () => void close());
    process.on('SIGTERM', () => void close());
  }
} catch {
  console.error('Could not start the Windows test. Install helper/requirements.txt into .venv first.');
  await helper.stop();
  process.exitCode = 1;
}

}
void main();
