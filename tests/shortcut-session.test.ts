import { expect, it, vi } from 'vitest';
import { ShortcutSession } from '../src/renderer/shortcut-session';
import { INITIAL_WINDOWS_STATE, type WindowsState } from '../src/shared/windows';
function setup(enabled = true, purpose: 'recording' | 'input-test' = 'recording') {
  let state = { ...INITIAL_WINDOWS_STATE, enabled, purpose };
  const bridge = {
    windowsStatus: vi.fn(async () => state),
    windowsAction: vi.fn(async () => state = { ...state, enabled: false }),
    startWindowsRecording: vi.fn(async (shortcut: string): Promise<WindowsState> => state = { ...state, enabled: true, purpose: 'recording', shortcut }),
    startWindowsTest: vi.fn(async (shortcut: string): Promise<WindowsState> => state = { ...state, enabled: true, purpose: 'input-test', shortcut })
  };
  const persist = vi.fn(async (_shortcut: string) => {}); const busy = vi.fn(() => false);
  return { bridge, persist, busy, flow: new ShortcutSession(bridge, persist, busy) };
}
it('pauses an active hook and saves before resuming the same mode with the new shortcut', async () => {
  const { flow, bridge, persist } = setup(); await flow.begin();
  expect(bridge.windowsAction).toHaveBeenCalledWith('disarm'); expect(persist).not.toHaveBeenCalled();
  await flow.save('Control+Alt+K'); expect(persist).toHaveBeenCalledExactlyOnceWith('Control+Alt+K');
  expect(bridge.startWindowsRecording).toHaveBeenCalledExactlyOnceWith('Control+Alt+K');
  expect(persist.mock.invocationCallOrder[0]).toBeLessThan(bridge.startWindowsRecording.mock.invocationCallOrder[0]);
  await flow.dispose(); expect(bridge.startWindowsRecording).toHaveBeenCalledOnce();
});
it('keeps a disabled shortcut disabled after saving', async () => {
  const { flow, bridge } = setup(false); await flow.begin(); await flow.save('Control+K');
  expect(bridge.windowsAction).not.toHaveBeenCalled(); expect(bridge.startWindowsRecording).not.toHaveBeenCalled();
});
it('restores the previous shortcut on cancel after a failed save', async () => {
  const { flow, bridge, persist } = setup(); await flow.begin(); persist.mockRejectedValueOnce(new Error('Disk unavailable'));
  await expect(flow.save('Control+K')).rejects.toThrow('Disk unavailable'); expect(bridge.startWindowsRecording).not.toHaveBeenCalled();
  await flow.cancel(); expect(bridge.startWindowsRecording).toHaveBeenCalledExactlyOnceWith(INITIAL_WINDOWS_STATE.shortcut);
});
it('restores input-test mode without silently enabling microphone recording', async () => {
  const { flow, bridge } = setup(true, 'input-test'); await flow.begin(); await flow.save('Alt+K');
  expect(bridge.startWindowsTest).toHaveBeenCalledExactlyOnceWith('Alt+K'); expect(bridge.startWindowsRecording).not.toHaveBeenCalled();
});
it('restores the hook when Settings closes during a delayed pause', async () => {
  const { flow, bridge } = setup(); let resume!: () => void;
  const original = bridge.windowsAction.getMockImplementation()!;
  bridge.windowsAction.mockImplementationOnce(async () => { await new Promise<void>(done => { resume = done; }); return original(); });
  const starting = flow.begin(); await vi.waitFor(() => expect(bridge.windowsAction).toHaveBeenCalledOnce());
  const closed = flow.dispose(); resume(); await starting; await closed;
  expect(bridge.startWindowsRecording).toHaveBeenCalledExactlyOnceWith(INITIAL_WINDOWS_STATE.shortcut);
});
it('does not interrupt a recording or cloud processing to edit a shortcut', async () => {
  const { flow, bridge, busy } = setup(); busy.mockReturnValue(true);
  await expect(flow.begin()).rejects.toThrow('Finish the current dictation'); expect(bridge.windowsAction).not.toHaveBeenCalled();
});
it('reports an activation failure without claiming the persisted preference was lost', async () => {
  const { flow, bridge, persist } = setup(); await flow.begin();
  bridge.startWindowsRecording.mockResolvedValueOnce({ ...INITIAL_WINDOWS_STATE, enabled: false, purpose: 'recording' });
  await expect(flow.save('Control+K')).rejects.toThrow('Shortcut saved, but'); expect(persist).toHaveBeenCalledOnce();
});
