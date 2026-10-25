import { beforeEach, expect, it, vi } from 'vitest';
import type { DesktopBridge } from '../src/shared/types';
const electron = vi.hoisted(() => ({ expose: vi.fn(), on: vi.fn(), remove: vi.fn(), invoke: vi.fn(async () => {}) }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.expose }, ipcRenderer: { on: electron.on, removeListener: electron.remove, invoke: electron.invoke } }));
let bridge: DesktopBridge;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  await import('../src/main/preload'); bridge = electron.expose.mock.calls[0][1];
});
it('acknowledges only after the owner has finished handling the overlay action', async () => {
  let finish!: () => void;
  const unsubscribe = bridge.onRecordingCommand(() => new Promise<void>(resolve => { finish = resolve; }));
  const handler = electron.on.mock.calls[0][1];
  const pending = handler({}, { id: 'command', action: 'finish' });
  expect(electron.invoke).not.toHaveBeenCalled();
  finish(); await pending;
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith('sargosh:recording-command-result', { id: 'command', ok: true });
  unsubscribe(); expect(electron.remove).toHaveBeenCalledWith('sargosh:recording-command', handler);
});
it('returns an explicit failed acknowledgement when the owner rejects', async () => {
  bridge.onRecordingCommand(async () => { throw new Error('Stop failed'); });
  await electron.on.mock.calls[0][1]({}, { id: 'failed', action: 'cancel' });
  expect(electron.invoke).toHaveBeenCalledWith('sargosh:recording-command-result', { id: 'failed', ok: false });
});
it('still handles coordinator shutdown notifications', async () => {
  const cancel = vi.fn(); bridge.onRecordingCommand(cancel);
  await electron.on.mock.calls[0][1]({}, 'cancel');
  expect(cancel).toHaveBeenCalledWith('cancel'); expect(electron.invoke).not.toHaveBeenCalled();
});
