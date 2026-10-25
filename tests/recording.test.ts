import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingController, type AudioCapture, type AudioBackend } from '../src/renderer/audio/controller';
import { INITIAL_WINDOWS_STATE, type WindowsState } from '../src/shared/windows';
import { MAX_RECORDING_MS } from '../src/shared/recording';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function setup() {
  const opened = deferred<AudioCapture>(); const stopped = deferred<Blob>();
  const capture = { finish: vi.fn(() => stopped.promise), cancel: vi.fn() };
  const backend: AudioBackend = { open: vi.fn(() => opened.promise) };
  let now = 0;
  const controller = new RecordingController(backend, () => now);
  return { controller, backend, opened, stopped, capture, time: (value: number) => { now = value; } };
}
function native(revision: number, phase: WindowsState['phase'], sessionId = 'a', mode: WindowsState['mode'] = 'hold'): WindowsState {
  return { ...INITIAL_WINDOWS_STATE, purpose: 'recording', enabled: true, revision, phase, sessionId, mode, target: { id: 'field', application: 'notepad.exe' } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('actual audio recording controller', () => {
  it('waits for final audio before exposing a playable clip and freezes the target', async () => {
    const { controller, opened, capture, stopped } = setup();
    controller.native(native(1, 'pending'), 'mic');
    opened.resolve(capture); await flush();
    expect(controller.getState().phase).toBe('opening');
    controller.native(native(2, 'listening'), 'mic');
    expect(controller.getState().phase).toBe('recording');
    controller.native(native(3, 'finished'), 'mic');
    expect(controller.getState().phase).toBe('finishing');
    expect(controller.getClip()).toBeNull();
    controller.native({ ...native(4, 'finished'), target: { id: 'later', application: 'browser.exe' } }, 'mic');
    stopped.resolve(new Blob(['first', 'last'], { type: 'audio/webm' })); await flush();
    expect(controller.getState()).toMatchObject({ phase: 'ready', clip: { bytes: 9 }, target: { id: 'field' } });
    expect(capture.finish).toHaveBeenCalledTimes(1);
    expect(controller.getClip()?.size).toBe(9);
    controller.clear();
  });
  it('cancels permission-pending opens and disposes any late microphone result', async () => {
    const { controller, backend, opened, capture } = setup();
    controller.begin('a', 'mic', 'manual'); controller.cancel();
    expect(vi.mocked(backend.open).mock.calls[0][3].aborted).toBe(true);
    opened.resolve(capture); await flush();
    expect(capture.cancel).toHaveBeenCalledTimes(1);
    expect(capture.finish).not.toHaveBeenCalled();
    expect(controller.getState().phase).toBe('cancelled');
  });
  it('discards a late final audio result after cancellation', async () => {
    const { controller, opened, capture, stopped } = setup();
    controller.begin('a', 'default', 'manual'); opened.resolve(capture); await flush();
    const finishing = controller.finish(); controller.cancel();
    stopped.resolve(new Blob(['must not survive'])); await finishing;
    expect(controller.getClip()).toBeNull();
    expect(controller.getState().phase).toBe('cancelled');
  });
  it('does not let old permission results replace a newer recording', async () => {
    const first = deferred<AudioCapture>(); const second = deferred<AudioCapture>();
    const oldCapture = { finish: vi.fn(), cancel: vi.fn() };
    const newCapture = { finish: vi.fn(), cancel: vi.fn() };
    const backend: AudioBackend = { open: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
    const controller = new RecordingController(backend);
    controller.begin('old', 'default', 'manual'); controller.cancel();
    controller.begin('new', 'default', 'manual');
    first.resolve(oldCapture); second.resolve(newCapture); await flush();
    expect(oldCapture.cancel).toHaveBeenCalledOnce();
    expect(newCapture.cancel).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({ phase: 'recording', sessionId: 'new' });
    controller.clear();
  });
  it('does not create audio after the user has already released before mic readiness', async () => {
    const { controller, opened, capture } = setup();
    controller.begin('a', 'default', 'hold'); await controller.finish();
    opened.resolve(capture); await flush();
    expect(controller.getState().phase).toBe('failed');
    expect(capture.cancel).toHaveBeenCalledOnce();
    expect(capture.finish).not.toHaveBeenCalled();
  });
  it('rejects duplicate starts and ignores repeated or stale finish requests', async () => {
    const { controller, opened, capture, stopped } = setup();
    expect(controller.begin('a', 'default', 'manual')).toBe(true);
    expect(controller.begin('b', 'default', 'manual')).toBe(false);
    opened.resolve(capture); await flush();
    await controller.finish('b');
    const finish = controller.finish(); await controller.finish();
    expect(capture.finish).toHaveBeenCalledOnce();
    stopped.resolve(new Blob(['audio'])); await finish;
    expect(controller.getState().phase).toBe('ready'); controller.clear();
  });
  it('handles denied microphone access without leaving an active session', async () => {
    const { controller, opened } = setup();
    controller.begin('a', 'default', 'manual'); opened.reject(new Error('Denied')); await flush();
    expect(controller.getState().phase).toBe('failed');
    expect(controller.begin('b', 'default', 'manual')).toBe(true); controller.clear();
  });
  it('times out a microphone request and releases its late result', async () => {
    const { controller, opened, capture } = setup();
    controller.begin('a', 'default', 'manual'); await vi.advanceTimersByTimeAsync(15_000);
    expect(controller.getState().phase).toBe('failed');
    opened.resolve(capture); await flush(); expect(capture.cancel).toHaveBeenCalledOnce();
  });
  it('times out finalization instead of keeping the microphone indefinitely', async () => {
    const { controller, opened, capture } = setup();
    controller.begin('a', 'default', 'manual'); opened.resolve(capture); await flush();
    const done = controller.finish(); await vi.advanceTimersByTimeAsync(5000); await done;
    expect(controller.getState().phase).toBe('failed');
    expect(capture.cancel).toHaveBeenCalledOnce();
  });
  it('rejects empty audio without publishing a ready clip', async () => {
    const { controller, opened, capture, stopped } = setup();
    controller.begin('a', 'default', 'manual'); opened.resolve(capture); await flush();
    const done = controller.finish(); stopped.resolve(new Blob()); await done;
    expect(controller.getState().phase).toBe('failed'); expect(controller.getClip()).toBeNull();
  });
  it('stops at the duration limit', async () => {
    const { controller, opened, capture, time, stopped } = setup();
    controller.begin('a', 'default', 'manual'); opened.resolve(capture); await flush();
    time(MAX_RECORDING_MS); await vi.advanceTimersByTimeAsync(100);
    expect(capture.finish).toHaveBeenCalledOnce();
    stopped.resolve(new Blob(['audio'])); await flush(); controller.clear();
  });
  it('distinguishes sustained quiet from a short pause', async () => {
    const { controller, opened, capture, time, backend } = setup();
    controller.begin('a', 'default', 'manual'); opened.resolve(capture); await flush();
    const onLevel = vi.mocked(backend.open).mock.calls[0][1];
    time(4000); onLevel(0); expect(controller.getState().quiet).toBe(true);
    onLevel(15); time(4500); onLevel(0); expect(controller.getState().quiet).toBe(false);
    time(7500); onLevel(0); expect(controller.getState().quiet).toBe(true); controller.clear();
  });
  it('cancels when native recording mode is disarmed', async () => {
    const { controller, opened, capture } = setup();
    controller.native(native(1, 'listening'), 'default'); opened.resolve(capture); await flush();
    controller.native({ ...native(2, 'cancelled'), enabled: false }, 'default');
    expect(capture.cancel).toHaveBeenCalledOnce(); expect(controller.getState().phase).toBe('cancelled');
  });
  it('keeps repeated A/B sessions independent and replaces the in-memory preview', async () => {
    for (const modes of ['AA', 'AB', 'BA', 'BB', 'ABA', 'BAB']) {
      const handles: AudioCapture[] = [];
      const backend: AudioBackend = { open: vi.fn(async () => {
        const handle = { finish: vi.fn(async () => new Blob(['audio'])), cancel: vi.fn() }; handles.push(handle); return handle;
      }) };
      const controller = new RecordingController(backend); let revision = 0;
      for (const [index, letter] of [...modes].entries()) {
        const id = String(index); const mode = letter === 'A' ? 'hold' : 'hands-free';
        controller.native(native(++revision, 'pending', id, mode), 'default'); await flush();
        controller.native(native(++revision, 'listening', id, mode), 'default');
        controller.native(native(++revision, 'finished', id, mode), 'default'); await flush();
        expect(controller.getState()).toMatchObject({ phase: 'ready', sessionId: id });
      }
      expect(handles).toHaveLength(modes.length);
      expect(handles.every(handle => vi.mocked(handle.finish).mock.calls.length === 1)).toBe(true);
      controller.clear();
    }
  });
});
