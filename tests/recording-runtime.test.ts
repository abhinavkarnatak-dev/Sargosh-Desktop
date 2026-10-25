import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_WINDOWS_STATE, type WindowsState } from '../src/shared/windows';
import { DEFAULT_PREFERENCES } from '../src/shared/types';

const fake = vi.hoisted(() => ({ open: vi.fn(), finish: vi.fn(), cancel: vi.fn(), transcribe: vi.fn() }));
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

});
