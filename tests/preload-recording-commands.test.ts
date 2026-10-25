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

it('routes real text and cancellation through the restricted desktop bridge', async () => {
  const request = { sessionId: 'session', targetId: 'target', text: 'A real transcript.' };
  await bridge.deliverText(request);
  expect(electron.invoke).toHaveBeenCalledWith('sargosh:deliver-text', request);
  await bridge.cancelDelivery('session');
  expect(electron.invoke).toHaveBeenCalledWith('sargosh:delivery-cancel', 'session');
});

it('routes recovery copy, resizing, and microphone settings through named desktop actions', async () => {
  await bridge.copyOverlayText('notice'); await bridge.resizeOverlay(300); await bridge.openSettings();
  expect(electron.invoke).toHaveBeenCalledWith('sargosh:overlay-copy', 'notice');
  expect(electron.invoke).toHaveBeenCalledWith('sargosh:overlay-resize', 300);
  expect(electron.invoke).toHaveBeenCalledWith('sargosh:open-settings');
  const open = vi.fn(); const unsubscribe = bridge.onOpenSettings(open);
  const handler = electron.on.mock.calls[0][1]; handler(); expect(open).toHaveBeenCalledOnce();
  unsubscribe(); expect(electron.remove).toHaveBeenCalledWith('sargosh:open-settings', handler);
});

it('sends only a resolved light or dark theme to the native title bar', async () => {
  await bridge.setWindowTheme('dark');
  expect(electron.invoke).toHaveBeenCalledWith('sargosh:window-theme', 'dark');
});
