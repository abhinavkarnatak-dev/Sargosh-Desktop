import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserAudioBackend } from '../src/renderer/audio/browser';
import { MAX_AUDIO_BYTES } from '../src/shared/recording';

class FakeTrack extends EventTarget {
  readyState = 'live';
  stop = vi.fn(() => { this.readyState = 'ended'; });
}
let track: FakeTrack;
let recorder: FakeRecorder;
class FakeRecorder extends EventTarget {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
  state = 'inactive'; mimeType = 'audio/webm;codecs=opus';
  constructor() { super(); recorder = this; }
  start = vi.fn(() => { this.state = 'recording'; });
  stop = vi.fn(() => { this.state = 'inactive'; });
  data(text: string | Blob) {
    const event = new Event('dataavailable');
    Object.defineProperty(event, 'data', { value: typeof text === 'string' ? new Blob([text]) : text });
    this.dispatchEvent(event);
  }
}
class FakeContext {
  close = vi.fn(async () => {}); resume = vi.fn(async () => {});
  createMediaStreamSource = () => ({ connect: vi.fn() });
  createAnalyser = () => ({ fftSize: 256, getByteTimeDomainData: (samples: Uint8Array) => samples.fill(128) });
}
let backend: BrowserAudioBackend;
let abort: AbortController;
let failure = vi.fn<(message: string) => void>();
beforeEach(() => {
  vi.useFakeTimers(); track = new FakeTrack(); abort = new AbortController(); failure = vi.fn<(message: string) => void>();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })) } });
  vi.stubGlobal('MediaRecorder', FakeRecorder); vi.stubGlobal('AudioContext', FakeContext);
  backend = new BrowserAudioBackend();
});
afterEach(() => { abort.abort(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('MediaRecorder adapter', () => {
  it('includes the last dataavailable chunk and waits for stop before resolving', async () => {
    const capture = await backend.open('mic-1', vi.fn(), failure, abort.signal);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-1' } }, video: false });
    recorder.data('first');
    let resolved = false;
    const finished = capture.finish().then(blob => { resolved = true; return blob; });
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(resolved).toBe(false);
    recorder.data('last'); await Promise.resolve(); expect(resolved).toBe(false);
    recorder.dispatchEvent(new Event('stop'));
    const blob = await finished;
    expect(await blob.text()).toBe('firstlast');
    expect(blob.type).toBe('audio/webm;codecs=opus');
    expect(track.stop).toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });
  it('returns the same finish promise and does not stop twice', async () => {
    const capture = await backend.open('default', vi.fn(), failure, abort.signal);
    const first = capture.finish(); const second = capture.finish();
    expect(first).toBe(second); expect(recorder.stop).toHaveBeenCalledOnce();
    recorder.data('last'); recorder.dispatchEvent(new Event('stop')); await first;
  });
  it('discards late chunks after cancellation', async () => {
    const capture = await backend.open('default', vi.fn(), failure, abort.signal);
    recorder.data('secret'); capture.cancel();
    recorder.data('late'); recorder.dispatchEvent(new Event('stop'));
    await expect(capture.finish()).rejects.toThrow('unavailable');
    expect(track.stop).toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });
  it('stops tracks on a permission result arriving after cancellation', async () => {
    abort.abort();
    await expect(backend.open('default', vi.fn(), failure, abort.signal)).rejects.toThrow('Cancelled');
    expect(track.stop).toHaveBeenCalled();
  });
  it('reports an unplugged microphone and releases its resources', async () => {
    await backend.open('default', vi.fn(), failure, abort.signal);
    track.dispatchEvent(new Event('ended'));
    expect(failure).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
    expect(track.stop).toHaveBeenCalled();
  });
  it('rejects a recording exceeding the memory limit', async () => {
    await backend.open('default', vi.fn(), failure, abort.signal);
    recorder.data(new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)]));
    expect(failure).toHaveBeenCalledWith(expect.stringContaining('size limit'));
    expect(track.stop).toHaveBeenCalled();
  });
  it('reports unexpected recorder stops', async () => {
    await backend.open('default', vi.fn(), failure, abort.signal);
    recorder.dispatchEvent(new Event('stop'));
    expect(failure).toHaveBeenCalledWith(expect.stringContaining('unexpectedly'));
  });
  it('cleans up if MediaRecorder cannot be constructed', async () => {
    const unsupported = class { static isTypeSupported = () => false; constructor() { throw new Error('Unsupported'); } };
    vi.stubGlobal('MediaRecorder', unsupported);
    await expect(backend.open('default', vi.fn(), failure, abort.signal)).rejects.toThrow('Unsupported');
    expect(track.stop).toHaveBeenCalled();
  });
});
