// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Overlay } from '../src/renderer/Overlay';
import { INITIAL_RECORDING_STATE, type RecordingState } from '../src/shared/recording';
import { INITIAL_WINDOWS_STATE } from '../src/shared/windows';
import type { TranscriptionStatus } from '../src/shared/transcription';

let root: Root;
let host: HTMLDivElement;
let audio: RecordingState;
let speech: TranscriptionStatus;
let updateAudio: (value: RecordingState) => void;
let updateSpeech: (value: TranscriptionStatus) => void;
const recordingAction = vi.fn();
const windowsAction = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  recordingAction.mockReset().mockResolvedValue(undefined);
  windowsAction.mockReset().mockResolvedValue({ ...INITIAL_WINDOWS_STATE, revision: 2, enabled: true, purpose: 'recording', phase: 'listening' });
  audio = { ...INITIAL_RECORDING_STATE, revision: 1, phase: 'recording', sessionId: 'one', mode: 'hands-free' };
  speech = { phase: 'idle', message: '' };
  window.sargosh = {
    onWindowsState: () => () => {}, windowsStatus: async () => ({ ...INITIAL_WINDOWS_STATE, enabled: true, purpose: 'recording' }),
    onRecordingState: (listener: (value: RecordingState) => void) => { updateAudio = listener; return () => {}; }, recordingStatus: async () => audio,
    onTranscriptionState: (listener: (value: TranscriptionStatus) => void) => { updateSpeech = listener; return () => {}; }, transcriptionStatus: async () => speech,
    recordingAction, windowsAction
  } as unknown as NonNullable<typeof window.sargosh>;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.sargosh; vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(createElement(Overlay))); }
async function press(label: string, button = 0) {
  const element = host.querySelector(`[aria-label="${label}"]`);
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button }));
    element!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button }));
    if (button === 0 && !(element as HTMLButtonElement).disabled) element!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  });
  return element!;
}
it('starts hands-free from the idle overlay', async () => {
  audio = { ...INITIAL_RECORDING_STATE, revision: 1 };
  await render();
  await act(async () => host.querySelector('.overlay-pill')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await press('Start hands-free recording');
  expect(windowsAction).toHaveBeenCalledExactlyOnceWith('start-hands-free');
});
it.each([['Cancel recording', 'cancel'], ['Finish recording', 'finish']])('routes %s to the recording owner', async (label, action) => {
  await render(); await press(label);
  expect(recordingAction).toHaveBeenCalledExactlyOnceWith(action);
});
it.each(['Transcribing audio...', 'Cleaning transcript...'])('shows only dots and a loader while text is prepared: %s', async message => {
  speech = { phase: 'working', message }; await render();
  expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Preparing text');
  expect(host.querySelectorAll('.overlay-wave i')).toHaveLength(7);
  expect(host.querySelector('.overlay-wave')?.nextElementSibling?.classList.contains('overlay-spinner')).toBe(true);
  expect(host.querySelector('button')).toBeNull();
  expect(host.textContent).not.toMatch(/transcrib|clean|finish/i);
});
it('keeps keyboard activation and ignores right mouse presses', async () => {
  await render(); const button = await press('Finish recording', 2);
  expect(recordingAction).not.toHaveBeenCalled();
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
  expect(recordingAction).toHaveBeenCalledExactlyOnceWith('finish');
});
it('shows a visible error if the recording owner cannot be reached', async () => {
  recordingAction.mockRejectedValueOnce(new Error('Owner unavailable'));
  await render(); await press('Cancel recording');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Quit Sargosh from the tray');
});
it('shows the loader immediately on finish and keeps it through transcription and cleanup', async () => {
  await render();
  await act(async () => updateAudio({ ...audio, revision: 2, phase: 'finishing' }));
  const loader = host.querySelector('.overlay-spinner');
  expect(loader).not.toBeNull(); expect(host.querySelector('button')).toBeNull();
  await act(async () => {
    updateAudio({ ...audio, phase: 'ready', revision: 3 });
    updateSpeech({ phase: 'working', message: 'Transcribing...' });
  });
  expect(host.querySelector('.overlay-spinner')).toBe(loader);
  await act(async () => updateSpeech({ phase: 'working', message: 'Cleaning transcript...' }));
  expect(host.querySelector('.overlay-spinner')).toBe(loader);
  expect(host.querySelector('button')).toBeNull();
  await act(async () => updateSpeech({ phase: 'completed', message: 'Cleaned text ready.' }));
  expect(host.querySelector('.overlay-spinner')).toBeNull();
});
it.each(['failed', 'cancelled'] as const)('removes the loader when processing is %s', async phase => {
  audio = { ...audio, phase: 'ready' }; speech = { phase: 'working', message: 'Transcribing...' }; await render();
  expect(host.querySelector('.overlay-spinner')).not.toBeNull();
  await act(async () => updateSpeech({ phase, message: 'Processing stopped.' }));
  expect(host.querySelector('.overlay-spinner')).toBeNull();
});
