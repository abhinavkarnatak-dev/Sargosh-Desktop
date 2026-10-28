import WebSocket from 'ws';
import { normalizeDashes } from '../shared/lifecycle';
import type { SpeechLanguage, Transcript } from '../shared/transcription';
import { SpeechError } from './deepgram';
import { STREAM_SAMPLE_RATE } from '../shared/streaming';

// Interim hypotheses replace one another. Only immutable final segments enter cleanup.
export class FinalTranscript {
  private segments = new Map<string, { start: number; text: string; confidence: number | null }>();
  add(value: unknown) {
    const x = value as any;
    if (x?.type !== 'Results' || x.is_final !== true) return;
    const a = x.channel?.alternatives?.[0];
    if (!Number.isFinite(x.start) || x.start < 0 || !Number.isFinite(x.duration) || x.duration < 0 || typeof a?.transcript !== 'string') throw new SpeechError('INVALID_RESPONSE', 'The streaming transcript was unreadable. Retry the saved recording.');
    const text = a.transcript.trim();
    if (!text) return;
    this.segments.set(`${x.start}:${x.duration}`, { start: x.start, text, confidence: Number.isFinite(a.confidence) && a.confidence >= 0 && a.confidence <= 1 ? a.confidence : null });
    if (this.segments.size > 2000 || this.text().length > 100000) throw new SpeechError('INVALID_RESPONSE', 'The streaming transcript exceeded its limit.');
  }
  text() { return normalizeDashes([...this.segments.values()].sort((a,b) => a.start-b.start).map(x => x.text).join(' ')); }
  result(language: SpeechLanguage, durationMs: number): Transcript { return { text: this.text(), language, model: 'nova-3', durationMs, confidence: null }; }
}
export interface LiveRecognizer {
  ready: Promise<void>;
  send(audio: Buffer): void;
  finish(durationMs: number): Promise<Transcript>;
  cancel(): void;
}
export function openDeepgramStream(apiKey: string, language: SpeechLanguage, signal: AbortSignal, createSocket: (url: URL, options: WebSocket.ClientOptions) => WebSocket = (url,options) => new WebSocket(url, options)): LiveRecognizer {
  const url = new URL('wss://api.deepgram.com/v1/listen');
  for (const [key,value] of Object.entries({model:'nova-3',language,encoding:'linear16',sample_rate:String(STREAM_SAMPLE_RATE),channels:'1',interim_results:'true',endpointing:'300',smart_format:'true',punctuate:'true',mip_opt_out:'true'})) url.searchParams.set(key,value);
  const socket = createSocket(url, { headers: { Authorization: 'Token '+apiKey }, handshakeTimeout: 10000, maxPayload: 1024*1024, followRedirects: false });
  const transcript = new FinalTranscript();
  let finishing = false, metadata = false, ended = false, durationMs = 0;
  let readyResolve!:()=>void, readyReject!:(e:Error)=>void, doneResolve!:(r:Transcript)=>void, doneReject!:(e:Error)=>void;
  const ready = new Promise<void>((yes,no) => { readyResolve=yes;readyReject=no; });
  const done = new Promise<Transcript>((yes,no) => { doneResolve=yes;doneReject=no; });
  // Failure can happen during recording, long before finish() is awaited.
  void ready.catch(()=>{}); void done.catch(()=>{});
  let finalTimer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearInterval(keepAlive);clearTimeout(finalTimer);signal.removeEventListener('abort',cancel); };
  const fail = (error: Error) => { if(ended)return;ended=true;clear();readyReject(error);doneReject(error);socket.terminate(); };
  const cancel = () => fail(new SpeechError('CANCELLED','Streaming transcription cancelled.',499));
  const keepAlive = setInterval(() => { if(socket.readyState===WebSocket.OPEN && !finishing)socket.send(JSON.stringify({type:'KeepAlive'})); },4000);
  socket.once('open', () => { if(signal.aborted){cancel();return;}readyResolve(); });
  socket.on('message', raw => {
    if(ended)return;
    try {
      const message = JSON.parse(raw.toString());
      if(message.type==='Error') throw new SpeechError('PROVIDER_UNAVAILABLE','Deepgram could not finish the stream. Retry the saved recording.');
      if(message.type==='Metadata' && finishing) metadata=true;
      transcript.add(message);
    } catch(error) { fail(error instanceof SpeechError?error:new SpeechError('INVALID_RESPONSE','Deepgram returned an unreadable stream.')); }
  });
  socket.on('unexpected-response', (_request,response) => {
    response.resume();
    fail(new SpeechError(response.statusCode===401||response.statusCode===403?'PROVIDER_AUTH':response.statusCode===429?'PROVIDER_RATE_LIMIT':'PROVIDER_UNAVAILABLE','Deepgram could not open a live connection. Retry later.'));
  });
  socket.on('error', () => fail(new SpeechError('PROVIDER_CONNECTION','The live transcription connection was interrupted. Retry the saved recording.')));
  socket.on('close', code => {
    if(ended)return;
    if(!finishing || !metadata || code!==1000) { fail(new SpeechError('PROVIDER_CONNECTION','The live transcript was incomplete. Retry the saved recording.'));return; }
    ended=true;clear();doneResolve(transcript.result(language,durationMs));
  });
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  return {
    ready,
    send(audio) { if(ended || finishing || socket.readyState!==WebSocket.OPEN)throw new SpeechError('PROVIDER_CONNECTION','The live connection is unavailable.');if(socket.bufferedAmount>512*1024)throw new SpeechError('PROVIDER_CONNECTION','The live connection could not keep up. Retry the saved recording.');socket.send(audio); },
    finish(ms) { if(!finishing && !ended){finishing=true;durationMs=ms;clearInterval(keepAlive);finalTimer=setTimeout(()=>fail(new SpeechError('PROVIDER_TIMEOUT','Deepgram did not finish the live transcript in time.',504)),10000);socket.send(JSON.stringify({type:'CloseStream'}));}return done; },
    cancel
  };
}
