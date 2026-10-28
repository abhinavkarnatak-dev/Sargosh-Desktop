import { MAX_AUDIO_BYTES } from '../../shared/recording';
import type { AudioBackend, AudioCapture } from './controller';

export class BrowserAudioBackend implements AudioBackend {
  async open(deviceId: string, onLevel: (level: number) => void, onFailure: (message: string) => void, signal: AbortSignal, onAudio?: (audio:ArrayBuffer)=>void): Promise<AudioCapture> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } }, video: false });
    if (signal.aborted) { stream.getTracks().forEach(track => track.stop()); throw new Error('Cancelled'); }
    let context: AudioContext | undefined;
    let pcm: AudioWorkletNode | undefined;
    let finishPCM: (()=>void) | undefined;
    let pcmStopped: Promise<void> | undefined;
    let recorder: MediaRecorder | undefined;
    let meter: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    let finishing = false;
    let bytes = 0;
    const chunks: Blob[] = [];
    let resolveFinish: ((blob: Blob) => void) | undefined;
    let rejectFinish: ((error: Error) => void) | undefined;
    let finishPromise: Promise<Blob> | undefined;
    const cleanup = () => {
      closed = true; clearInterval(meter);
      signal.removeEventListener('abort', abort);
      for (const track of stream.getTracks()) track.stop();
      pcm?.disconnect();
      void context?.close().catch(() => {});
      chunks.length = 0;
    };
    const abort = () => {
      if (closed) return;
      closed = true; rejectFinish?.(new Error('Cancelled'));
      if (recorder?.state !== 'inactive') { try { recorder?.stop(); } catch {} }
      cleanup();
    };
    signal.addEventListener('abort', abort, { once: true });
    const fail = (message: string) => {
      if (closed) return;
      rejectFinish?.(new Error(message));
      onFailure(message);
      if (recorder?.state !== 'inactive') { try { recorder?.stop(); } catch {} }
      cleanup();
    };
    try {
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.addEventListener('dataavailable', event => {
        if (closed || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > MAX_AUDIO_BYTES) { fail('The recording exceeded the local size limit and was discarded.'); return; }
        chunks.push(event.data);
      });
      recorder.addEventListener('error', () => fail('Audio recording failed. The clip was discarded.'));
      recorder.addEventListener('stop', () => {
        if (closed) return;
        if (!finishing) { fail('The microphone stopped unexpectedly. Start a new recording.'); return; }
        const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType || 'audio/webm' });
        resolveFinish?.(blob);
        cleanup();
      });
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (!closed && !finishing) fail('The microphone disconnected. Choose an available input and try again.');
      });
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser(); analyser.fftSize = 256; source.connect(analyser);
      if(onAudio){
        await context.audioWorklet.addModule(new URL('./pcm-worklet.js?no-inline',import.meta.url).href);
        pcm=new AudioWorkletNode(context,'sargosh-pcm');
        const silent=context.createGain();silent.gain.value=0;source.connect(pcm);pcm.connect(silent);silent.connect(context.destination);
        pcm.port.onmessage=event=>{if(closed)return;if(event.data?.audio instanceof ArrayBuffer)onAudio(event.data.audio);if(event.data?.finished)finishPCM?.();};
        pcm.onprocessorerror=()=>fail('The live audio feed failed. Start a new recording.');
      }
      await context.resume();
      if (closed || stream.getAudioTracks().some(track => track.readyState === 'ended')) throw new Error('Microphone disconnected');
      const samples = new Uint8Array(analyser.fftSize);
      meter = setInterval(() => {
        if (closed || finishing) return;
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
        onLevel(Math.min(100, Math.round(rms * 400)));
      }, 100);
      recorder.start(250);pcm?.port.postMessage('start');
      return {
        finish: () => {
          if (finishPromise) return finishPromise;
          if (closed || !recorder || recorder.state === 'inactive') return Promise.reject(new Error('Recorder is unavailable'));
          finishing = true;
          finishPromise = new Promise<Blob>((resolve, reject) => { resolveFinish = resolve; rejectFinish = reject; });
          // The stop event follows the final dataavailable event. Never build the Blob here.
          if(pcm){
            pcmStopped=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Final live audio timed out')),1500);finishPCM=()=>{clearTimeout(timeout);resolve();};});
            pcm.port.postMessage('finish');
            void pcmStopped.then(()=>recorder?.stop(),()=>fail('The final live audio could not be collected.'));
          }else recorder.stop();
          return finishPromise;
        },
        cancel: () => {
          if (closed) return;
          closed = true;
          rejectFinish?.(new Error('Recording cancelled'));
          if (recorder?.state !== 'inactive') { try { recorder?.stop(); } catch {} }
          cleanup();
        }
      };
    } catch (error) {
      if (recorder?.state !== 'inactive') { try { recorder?.stop(); } catch {} }
      cleanup(); throw error;
    }
  }
}
