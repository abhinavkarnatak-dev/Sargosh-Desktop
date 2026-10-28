import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_WINDOWS_STATE, type WindowsState } from '../src/shared/windows';
import { DEFAULT_PREFERENCES } from '../src/shared/types';

const fake = vi.hoisted(() => ({ open: vi.fn(), finish: vi.fn(), cancel: vi.fn(), transcribe: vi.fn(), cleanup: vi.fn() }));
vi.mock('../src/renderer/audio/cleanup-transport', () => ({ cleanupTransport: fake.cleanup }));
vi.mock('../src/renderer/audio/transcription-transport', () => ({ transcriptionTransport: fake.transcribe }));
vi.mock('../src/renderer/audio/browser', () => ({ BrowserAudioBackend: class { open = fake.open; } }));
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
let runtime: typeof import('../src/renderer/audio/runtime');
let native: WindowsState;
let nativeListener: (state: WindowsState) => void;
let commandListener: (action: 'finish' | 'cancel') => void;
let bridge: {
  deliverText: ReturnType<typeof vi.fn>;
  cancelDelivery: ReturnType<typeof vi.fn>;
  onWindowsState: ReturnType<typeof vi.fn>;
  onRecordingCommand: ReturnType<typeof vi.fn>;
  windowsStatus: ReturnType<typeof vi.fn>;
  windowsAction: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
  reportRecording: ReturnType<typeof vi.fn>;
  reportTranscription: ReturnType<typeof vi.fn>;
};
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks();
  fake.open.mockResolvedValue({ finish: fake.finish, cancel: fake.cancel });
  fake.finish.mockResolvedValue(new Blob(['actual clip'], { type: 'audio/webm' }));
  fake.cleanup.mockResolvedValue({ text: 'Cleaned text', model: 'gemini-3.5-flash-lite' });
  fake.transcribe.mockResolvedValue({ text: 'Recognized text', language: 'en', model: 'nova-3', durationMs: 1000, confidence: .9 });
  native = { ...INITIAL_WINDOWS_STATE, enabled: true, purpose: 'recording' };
  bridge = {
    deliverText: vi.fn(async () => ({ status: 'sent', message: 'Text sent to your saved input.' })),
    cancelDelivery: vi.fn(async () => {}),
    onWindowsState: vi.fn(listener => { nativeListener = listener; return () => {}; }),
    onRecordingCommand: vi.fn(listener => { commandListener = listener; return () => {}; }),
    windowsStatus: vi.fn(async () => native),
    windowsAction: vi.fn(async (action: string) => {
      native = { ...native, revision: native.revision + 1, phase: action === 'finish' ? 'finished' : 'cancelled', enabled: action !== 'disarm' };
      nativeListener(native); return native;
    }),
    snapshot: vi.fn(async () => ({ preferences: DEFAULT_PREFERENCES })),
    reportRecording: vi.fn(async () => {}),
    reportTranscription: vi.fn(async () => {})
  };
  vi.stubGlobal('window', { sargosh: bridge, addEventListener: vi.fn() });
  runtime = await import('../src/renderer/audio/runtime');
  runtime.initializeRecording(); runtime.transcription.configure({ automatic: false }); await flush();
});
afterEach(async () => {
  runtime.recording.clear(); await flush();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});
function speaking() {
  native = { ...native, revision: native.revision + 1, phase: 'pending', sessionId: 'session', mode: 'hold', target: { id: 'target', application: 'notepad.exe' } };
  nativeListener(native);
  native = { ...native, revision: native.revision + 1, phase: 'listening' };
  nativeListener(native);
}
describe('native shortcut to recording owner integration', () => {
  it('initializes one native subscription even if initialization is requested twice', () => {
    runtime.initializeRecording();
    expect(bridge.onWindowsState).toHaveBeenCalledOnce();
    expect(bridge.onRecordingCommand).toHaveBeenCalledOnce();
  });
  it('routes overlay finish through native destination freezing before publishing the ready clip', async () => {
    speaking(); await flush(); commandListener('finish'); await flush();
    expect(bridge.windowsAction).toHaveBeenCalledWith('finish');
    expect(fake.open).toHaveBeenCalledOnce(); expect(fake.finish).toHaveBeenCalledOnce();
    expect(runtime.recording.getState()).toMatchObject({ phase: 'ready', target: { id: 'target' } });
    expect(bridge.reportRecording).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'ready', clip: { bytes: 11, mimeType: 'audio/webm' } }));
  });
  it('overlay cancellation discards the clip and resets the native session', async () => {
    speaking(); await flush(); commandListener('cancel'); await flush();
    expect(fake.cancel).toHaveBeenCalled(); expect(fake.finish).not.toHaveBeenCalled();
    expect(runtime.recording.getState().phase).toBe('cancelled');
    expect(runtime.recording.getClip()).toBeNull();
    expect(bridge.windowsAction).toHaveBeenCalledWith('cancel');
  });
  it('disarms the fixed-text input test before starting a manual recording', async () => {
    native = { ...native, purpose: 'input-test', revision: native.revision + 1 };
    nativeListener(native);
    await runtime.startRecording(); await flush();
    expect(bridge.windowsAction).toHaveBeenCalledWith('disarm');
    expect(runtime.recording.getState()).toMatchObject({ phase: 'recording', mode: 'manual' });
  });
  it('automatically transcribes once only after final audio is ready', async () => {
    let resolve!: (blob: Blob) => void;
    fake.finish.mockReturnValueOnce(new Promise<Blob>(yes => { resolve = yes; }));
    runtime.transcription.configure({ automatic: true });
    speaking(); await flush(); commandListener('finish'); await flush();
    expect(runtime.recording.getState().phase).toBe('finishing'); expect(fake.transcribe).not.toHaveBeenCalled();
    resolve(new Blob(['complete clip'], { type: 'audio/webm' })); await flush();
    expect(fake.transcribe).toHaveBeenCalledOnce();
    expect(runtime.transcription.getState()).toMatchObject({ phase: 'completed', result: { text: 'Recognized text' } });
  });
  it('does not upload in explicitly selected manual mode', async () => {
    speaking(); await flush(); commandListener('finish'); await flush();
    expect(runtime.recording.getState().phase).toBe('ready'); expect(fake.transcribe).not.toHaveBeenCalled();
  });
  it('discarding a clip cancels its transcription and ignores the late response', async () => {
    let resolve!: (result: unknown) => void;
    fake.transcribe.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    speaking(); await flush(); commandListener('finish'); await flush();
    const pending = runtime.transcribeRecording(); await flush();
    const signal = fake.transcribe.mock.calls[0][3] as AbortSignal;
    runtime.recording.clear(); expect(signal.aborted).toBe(true);
    resolve({ text: 'Late result', language: 'en', model: 'nova-3', durationMs: 1000, confidence: .9 }); await pending;
    expect(runtime.transcription.getState()).toMatchObject({ phase: 'idle', result: null });
  });
  it('does not start another microphone session while transcription is running', async () => {
    let resolve!: (result: unknown) => void;
    fake.transcribe.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    speaking(); await flush(); commandListener('finish'); await flush();
    const pending = runtime.transcribeRecording(); await flush();
    native = { ...native, revision: native.revision + 1, phase: 'pending', sessionId: 'next' };
    nativeListener(native); await flush();
    expect(fake.open).toHaveBeenCalledOnce(); expect(bridge.windowsAction).toHaveBeenCalledWith('cancel');
    resolve({ text: 'First result', language: 'en', model: 'nova-3', durationMs: 1000, confidence: .9 }); await pending;
    expect(runtime.transcription.getState().result?.text).toBe('First result');
  });

  it('automatically cleans completed speech while keeping the original transcript intact', async () => {
    speaking(); await flush(); commandListener('finish'); await flush();
    await runtime.transcribeRecording(); await flush();
    expect(fake.cleanup).toHaveBeenCalledOnce();
    expect(runtime.transcription.getState().result?.text).toBe('Recognized text');
    expect(runtime.cleanup.getState()).toMatchObject({ phase: 'completed', result: { text: 'Cleaned text' } });
  });
  it('keeps the original after cleanup fails and retries cleanup without transcribing audio again', async () => {
    fake.cleanup.mockRejectedValueOnce(new Error('Gemini quota reached'));
    speaking(); await flush(); commandListener('finish'); await flush();
    await runtime.transcribeRecording(); await flush();
    expect(runtime.cleanup.getState().phase).toBe('failed');
    expect(runtime.transcription.getState().result?.text).toBe('Recognized text');
    expect(fake.transcribe).toHaveBeenCalledOnce();
    await runtime.cleanupTranscript(); await flush();
    expect(fake.transcribe).toHaveBeenCalledOnce(); expect(fake.cleanup).toHaveBeenCalledTimes(2);
    expect(runtime.cleanup.getState().result?.text).toBe('Cleaned text');
  });
  it('skips automatic cleanup when disabled but still permits an explicit cleanup request', async () => {
    runtime.cleanup.configure(false);
    speaking(); await flush(); commandListener('finish'); await flush();
    await runtime.transcribeRecording(); await flush(); expect(fake.cleanup).not.toHaveBeenCalled();
    await runtime.cleanupTranscript(); expect(fake.cleanup).toHaveBeenCalledOnce();
  });
  it('does not call Gemini for empty recognition results', async () => {
    fake.transcribe.mockResolvedValueOnce({ text: '', language: 'en', model: 'nova-3', durationMs: 1000, confidence: null });
    speaking(); await flush(); commandListener('finish'); await flush();
    await runtime.transcribeRecording(); await flush();
    expect(fake.cleanup).not.toHaveBeenCalled(); expect(runtime.transcription.getState().result?.text).toBe('');
  });
  it('cancels cleanup from the overlay while preserving recognized speech', async () => {
    let resolve!: (value: unknown) => void;
    fake.cleanup.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    speaking(); await flush(); commandListener('finish'); await flush();
    await runtime.transcribeRecording(); await flush();
    const signal = fake.cleanup.mock.calls[0][3] as AbortSignal;
    commandListener('cancel'); expect(signal.aborted).toBe(true);
    resolve({ text: 'late cleanup', model: 'gemini-3.5-flash-lite' }); await flush();
    expect(runtime.cleanup.getState()).toMatchObject({ phase: 'cancelled', result: null });
    expect(runtime.transcription.getState().result?.text).toBe('Recognized text');
  });
  it('does not start a new microphone session while cleanup is working', async () => {
    let resolve!: (value: unknown) => void;
    fake.cleanup.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    speaking(); await flush(); commandListener('finish'); await flush();
    await runtime.transcribeRecording(); await flush();
    native = { ...native, revision: native.revision + 1, phase: 'pending', sessionId: 'next' };
    nativeListener(native); await flush();
    expect(fake.open).toHaveBeenCalledOnce(); expect(bridge.windowsAction).toHaveBeenCalledWith('cancel');
    resolve({ text: 'Cleaned first recording', model: 'gemini-3.5-flash-lite' }); await flush();
    expect(runtime.transcription.getState().sessionId).toBe('session');
  });

});

it('stops capture immediately while Windows is still freezing the destination', async () => {
  speaking(); await flush();
  let resolve!: (state: WindowsState) => void;
  bridge.windowsAction.mockImplementationOnce(() => new Promise<WindowsState>(yes => { resolve = yes; }));
  commandListener('finish'); await flush();
  expect(fake.finish).toHaveBeenCalledOnce();
  expect(runtime.recording.getState().phase).toBe('finishing');
  expect(fake.transcribe).not.toHaveBeenCalled();
  native = { ...native, revision: native.revision + 1, phase: 'finished' };
  resolve(native); await flush();
  expect(runtime.recording.getState()).toMatchObject({ phase: 'ready', target: { id: 'target' } });
});
it('an old finish cannot block a new session after cancellation', async () => {
  speaking(); await flush();
  let resolve!: (state: WindowsState) => void;
  bridge.windowsAction.mockImplementationOnce(() => new Promise<WindowsState>(yes => { resolve = yes; }));
  commandListener('finish'); await flush();
  const previous = { ...native, revision: native.revision + 1, phase: 'finished' as const };
  commandListener('cancel'); await flush();
  native = { ...native, revision: native.revision + 1, sessionId: 'next', phase: 'listening' };
  nativeListener(native); await flush(); commandListener('finish'); await flush();
  expect(runtime.recording.getState()).toMatchObject({ sessionId: 'next', phase: 'ready' });
  resolve(previous); await flush();
  expect(runtime.recording.getState()).toMatchObject({ sessionId: 'next', phase: 'ready' });
});

it('delivers the cleaned text to the frozen native target exactly once', async () => {
  speaking(); await flush(); commandListener('finish'); await flush();
  await runtime.transcribeRecording(); await flush();
  expect(bridge.deliverText).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session', targetId: 'target', text: 'Cleaned text' });
  expect(runtime.delivery.getState().phase).toBe('completed');
  await runtime.cleanupTranscript(); await flush(); await runtime.transcribeRecording(); await flush();
  expect(bridge.deliverText).toHaveBeenCalledOnce();
});
it('delivers original speech when cleanup is disabled', async () => {
  runtime.cleanup.configure(false); speaking(); await flush(); commandListener('finish'); await flush();
  await runtime.transcribeRecording(); await flush();
  expect(bridge.deliverText).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session', targetId: 'target', text: 'Recognized text' });
});
it('waits for cleanup and keeps the loader working until insertion responds', async () => {
  let clean!: (result: unknown) => void; let sent!: (result: unknown) => void;
  fake.cleanup.mockReturnValueOnce(new Promise(resolve => { clean = resolve; }));
  bridge.deliverText.mockReturnValueOnce(new Promise(resolve => { sent = resolve; }));
  speaking(); await flush(); commandListener('finish'); await flush(); await runtime.transcribeRecording(); await flush();
  expect(bridge.deliverText).not.toHaveBeenCalled();
  clean({ text: 'Final', model: 'gemini-3.5-flash-lite' }); await flush();
  expect(runtime.cloudBusy()).toBe(true);
  expect(bridge.reportTranscription).toHaveBeenLastCalledWith({ phase: 'working', message: 'Preparing text...' });
  await runtime.startRecording(); expect(fake.open).toHaveBeenCalledOnce();
  sent({ status: 'sent', message: 'Text sent.' }); await flush(); expect(runtime.cloudBusy()).toBe(false);
});
it('does not fall back to uncleaned text on cleanup failure and permits a cleanup retry', async () => {
  fake.cleanup.mockRejectedValueOnce(new Error('Unavailable')); speaking(); await flush(); commandListener('finish'); await flush();
  await runtime.transcribeRecording(); await flush(); expect(bridge.deliverText).not.toHaveBeenCalled();
  await runtime.cleanupTranscript(); await flush(); expect(bridge.deliverText).toHaveBeenCalledOnce();
});
it('does not insert cancelled, empty, or targetless results', async () => {
  native = { ...native, revision: native.revision + 1, phase: 'listening', sessionId: 'none', mode: 'hands-free', target: null }; nativeListener(native); await flush();
  commandListener('finish'); await flush(); await runtime.transcribeRecording(); await flush();
  expect(bridge.deliverText).not.toHaveBeenCalled(); expect(runtime.delivery.getState().message).toContain('No saved textbox');
});
it('cancels insertion on discard and ignores late completion', async () => {
  let sent!: (result: unknown) => void;
  bridge.deliverText.mockReturnValueOnce(new Promise(resolve => { sent = resolve; }));
  speaking(); await flush(); commandListener('finish'); await flush(); await runtime.transcribeRecording(); await flush();
  runtime.recording.clear(); await flush();
  expect(bridge.cancelDelivery).toHaveBeenCalledWith('session');
  sent({ status: 'sent', message: 'Late success' }); await flush();
  expect(runtime.delivery.getState().phase).toBe('idle');
});
it('preserves text on unconfirmed delivery and does not automatically retry', async () => {
  bridge.deliverText.mockResolvedValueOnce({ status: 'unconfirmed', message: 'Check your textbox.' });
  speaking(); await flush(); commandListener('finish'); await flush(); await runtime.transcribeRecording(); await flush();
  expect(runtime.delivery.getState().phase).toBe('failed');
  expect(runtime.cleanup.getState().result?.text).toBe('Cleaned text');
  await runtime.cleanupTranscript(); await flush(); expect(bridge.deliverText).toHaveBeenCalledOnce();
});

it('reports a later cleanup retry as busy even after the first insertion has completed', async () => {
  speaking(); await flush(); commandListener('finish'); await flush(); await runtime.transcribeRecording(); await flush();
  let finish!: (result: unknown) => void;
  fake.cleanup.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = runtime.cleanupTranscript(); await flush();
  expect(bridge.reportTranscription.mock.lastCall?.[0].phase).toBe('working');
  finish({ text: 'Revised text', model: 'gemini-3.5-flash-lite' }); await pending; await flush();
  expect(bridge.deliverText).toHaveBeenCalledOnce();
});

it('automatically delivers separate hold and hands-free sessions in any order to the latest frozen target', async () => {
  runtime.transcription.configure({ automatic: true });
  for (const [index, mode] of (['hold', 'hands-free', 'hands-free', 'hold'] as const).entries()) {
    const sessionId = 'repeat-' + index;
    native = { ...native, revision: native.revision + 1, phase: 'pending', sessionId, mode, target: { id: 'first', application: 'notepad.exe' } };
    nativeListener(native);
    native = { ...native, revision: native.revision + 1, phase: 'listening', target: { id: 'latest-' + index, application: 'notepad.exe' } };
    nativeListener(native); await flush(); commandListener('finish'); await flush(); await flush();
    expect(bridge.deliverText).toHaveBeenLastCalledWith({ sessionId, targetId: 'latest-' + index, text: 'Cleaned text' });
    expect(runtime.delivery.getState().phase).toBe('completed');
  }
  expect(bridge.deliverText).toHaveBeenCalledTimes(4);
});

it('publishes cleaned recovery text when no target is saved', async () => {
  native = { ...native, revision: native.revision + 1, phase: 'listening', sessionId: 'none', mode: 'hands-free', target: null }; nativeListener(native); await flush();
  commandListener('finish'); await flush(); await runtime.transcribeRecording(); await flush();
  const notice = bridge.reportTranscription.mock.lastCall?.[0].notice;
  expect(notice).toMatchObject({ kind: 'recovery', text: 'Cleaned text', title: 'Your text is ready' });
  const id = notice.id;
  runtime.transcription.configure({ automatic: true }); await flush();
  expect(bridge.reportTranscription.mock.lastCall?.[0].notice.id).toBe(id);
});
it('publishes no-speech feedback without inventing recovery text', async () => {
  fake.transcribe.mockResolvedValueOnce({ text: '', language: 'en', model: 'nova-3', durationMs: 1000, confidence: null });
  speaking(); await flush(); commandListener('finish'); await flush(); await runtime.transcribeRecording(); await flush();
  expect(bridge.reportTranscription.mock.lastCall?.[0].notice).toMatchObject({ title: 'No speech detected' });
  expect(bridge.reportTranscription.mock.lastCall?.[0].notice.text).toBeUndefined();
});

it('saves a finalized clip before automatic transcription and remembers its prepared text', async () => {
  const saveHistory = vi.fn(async () => {}); const updateHistory = vi.fn(async () => {});
  Object.assign(bridge, { saveHistory, updateHistory });
  const arrayBuffer = vi.spyOn(Blob.prototype, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(11));
  try {
    runtime.transcription.configure({ automatic: true }); speaking(); await flush(); commandListener('finish'); await flush(); await flush();
    expect(saveHistory).toHaveBeenCalledOnce(); expect(updateHistory).toHaveBeenCalledWith(expect.objectContaining({ id: 'session', text: 'Cleaned text', originalText: 'Recognized text', status: 'completed' }));
    expect(saveHistory.mock.invocationCallOrder[0]).toBeLessThan(fake.transcribe.mock.invocationCallOrder[0]);
  } finally { arrayBuffer.mockRestore(); }
});
it('does not save a recording cancelled before finalization', async () => {
  const saveHistory = vi.fn(async () => {}); Object.assign(bridge, { saveHistory });
  speaking(); await flush(); commandListener('cancel'); await flush(); expect(saveHistory).not.toHaveBeenCalled();
});

it('keeps the pipeline busy while saving and respects cancellation before cloud processing starts', async () => {
  let save!: () => void; const saveHistory = vi.fn(() => new Promise<void>(resolve => { save = resolve; }));
  Object.assign(bridge, { saveHistory, updateHistory: vi.fn(async () => {}) });
  const arrayBuffer = vi.spyOn(Blob.prototype, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(11));
  try {
    runtime.transcription.configure({ automatic: true }); speaking(); await flush(); commandListener('finish'); await flush();
    expect(runtime.cloudBusy()).toBe(true); expect(fake.transcribe).not.toHaveBeenCalled();
    commandListener('cancel'); save(); await flush(); await flush();
    expect(fake.transcribe).not.toHaveBeenCalled(); expect(runtime.transcription.getState().phase).toBe('cancelled'); expect(runtime.cloudBusy()).toBe(false);
  } finally { arrayBuffer.mockRestore(); }
});

it('keeps practice dictation inside onboarding instead of inserting into another app', async () => {
  const save = vi.fn(async () => {}), update = vi.fn(async () => {});
  Object.assign(bridge, { saveHistory: save, updateHistory: update });
  runtime.setTutorialMode(true); runtime.transcription.configure({automatic:true});
  speaking(); await flush(); commandListener('finish'); await flush();
  expect(fake.transcribe).toHaveBeenCalledOnce(); expect(fake.cleanup).toHaveBeenCalledOnce();
  expect(runtime.cleanup.getState().result?.text).toBe('Cleaned text');
  expect(bridge.deliverText).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  runtime.recording.clear(); runtime.setTutorialMode(false);
});

it('uses the combined cleanup result and inserts it once without a second cleanup request', async () => {
  fake.transcribe.mockResolvedValueOnce({ text: 'Um original text', language: 'en', model: 'nova-3', durationMs: 1000, confidence: .9,
    cleanup: { ok: true, result: { text: 'Combined final text', model: 'gemini-3.5-flash-lite' } } });
  speaking(); await flush(); await runtime.finishRecording(); await flush();
  await runtime.transcribeRecording(); await flush();
  expect(fake.transcribe.mock.calls[0][5]).toBe(true);
  expect(fake.cleanup).not.toHaveBeenCalled();
  expect(bridge.deliverText).toHaveBeenCalledOnce();
  expect(bridge.deliverText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Combined final text' }));
});
it('retains the original transcript on combined cleanup failure and never pastes or automatically retries it', async () => {
  fake.transcribe.mockResolvedValueOnce({ text: 'Um original text', language: 'en', model: 'nova-3', durationMs: 1000, confidence: .9,
    cleanup: { ok: false, code: 'GEMINI_TIMEOUT', message: 'Cleanup took too long.' } });
  speaking(); await flush(); await runtime.finishRecording(); await flush();
  await runtime.transcribeRecording(); await flush();
  expect(runtime.transcription.getState().result?.text).toBe('Um original text');
  expect(runtime.cleanup.getState()).toMatchObject({ phase: 'failed', sessionId: 'session' });
  expect(fake.cleanup).not.toHaveBeenCalled(); expect(bridge.deliverText).not.toHaveBeenCalled();
});
it('ignores a combined result that arrives after cancellation', async () => {
  let resolve!: (value: unknown) => void;
  fake.transcribe.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  speaking(); await flush(); await runtime.finishRecording(); await flush();
  const pending = runtime.transcribeRecording(); await flush(); runtime.cancelRecording();
  resolve({ text: 'Original', language: 'en', model: 'nova-3', durationMs: 1000, confidence: .9,
    cleanup: { ok: true, result: { text: 'Late text', model: 'gemini-3.5-flash-lite' } } });
  await pending; await flush(); expect(bridge.deliverText).not.toHaveBeenCalled(); expect(fake.cleanup).not.toHaveBeenCalled();
});

it('saves the cleanup error with the original transcript instead of claiming no transcript was prepared', async () => {
  const saveHistory = vi.fn(async () => {}), updateHistory = vi.fn(async () => {});
  Object.assign(bridge, { saveHistory, updateHistory });
  const arrayBuffer = vi.spyOn(Blob.prototype, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(11));
  try {
    fake.transcribe.mockResolvedValueOnce({ text: 'Original transcript', language: 'en', model: 'nova-3', durationMs: 1000, confidence: .9,
      cleanup: { ok: false, code: 'GEMINI_INCOMPLETE', message: 'Cleanup did not finish. Original transcript available.' } });
    runtime.transcription.configure({ automatic: true }); speaking(); await flush(); await runtime.finishRecording(); await flush(); await flush();
    expect(updateHistory).toHaveBeenCalledWith(expect.objectContaining({ text: 'Original transcript', originalText: 'Original transcript', status: 'failed', error: 'Cleanup did not finish. Original transcript available.' }));
    expect(bridge.deliverText).not.toHaveBeenCalled();
  } finally { arrayBuffer.mockRestore(); }
});

it('streams during recording, flushes the final packet, and uses the combined result without a second upload or cleanup',async()=>{
 const start=vi.fn(async()=>({ok:true,maxAudioSeconds:300}));
 const chunk=vi.fn(async()=>true);
 const finish=vi.fn(async()=>({ok:true,result:{text:'Raw final words',language:'en',model:'nova-3',durationMs:1000,confidence:null,cleanup:{ok:true,result:{text:'Final cleaned words.',model:'gpt-6-luna',serviceTier:'fast'}}}}));
 Object.assign(bridge,{startStream:start,streamChunk:chunk,finishStream:finish,cancelStream:vi.fn(async()=>{})});
 vi.resetModules();runtime=await import('../src/renderer/audio/runtime');runtime.initializeRecording();await flush();
 speaking();await flush();
 const pcm=fake.open.mock.calls[0][4] as (audio:ArrayBuffer)=>void;
 expect(start).toHaveBeenCalledOnce();pcm(new ArrayBuffer(3200));await flush();
 expect(chunk).toHaveBeenCalledOnce();expect(fake.transcribe).not.toHaveBeenCalled();expect(finish).not.toHaveBeenCalled();
 fake.finish.mockImplementationOnce(async()=>{pcm(new ArrayBuffer(1600));return new Blob(['complete clip'],{type:'audio/webm'});});
 commandListener('finish');for(let i=0;i<8;i++)await flush();
 expect(chunk).toHaveBeenCalledTimes(2);expect(finish).toHaveBeenCalledOnce();expect(fake.transcribe).not.toHaveBeenCalled();expect(fake.cleanup).not.toHaveBeenCalled();
 expect(runtime.cleanup.getState()).toMatchObject({phase:'completed',result:{text:'Final cleaned words.'}});
 expect(bridge.deliverText).toHaveBeenCalledWith(expect.objectContaining({text:'Final cleaned words.'}));
});
