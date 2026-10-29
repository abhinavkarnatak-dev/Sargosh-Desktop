// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, Fragment } from 'react';
import { Tooltips } from '../src/renderer/Tooltips';
import { createRoot, type Root } from 'react-dom/client';
import { Overlay } from '../src/renderer/Overlay';
import { INITIAL_RECORDING_STATE, type RecordingState } from '../src/shared/recording';
import { INITIAL_WINDOWS_STATE } from '../src/shared/windows';
import type { TranscriptionStatus } from '../src/shared/transcription';
import type { OverlayNotice } from '../src/shared/overlay-notice';

let root: Root;
let host: HTMLDivElement;
let audio: RecordingState;
let speech: TranscriptionStatus;
let updateAudio: (value: RecordingState) => void;
let updateSpeech: (value: TranscriptionStatus) => void;
const recordingAction = vi.fn();
const windowsAction = vi.fn();
const copyOverlayText = vi.fn();
const openSettings = vi.fn();
const openMain = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  openMain.mockReset().mockResolvedValue(undefined);
  copyOverlayText.mockReset().mockResolvedValue(undefined); openSettings.mockReset().mockResolvedValue(undefined);
  recordingAction.mockReset().mockResolvedValue(undefined);
  windowsAction.mockReset().mockResolvedValue({ ...INITIAL_WINDOWS_STATE, revision: 2, enabled: true, purpose: 'recording', phase: 'listening' });
  audio = { ...INITIAL_RECORDING_STATE, revision: 1, phase: 'recording', sessionId: 'one', mode: 'hands-free' };
  speech = { phase: 'idle', message: '' };
  window.sargosh = {
    onWindowsState: () => () => {}, windowsStatus: async () => ({ ...INITIAL_WINDOWS_STATE, enabled: true, purpose: 'recording' }),
    onRecordingState: (listener: (value: RecordingState) => void) => { updateAudio = listener; return () => {}; }, recordingStatus: async () => audio,
    onTranscriptionState: (listener: (value: TranscriptionStatus) => void) => { updateSpeech = listener; return () => {}; }, transcriptionStatus: async () => speech,
    recordingAction, windowsAction, copyOverlayText, openSettings, openMain
  } as unknown as NonNullable<typeof window.sargosh>;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.sargosh; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(createElement(Overlay))); }
it('shows allowance warnings only while idle and preserves recovery notices above them',async()=>{
 let warning!:(notice:OverlayNotice|null)=>void;
 audio={...INITIAL_RECORDING_STATE,revision:1};
 window.sargosh!.onAllowanceWarning=listener=>{warning=listener;return()=>{};};
 await render();
 await act(async()=>warning({id:'allowance:low',kind:'warning',title:'Allowance running low',message:'You have 1 minute or less left in your daily allowance.'}));
 expect(host.querySelector('.overlay-notice')?.textContent).toContain('Allowance running low');
 await act(async()=>updateAudio({...audio,phase:'opening',revision:2}));expect(host.querySelector('.overlay-notice')).toBeNull();
 await act(async()=>updateAudio({...audio,phase:'ready',revision:3}));
 await act(async()=>updateSpeech({phase:'failed',message:'',notice:{id:'recovery',kind:'recovery',title:'Your text is ready',message:'Copy your text.',text:'Keep this transcript.'}}));
 expect(host.querySelector('.overlay-recovery-text')?.textContent).toBe('Keep this transcript.');
 expect(host.querySelector('.overlay-notice')?.textContent).not.toContain('Allowance running low');
});
it('does not replay a dismissed allowance warning after the next recording',async()=>{
 vi.useFakeTimers();let warning!:(notice:OverlayNotice|null)=>void;
 audio={...INITIAL_RECORDING_STATE,revision:1};
 window.sargosh!.onAllowanceWarning=listener=>{warning=listener;return()=>{};};
 await render();await act(async()=>warning({id:'allowance:one',kind:'warning',title:'Allowance running low',message:'One minute left.'}));
 await act(async()=>(host.querySelector('.overlay-notice-close') as HTMLButtonElement).click());
 await act(async()=>vi.advanceTimersByTime(180));expect(host.querySelector('.overlay-notice')).toBeNull();
 await act(async()=>updateAudio({...audio,phase:'opening',revision:2}));
 await act(async()=>updateAudio({...audio,phase:'ready',revision:3}));
 expect(host.querySelector('.overlay-notice')).toBeNull();
});
it('shows only the hovered control hint, and hides hints when the language menu opens', async () => {
  vi.useFakeTimers(); audio = { ...INITIAL_RECORDING_STATE, revision: 1 };
  await act(async () => root.render(createElement(Fragment, null, createElement(Overlay), createElement(Tooltips))));
  await act(async () => host.querySelector('.overlay-pill')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await act(async () => vi.advanceTimersByTime(250));
  expect(document.querySelector('[role=tooltip]')).toBeNull();
  let previous: Element | null = null;
  for (const [selector, text] of [['.overlay-mic', 'Dictate -'], ['.overlay-grip', 'Drag to move'], ['.overlay-language-trigger', 'Speech language:']]) {
    const target = host.querySelector(selector)!;
    await act(async () => {
      previous?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: target }));
      target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: previous }));
      vi.advanceTimersByTime(220);
    });
    expect(document.querySelector('[role=tooltip]')?.textContent).toContain(text);
    previous = target;
  }
  await act(async () => (host.querySelector('.overlay-language-trigger') as HTMLButtonElement).click());
  await act(async () => vi.advanceTimersByTime(250));
  expect(document.querySelector('[role=tooltip]')).toBeNull();
  expect(host.querySelector('.overlay-language-menu')?.getAttribute('data-open')).toBe('true');
});
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
it.each(['left','right','bottom'] as const)('finishes the language menu exit before shrinking or collapsing the %s overlay', async position => {
  vi.useFakeTimers();
  audio = { ...INITIAL_RECORDING_STATE, revision: 1 };
  const resize = vi.fn().mockResolvedValue(undefined);
  window.sargosh!.resizeOverlay = resize;
  window.sargosh!.overlayDockState = async () => ({ position, dragging: false, target: null });
  await render();
  const pill = host.querySelector('.overlay-pill')!;
  await act(async () => pill.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await act(async () => (host.querySelector('.overlay-language-trigger') as HTMLButtonElement).click());
  expect(resize).toHaveBeenLastCalledWith(230);
  await act(async () => pill.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
  await act(async () => (host.querySelector('[role=menuitemradio]') as HTMLButtonElement).click());
  expect(host.querySelector('.overlay-language-menu')?.getAttribute('data-open')).toBe('false');
  expect(pill.classList.contains('expanded')).toBe(true);
  expect(resize).toHaveBeenLastCalledWith(230);
  await act(async () => vi.advanceTimersByTime(160));
  expect(resize).toHaveBeenLastCalledWith(230);
  await act(async () => vi.advanceTimersByTime(20));
  expect(resize).toHaveBeenLastCalledWith(120);
  expect(host.querySelector('.overlay-language-menu')).toBeNull();
  expect(recordingAction).not.toHaveBeenCalled(); expect(windowsAction).not.toHaveBeenCalled();
});
it('starts hands-free from the idle overlay', async () => {
  audio = { ...INITIAL_RECORDING_STATE, revision: 1 };
  await render();
  await act(async () => host.querySelector('.overlay-pill')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await press('Start hands-free recording');
  expect(windowsAction).toHaveBeenCalledExactlyOnceWith('start-hands-free');
});

it.each(['left', 'right', 'bottom'] as const)('keeps recording controls and notices in the %s dock', async position => {
  window.sargosh!.overlayDockState = async () => ({ position, dragging: false, target: null });
  await render();
  expect(host.querySelector('.overlay-stage')?.getAttribute('data-dock')).toBe(position);
  expect(host.querySelector('[aria-label="Cancel recording"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Finish recording"]')).not.toBeNull();
  await act(async () => updateAudio({ ...audio, quiet: true, revision: 2 }));
  expect(host.querySelector('.overlay-notice-wrap')).not.toBeNull();
  await press('Finish recording'); expect(recordingAction).toHaveBeenCalledExactlyOnceWith('finish');
});

it('uses a circular-dot idle marker and follows dock updates without routing a recording action', async () => {
  let updateDock!: (state: import('../src/shared/overlay-dock').DockState) => void;
  audio = { ...INITIAL_RECORDING_STATE, revision: 1 };
  window.sargosh!.onOverlayDock = listener => { updateDock = listener; return () => {}; };
  await render();
  expect(host.querySelector('.idle-line')).not.toBeNull();
  await act(async () => updateDock({ position: 'right', dragging: false, target: null }));
  expect(host.querySelector('.overlay-stage')?.getAttribute('data-dock')).toBe('right');
  expect(recordingAction).not.toHaveBeenCalled(); expect(windowsAction).not.toHaveBeenCalled();
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

it('shows a dismissible microphone warning above the pill while listening', async () => {
  audio = { ...audio, quiet: true }; await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('No microphone activity');
  expect(host.querySelector('.overlay-stage')?.firstElementChild?.classList.contains('overlay-notice-wrap')).toBe(true);
  await act(async () => (host.querySelector('.overlay-notice-actions button') as HTMLButtonElement).click());
  expect(openSettings).toHaveBeenCalledOnce();
  expect(host.querySelector('.overlay-notice')).toBeNull();
  expect(host.querySelector('.overlay-pill')).not.toBeNull();
  await act(async () => updateAudio({ ...audio, revision: 2, level: 0 }));
  expect(host.querySelector('.overlay-notice')).toBeNull();
});
it('shows recorder failures and cancellation above the overlay', async () => {
  audio = { ...audio, phase: 'failed', message: 'Could not open the microphone.' }; await render();
  expect(host.querySelector('.overlay-notice')?.textContent).toContain('Could not open the microphone.');
  await act(async () => updateAudio({ ...audio, phase: 'cancelled', revision: 2 }));
  expect(host.querySelector('.overlay-notice')?.textContent).toContain('Recording cancelled');
});
it('shows recovered text and copies only on an explicit click', async () => {
  vi.useFakeTimers();
  audio = { ...audio, phase: 'ready' };
  speech = { phase: 'failed', message: 'Missing input', notice: { id: 'recovery-1', kind: 'recovery', title: 'Your text is ready', message: 'Copy it below.', text: 'My prepared text.' } };
  await render(); expect(host.querySelector('.overlay-recovery-text')?.textContent).toBe('My prepared text.');
  expect(copyOverlayText).not.toHaveBeenCalled();
  await act(async () => (host.querySelector('.overlay-notice-actions button') as HTMLButtonElement).click());
  expect(copyOverlayText).toHaveBeenCalledExactlyOnceWith('recovery-1');
  expect(host.querySelector('.overlay-notice-actions button')?.textContent).toBe('Copied');
  await press('Dismiss notification');
  expect(host.querySelector('.overlay-notice')?.getAttribute('data-closing')).toBe('true');
  await act(async () => vi.advanceTimersByTime(180));
  expect(host.querySelector('.overlay-recovery-text')).toBeNull();
});
it('explains a failed copy and clears old recovery text as a new recording starts', async () => {
  audio = { ...audio, phase: 'ready' };
  speech = { phase: 'failed', message: '', notice: { id: 'old', kind: 'recovery', title: 'Your text is ready', message: '', text: 'Old dictation' } };
  copyOverlayText.mockRejectedValueOnce(new Error('Expired'));
  await render(); await act(async () => (host.querySelector('.overlay-notice-actions button') as HTMLButtonElement).click());
  expect(host.querySelector('.overlay-notice')?.textContent).toContain('Could not copy');
  await act(async () => updateAudio({ ...audio, sessionId: 'next', phase: 'opening', revision: 2 }));
  expect(host.querySelector('.overlay-recovery-text')).toBeNull();
});

it('dismisses a general error card after opening the main app and keeps the pill', async () => {
  audio = { ...audio, phase: 'ready' };
  speech = { phase: 'failed', message: '', notice: { id: 'error', kind: 'error', title: 'Could not prepare your text', message: 'Please try again.' } };
  await render(); await act(async () => (host.querySelector('.overlay-notice-actions button') as HTMLButtonElement).click());
  expect(openMain).toHaveBeenCalledOnce(); expect(host.querySelector('.overlay-notice')).toBeNull();
  expect(host.querySelector('.overlay-pill')).not.toBeNull();
});
it('keeps the card available if opening the app fails', async () => {
  audio = { ...audio, quiet: true }; openSettings.mockRejectedValueOnce(new Error('Unavailable'));
  await render(); await act(async () => (host.querySelector('.overlay-notice-actions button') as HTMLButtonElement).click());
  expect(host.querySelector('.overlay-notice')?.textContent).toContain('Open Sargosh from the tray');
  expect(host.querySelector('.overlay-pill')).not.toBeNull();
});

it('keeps the mic disabled after dismissing a reached-limit warning and reenables it at reset',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-29T23:59:58Z'));audio={...INITIAL_RECORDING_STATE,revision:1};
 window.sargosh!.allowanceWarning=async()=>({id:'allowance:daily:2026-10-30T00:00:00Z:reached',kind:'warning',title:'Allowance reached',message:'You have reached your daily allowance.'});
 await render();await act(async()=>host.querySelector('.overlay-pill')!.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
 const mic=()=>host.querySelector('.overlay-mic') as HTMLButtonElement;
 expect(mic().disabled).toBe(true);await act(async()=>mic().click());expect(windowsAction).not.toHaveBeenCalled();
 await act(async()=>(host.querySelector('.overlay-notice-close') as HTMLButtonElement).click());await act(async()=>vi.advanceTimersByTime(180));
 expect(mic().disabled).toBe(true);expect(host.querySelector('.overlay-notice')).toBeNull();
 expect(host.querySelector('.overlay-grip')).not.toBeNull();expect(host.querySelector('.overlay-language')).not.toBeNull();
 await act(async()=>vi.advanceTimersByTime(2000));expect(mic().disabled).toBe(false);
});

it.each(['left','right','bottom'] as const)('shows the exhausted allowance hint on the disabled %s mic',async position=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));audio={...INITIAL_RECORDING_STATE,revision:1};
 window.sargosh!.overlayDockState=async()=>({position,target:null,dragging:false});
 window.sargosh!.allowanceWarning=async()=>({id:'allowance:daily:2026-10-30T00:00:00Z:reached',kind:'warning',title:'Allowance reached',message:'You have reached your daily allowance.'});
 await act(async()=>root.render(createElement(Fragment,null,createElement(Overlay),createElement(Tooltips))));
 await act(async()=>host.querySelector('.overlay-pill')!.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
 const mic=host.querySelector('.overlay-mic') as HTMLButtonElement;expect(mic.disabled).toBe(true);
 await act(async()=>{mic.parentElement!.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));vi.advanceTimersByTime(220);});
 expect(document.querySelector('[role=tooltip]')?.textContent).toBe('Allowance exhausted. View Usage in Sargosh.');
 expect(document.querySelector('[role=tooltip]')?.getAttribute('data-tone')).toBe('danger');
 expect(document.querySelector('[role=tooltip] svg')).toBeNull();
 expect(document.querySelector('[role=tooltip]')?.textContent).not.toContain('Dictate');
 await act(async()=>mic.click());expect(windowsAction).not.toHaveBeenCalled();
});


it.each(['left','right','bottom'] as const)('shows a fresh warning for blocked shortcut attempts at %s even after dismissing the earlier warning',async position=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));audio={...INITIAL_RECORDING_STATE,revision:1};
 let warning!:(value:OverlayNotice|null)=>void;let windows!:(value:typeof INITIAL_WINDOWS_STATE)=>void;
 window.sargosh!.onAllowanceWarning=listener=>{warning=listener;return()=>{};};
 window.sargosh!.onWindowsState=listener=>{windows=listener;return()=>{};};
 window.sargosh!.overlayDockState=async()=>({position,target:null,dragging:false});
 const initial:OverlayNotice={id:'allowance:daily:2026-10-30T00:00:00Z:reached',kind:'warning',title:'Allowance reached',message:'You have reached your daily allowance.'};
 await render();await act(async()=>warning(initial));
 await act(async()=>(host.querySelector('.overlay-notice-close') as HTMLButtonElement).click());await act(async()=>vi.advanceTimersByTime(180));
 expect(host.querySelector('.overlay-notice')).toBeNull();
 for(let attempt=1;attempt<=2;attempt++){
  await act(async()=>windows({...INITIAL_WINDOWS_STATE,enabled:true,purpose:'recording',phase:'pending',sessionId:'attempt-'+attempt,revision:attempt*2}));
  await act(async()=>warning({...initial,id:'allowance:attempt:'+attempt+':daily:2026-10-30T00:00:00Z:reached'}));
  await act(async()=>windows({...INITIAL_WINDOWS_STATE,enabled:true,purpose:'recording',phase:'cancelled',sessionId:'attempt-'+attempt,revision:attempt*2+1}));
  expect(host.querySelector('.overlay-notice')?.textContent).toContain('You have reached your daily allowance.');
  await act(async()=>vi.advanceTimersByTime(5180));expect(host.querySelector('.overlay-notice')).toBeNull();
 }
});
