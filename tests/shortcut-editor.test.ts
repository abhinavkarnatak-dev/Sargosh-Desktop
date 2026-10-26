// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ShortcutEditor } from '../src/renderer/ShortcutEditor';
import { INITIAL_WINDOWS_STATE } from '../src/shared/windows';
vi.mock('../src/renderer/audio/runtime', () => ({ cloudBusy: () => false, recording: { getState: () => ({ phase: 'idle' }) } }));
let host: HTMLDivElement; let root: Root;
const persist = vi.fn(async (_value: string) => {}); const arm = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); persist.mockReset(); arm.mockReset();
  let state = { ...INITIAL_WINDOWS_STATE, purpose: 'recording' as const, enabled: true };
  window.sargosh = { windowsStatus: async () => state, windowsAction: async () => state = { ...state, enabled: false },
    startWindowsRecording: arm.mockImplementation(async (shortcut: string) => state = { ...state, shortcut, enabled: true }) } as unknown as NonNullable<typeof window.sargosh>;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.sargosh; vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(createElement(StrictMode, null, createElement(ShortcutEditor, { shortcut: INITIAL_WINDOWS_STATE.shortcut, onSave: persist })))); }
async function choose() { await act(async () => (host.querySelector('button') as HTMLElement).click()); }
async function key(type: string, key: string, code: string, modifiers = {}) { await act(async () => host.querySelector('input')!.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, ...modifiers }))); }
it('automatically saves only after the full combination is released and resumes recording shortcuts', async () => {
  await render(); await choose(); expect((host.querySelector('input') as HTMLInputElement).disabled).toBe(false);
  await key('keydown', 'k', 'KeyK', { ctrlKey: true, altKey: true }); expect(persist).not.toHaveBeenCalled();
  await key('keyup', 'k', 'KeyK', { ctrlKey: true, altKey: true }); expect(persist).not.toHaveBeenCalled();
  await key('keyup', 'Control', 'ControlLeft');
  expect(persist).toHaveBeenCalledExactlyOnceWith('Control+Alt+K'); expect(arm).toHaveBeenCalledExactlyOnceWith('Control+Alt+K'); expect(host.textContent).toContain('Shortcut saved.');
});
it('rejects unsupported keys without saving them', async () => {
  await render(); await choose(); await key('keydown', 'a', 'KeyA'); await key('keyup', 'a', 'KeyA');
  expect(persist).not.toHaveBeenCalled(); expect(host.textContent).toContain('Use Ctrl, Alt, or Win');
});
it('shows a save failure and allows cancel to restore the original shortcut', async () => {
  await render(); await choose(); persist.mockRejectedValueOnce(new Error('Shortcut could not be saved.'));
  await key('keydown', 'k', 'KeyK', { ctrlKey: true }); await key('keyup', 'Control', 'ControlLeft');
  expect(host.textContent).toContain('Shortcut could not be saved.'); expect(arm).not.toHaveBeenCalled();
  await choose(); expect(arm).toHaveBeenCalledExactlyOnceWith(INITIAL_WINDOWS_STATE.shortcut);
});
it('restores the old shortcut when the editor closes without saving', async () => {
  await render(); await choose(); await act(async () => root.render(null)); expect(arm).toHaveBeenCalledExactlyOnceWith(INITIAL_WINDOWS_STATE.shortcut);
});
