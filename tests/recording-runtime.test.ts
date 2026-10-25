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
  runtime.initializeRecording(); await flush();
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
  it('keeps automatic upload off unless the user enables it', async () => {
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
