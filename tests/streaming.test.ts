import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { FinalTranscript, openDeepgramStream } from '../src/server/deepgram-stream';
import { serveStream, type StreamOptions } from '../src/server/streaming';
import { StreamingCapture } from '../src/renderer/audio/streaming';
import { DesktopStreamer } from '../src/main/streaming';
import { STREAM_BYTES_PER_SECOND as rate } from '../src/shared/streaming';
import type { DesktopBridge } from '../src/shared/types';
import type { Transcript } from '../src/shared/transcription';
import { setTimingSink } from '../src/shared/timing';

const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=<T>()=>{let resolve!:(x:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
class Socket extends EventEmitter {
  readyState:number=WebSocket.OPEN;bufferedAmount=0;sent:any[]=[];
  send=vi.fn((data:any)=>this.sent.push(Buffer.isBuffer(data)?data:JSON.parse(data)));
  terminate=vi.fn(()=>{this.readyState=WebSocket.CLOSED;this.emit('close',1006);});
  close=vi.fn((code=1000)=>{this.readyState=WebSocket.CLOSED;this.emit('close',code);});
}
const final=(start:number,text:string,extra={})=>({type:'Results',start,duration:1,is_final:true,channel:{alternatives:[{transcript:text,confidence:.9}]},...extra});
const transcript:Transcript={text:'A final sentence.',model:'nova-3',language:'en',durationMs:1000,confidence:null};
afterEach(()=>{vi.useRealTimers();setTimingSink(event=>console.info(JSON.stringify(event)));});

describe('Deepgram live transcript ownership',()=>{
  it('ignores revised interim hypotheses, deduplicates repeated segments, and preserves meaningful repetition across segments',()=>{
    const t=new FinalTranscript();t.add(final(0,'Wrong',{is_final:false}));t.add(final(1,'very'));t.add(final(0,'Very'));t.add(final(1,'very'));t.add(final(2,'good.'));
    expect(t.result('en',3000).text).toBe('Very very good.');
  });
  it('flushes final audio with CloseStream and waits for final results and summary before resolving',async()=>{
    const socket=new Socket();const connect=vi.fn((_url:URL,_options:WebSocket.ClientOptions)=>socket as unknown as WebSocket);const abort=new AbortController();
    const live=openDeepgramStream('private-fixture','multi',abort.signal,connect);
    socket.emit('open');await live.ready;
    expect(String(connect.mock.calls[0]?.[0])).toContain('encoding=linear16');
    live.send(Buffer.alloc(3200));const done=live.finish(100);let resolved=false;void done.then(()=>{resolved=true;});
    socket.emit('message',Buffer.from(JSON.stringify(final(0,'Earlier.'))));await flush();expect(resolved).toBe(false);
    socket.emit('message',Buffer.from(JSON.stringify(final(1,'Last word.'))));socket.emit('message',Buffer.from('{"type":"Metadata"}'));socket.emit('close',1000);
    expect((await done).text).toBe('Earlier. Last word.');expect(socket.sent.at(-1)).toEqual({type:'CloseStream'});
  });
  it('rejects disconnects instead of returning a partial transcript',async()=>{
    const socket=new Socket();const live=openDeepgramStream('fixture','en',new AbortController().signal,()=>socket as unknown as WebSocket);socket.emit('open');await live.ready;
    const done=live.finish(1000);socket.emit('message',Buffer.from(JSON.stringify(final(0,'Partial.'))));socket.emit('close',1006);
    await expect(done).rejects.toMatchObject({code:'PROVIDER_CONNECTION'});
  });
  it('bounds finalization time and cancels an in-progress stream',async()=>{
    vi.useFakeTimers();const socket=new Socket();const abort=new AbortController();const live=openDeepgramStream('fixture','en',abort.signal,()=>socket as unknown as WebSocket);socket.emit('open');await live.ready;
    const done=live.finish(1000);await vi.advanceTimersByTimeAsync(10001);await expect(done).rejects.toMatchObject({code:'PROVIDER_TIMEOUT'});
    expect(socket.terminate).toHaveBeenCalled();
  });
});

function service(){
  const socket=new Socket();const received:Buffer[]=[];const finalResult=deferred<Transcript>();
  const live={ready:Promise.resolve(),send:vi.fn((data:Buffer)=>received.push(data)),finish:vi.fn(()=>finalResult.promise),cancel:vi.fn()};
  const lease={userId:'owner',requestId:'stream',kind:'stt' as const,leaseId:'lease'};
  const store={snapshot:vi.fn(async()=>({enabled:true,dailyLimitSeconds:600,monthlyLimitSeconds:6000,dailyUsedSeconds:0,monthlyUsedSeconds:0,dailyResetAt:'',monthlyResetAt:''})),reserveStream:vi.fn(async()=>lease),reserve:vi.fn(async()=>({...lease,kind:'cleanup' as const})),dispatch:vi.fn(async()=>{}),finish:vi.fn(async()=>{}),release:vi.fn(async()=>{}),finishStream:vi.fn(async()=>{})};
  const clean=vi.fn(async()=>Response.json({id:'fixture',model:'gpt-6-luna',status:'completed',service_tier:'fast',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"text":"A final sentence."}'}]}],usage:{input_tokens:50,output_tokens:10}}));
  const options:StreamOptions={enabled:true,apiKey:'fixture',store,cleanupProvider:'openai',openaiApiKey:'fixture',openaiFetcher:clean,authorize:async()=> 'owner',openRecognizer:()=>live};
  const done=serveStream(socket as unknown as WebSocket,'owner','stream','en',true,options);
  const audio=(bytes=rate)=>socket.emit('message',Buffer.alloc(bytes),true);
  const finish=()=>socket.emit('message',Buffer.from('{"type":"finish"}'),false);
  return{socket,live,store,done,audio,finish,finalResult,clean,received};
}
describe('stream relay and accounting',()=>{
  it('reserves before sending audio, cleans only the complete transcript once, and settles actual audio seconds',async()=>{
    const s=service();await flush();expect(s.store.reserveStream).toHaveBeenCalledWith('owner','stream','stt',expect.any(String),300,46000);
    expect(s.clean).not.toHaveBeenCalled();s.audio();await flush();expect(s.store.dispatch).toHaveBeenCalledTimes(1);expect(s.received).toHaveLength(1);
    s.finish();await flush();expect(s.clean).not.toHaveBeenCalled();s.finalResult.resolve(transcript);await s.done;
    expect(s.store.finishStream).toHaveBeenCalledWith(expect.anything(),1,154);expect(s.clean).toHaveBeenCalledOnce();
    expect(s.socket.sent.at(-1)).toMatchObject({type:'result',result:{text:'A final sentence.',cleanup:{ok:true}}});
  });
  it('settles bytes sent on cancellation and never sends cancelled speech to cleanup',async()=>{
    const s=service();await flush();s.audio(16000);await flush();s.socket.close();await s.done;
    expect(s.store.finishStream).toHaveBeenCalledWith(expect.anything(),1,154);expect(s.clean).not.toHaveBeenCalled();
  });
  it('releases a recording cancelled before any provider audio, without charging it',async()=>{
    const s=service();await flush();s.socket.close();await s.done;expect(s.store.release).toHaveBeenCalledOnce();expect(s.store.dispatch).not.toHaveBeenCalled();expect(s.clean).not.toHaveBeenCalled();
  });
  it('rejects malformed PCM and never dispatches it upstream',async()=>{
    const s=service();await flush();s.audio(3);await s.done;expect(s.live.send).not.toHaveBeenCalled();expect(s.socket.sent).toContainEqual(expect.objectContaining({type:'error',code:'STREAM_LIMIT'}));
  });
});

describe('recording-side streaming',()=>{
  function setup(){const bridge={startStream:vi.fn(async()=>({ok:true,maxAudioSeconds:300})),streamChunk:vi.fn(async(_id:string,_audio:ArrayBuffer)=>true),finishStream:vi.fn(async()=>({ok:true,result:transcript})),cancelStream:vi.fn(async()=>{})};const limit=vi.fn();return{bridge,limit,capture:new StreamingCapture(()=>bridge as unknown as DesktopBridge,limit)};}
  it('buffers pending shortcut audio, sends all chunks in order, then finishes',async()=>{
    const {bridge,capture}=setup();capture.prepare('id','en',true);const a=new Uint8Array([1,0]).buffer,b=new Uint8Array([2,0]).buffer;capture.push('id',a);expect(bridge.startStream).not.toHaveBeenCalled();capture.activate('id');capture.push('id',b);
    expect(await capture.finish('id',new AbortController().signal)).toEqual(transcript);expect(bridge.streamChunk.mock.calls.map(x=>x[1])).toEqual([a,b]);expect(bridge.finishStream).toHaveBeenCalledOnce();
  });
  it('uses the batch path only if the backend explicitly lacks streaming',async()=>{
    const {bridge,capture}=setup();bridge.startStream.mockResolvedValue({ok:false,code:'STREAM_UNSUPPORTED',message:'Old backend'} as any);capture.prepare('id','en',true);capture.activate('id');expect(await capture.finish('id',new AbortController().signal)).toBeNull();expect(bridge.finishStream).not.toHaveBeenCalled();
  });
  it('never falls back automatically after a live connection failure',async()=>{
    const {bridge,capture}=setup();bridge.streamChunk.mockResolvedValue(false);capture.prepare('id','en',true);capture.activate('id');capture.push('id',new ArrayBuffer(3200));await expect(capture.finish('id',new AbortController().signal)).rejects.toThrow('interrupted');expect(bridge.finishStream).not.toHaveBeenCalled();
  });
  it('finishes at the server allowance instead of sending excess audio',async()=>{
    const {bridge,capture,limit}=setup();bridge.startStream.mockResolvedValue({ok:true,maxAudioSeconds:1});capture.prepare('id','en',true);capture.activate('id');capture.push('id',new ArrayBuffer(rate));await flush();expect(limit).toHaveBeenCalledOnce();await capture.finish('id',new AbortController().signal);expect(bridge.streamChunk).toHaveBeenCalledOnce();
  });
  it('discards old buffered audio after cancellation and starts the next recording cleanly',async()=>{
    const {bridge,capture}=setup();capture.prepare('old','en',true);capture.push('old',new ArrayBuffer(2));capture.cancel();capture.prepare('new','en',true);capture.activate('new');capture.push('new',new ArrayBuffer(4));await capture.finish('new',new AbortController().signal);expect(bridge.streamChunk).toHaveBeenCalledWith('new',expect.any(ArrayBuffer));expect(bridge.streamChunk).toHaveBeenCalledOnce();
  });
});

it('desktop bridge keeps credentials in headers and never accepts premature results',async()=>{
  const socket=new Socket();const connect=vi.fn((_url:URL,_options:WebSocket.ClientOptions)=>socket as unknown as WebSocket);const client=new DesktopStreamer(async()=> 'private-access-token','https://api.example.com',fetch,connect);
  const started=client.start({requestId:'id',traceId:'id',language:'en',cleanup:true});await flush();
  expect(connect.mock.calls[0]?.[1]).toMatchObject({headers:{Authorization:'Bearer private-access-token'}});expect(String(connect.mock.calls[0]?.[0])).not.toContain('private-access-token');
  socket.emit('message',Buffer.from('{"type":"ready","maxAudioSeconds":300}'));expect(await started).toMatchObject({ok:true});client.chunk('id',new ArrayBuffer(2));
  socket.emit('message',Buffer.from(JSON.stringify({type:'result',result:transcript})));expect(await client.finish('id')).toMatchObject({ok:false,code:'STREAM_PROTOCOL'});
});

it('records the actual handshake status and network failure without credentials or raw error text',async()=>{
  const events:unknown[]=[];setTimingSink(event=>events.push(event));
  const socket=new Socket();
  const client=new DesktopStreamer(async()=> 'private-token','https://api.example.com',fetch,()=>socket as unknown as WebSocket);
  const started=client.start({requestId:'diagnostic',traceId:'diagnostic',language:'en',cleanup:true});await flush();
  socket.emit('error',Object.assign(new Error('private upstream message'),{code:'ECONNRESET'}));
  expect(await started).toMatchObject({ok:false,code:'STREAM_CONNECTION'});
  expect(events).toContainEqual(expect.objectContaining({stage:'stream.handshake',outcome:'failed',networkError:'ECONNRESET',handshakeFailure:'socket-error'}));
  expect(JSON.stringify(events)).not.toMatch(/private-token|private upstream/);client.cancel();
  const rejectedSocket=new Socket();const rejected=new DesktopStreamer(async()=> 'private-token','https://api.example.com',fetch,()=>rejectedSocket as unknown as WebSocket);
  const pending=rejected.start({requestId:'rejected',traceId:'rejected',language:'en',cleanup:true});await flush();
  rejectedSocket.emit('unexpected-response',{}, {statusCode:429,resume:vi.fn()});
  expect(await pending).toMatchObject({ok:false,code:'BUSY'});
  expect(events).toContainEqual(expect.objectContaining({stage:'stream.handshake',statusCode:429,handshakeFailure:'http-rejected'}));rejected.cancel();
});
