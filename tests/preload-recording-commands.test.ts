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

it('sends only drag start geometry and stop rather than per-movement screen deltas', async () => {
  const pill = { x: 167.5, y: 68, width: 85, height: 40 };
  await bridge.overlayDrag!('start', pill); await bridge.overlayDrag!('stop');
  expect(electron.invoke).toHaveBeenCalledWith('sargosh:overlay-drag', { action: 'start', pill, reducedMotion: undefined });
  expect(electron.invoke).toHaveBeenCalledWith('sargosh:overlay-drag', { action: 'stop', pill: undefined, reducedMotion: undefined });
});

it('gets and subscribes to dock layout through named channels with listener cleanup', async () => {
  await bridge.overlayDockState!(); expect(electron.invoke).toHaveBeenCalledWith('sargosh:overlay-dock-state');
  const listener = vi.fn(), unsubscribe = bridge.onOverlayDock!(listener);
  const handler = electron.on.mock.calls.find(call => call[0] === 'sargosh:overlay-dock')![1];
  handler({}, { position: 'left', dragging: false, target: null });
  expect(listener).toHaveBeenCalledWith({ position: 'left', dragging: false, target: null });
  unsubscribe(); expect(electron.remove).toHaveBeenCalledWith('sargosh:overlay-dock', handler);
});

it('sends only a resolved light or dark theme to the native title bar', async () => {
  await bridge.setWindowTheme('dark');
  expect(electron.invoke).toHaveBeenCalledWith('sargosh:window-theme', 'dark');
});

it('exposes a read-only resolved theme to the overlay and releases its theme listener',async()=>{
  await bridge.windowTheme?.();expect(electron.invoke).toHaveBeenCalledWith('sargosh:window-theme-state');
  const listener=vi.fn(),release=bridge.onWindowTheme!(listener);
  const handler=electron.on.mock.calls[0][1];handler({},'dark');expect(listener).toHaveBeenCalledWith('dark');
  release();expect(electron.remove).toHaveBeenCalledWith('sargosh:window-theme-changed',handler);
});

it('routes history actions through named channels and releases its update listener', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const capture = { id, audio: new ArrayBuffer(4), mimeType: 'audio/webm', language: 'en' as const, cleanupEnabled: true };
  const result = { id, text: 'Hello.', originalText: 'hello', language: 'en' as const, cleanupEnabled: true, status: 'completed' as const };
  await bridge.saveHistory(capture); await bridge.updateHistory(result);
  await bridge.listHistory({ id, createdAt: '2026-10-26T10:00:00.000Z' });
  await bridge.historyAudio(id); await bridge.retryHistory(id); await bridge.extractHistoryAudio(id); await bridge.copyHistoryText(id); await bridge.deleteEntry(id);
  expect(electron.invoke.mock.calls).toEqual([
    ['sargosh:history-save', capture], ['sargosh:history-update', result],
    ['sargosh:history-list', { id, createdAt: '2026-10-26T10:00:00.000Z' }],
    ['sargosh:history-audio', id], ['sargosh:history-retry', id], ['sargosh:history-extract', id], ['sargosh:history-copy', id], ['sargosh:delete', id]
  ]);
  const changed = vi.fn(); const release = bridge.onHistoryChanged(changed);
  const handler = electron.on.mock.calls[0][1]; handler(); expect(changed).toHaveBeenCalledOnce();
  release(); expect(electron.remove).toHaveBeenCalledWith('sargosh:history-changed', handler);
});

it('exposes named account actions and a profile-only auth event without a raw-token getter', async () => {
  await bridge.authState();await bridge.sendEmailCode('person@example.com');await bridge.verifyEmailCode('person@example.com','123456');await bridge.signInGoogle();await bridge.cancelGoogleSignIn();await bridge.updateProfile('Priya','Sharma');await bridge.signOut();
  expect(electron.invoke).toHaveBeenCalledWith('sargosh:auth-verify-code',{email:'person@example.com',code:'123456'});expect(electron.invoke).toHaveBeenCalledWith('sargosh:auth-profile',{firstName:'Priya',lastName:'Sharma'});
  expect(Object.keys(bridge).some(key=>/accessToken|refreshToken/i.test(key))).toBe(false);
  const listener=vi.fn();const release=bridge.onAuthState(listener);const handler=electron.on.mock.calls[0][1];handler({}, {phase:'signed-out',user:null});expect(listener).toHaveBeenCalledWith({phase:'signed-out',user:null});release();expect(electron.remove).toHaveBeenCalledWith('sargosh:auth-state',handler);
});
