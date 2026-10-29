import WebSocket from 'ws';
import { apiEndpoint, hostedEndpoint } from '../shared/api-endpoint';
import { STREAM_BYTES_PER_SECOND, STREAM_MAX_CHUNK, type StreamRequest, type StreamStart, type StreamResult } from '../shared/streaming';
import { isCleanupModel } from '../shared/cleanup';
import type { Transcript } from '../shared/transcription';
import { TimingTrace, type TimingMeta } from '../shared/timing';

export function validStreamResult(value: unknown, request: StreamRequest): value is Transcript {
  const x=value as Transcript|null;
  if(!x||typeof x.text!=='string'||x.text.length>100000||x.language!==request.language||x.model!=='nova-3'||!Number.isFinite(x.durationMs)||x.durationMs<0||x.durationMs>(request.practice?20000:300000)||(x.confidence!==null&&(!Number.isFinite(x.confidence)||x.confidence<0||x.confidence>1)))return false;
  if(request.cleanup&&x.text.trim()){
    const c=x.cleanup;
    if(!c||typeof c.ok!=='boolean')return false;
    if(c.ok){if(!c.result||typeof c.result.text!=='string'||c.result.text.length>Math.max(512,x.text.length*(request.language==='multi'?4:2)+256)||!isCleanupModel(c.result.model))return false;}
    else if(typeof c.code!=='string'||c.code.length>100||typeof c.message!=='string'||c.message.length>400)return false;
  }
  return true;
}
type Start = StreamStart & { maxAudioSeconds?: number };
interface Active {
  request:StreamRequest;abort:AbortController;socket?:WebSocket;bytes:number;maxBytes:number;finishing:boolean;
  complete:(r:StreamResult)=>void;result:Promise<StreamResult>;fail:(code:string,message:string)=>void;
}
export class DesktopStreamer {
  private active?:Active;
  constructor(private token:()=>Promise<string>,private base:string,private fetcher:typeof fetch=fetch,private connect:(url:URL,options:WebSocket.ClientOptions)=>WebSocket=(url,options)=>new WebSocket(url,options)) { this.base=apiEndpoint(base); }
  get busy(){return !!this.active;}
  async start(request:StreamRequest):Promise<Start>{
    if(this.active)return {ok:false,code:'BUSY',message:'A live dictation is already running.'};
    if(request.practice&&!hostedEndpoint(this.base))return {ok:false,code:'STREAM_UNSUPPORTED',message:'Practice requires the hosted service.'};
    let complete!:(r:StreamResult)=>void;
    const result=new Promise<StreamResult>(resolve=>{complete=resolve;});
    let readyResolve!:(r:Start)=>void;
    const ready=new Promise<Start>(resolve=>{readyResolve=resolve;});
    const active:Active={request,abort:new AbortController(),bytes:0,maxBytes:300*STREAM_BYTES_PER_SECOND,finishing:false,complete,result,fail:()=>{}};
    this.active=active;
    let settled=false;
    const fail=(code:string,message:string)=>{
      if(settled)return;settled=true;
      readyResolve({ok:false,code,message});complete({ok:false,code,message});
      active.abort.abort();active.socket?.terminate();
      // Retain failed sessions until finish/cancel so the saved clip is not automatically uploaded twice.
    };
    active.fail=fail;
    const openTiming=new TimingTrace(request.traceId,'client',request.requestId).span('stream.open');
    const handshake=new TimingTrace(request.traceId,'client',request.requestId).span('stream.handshake');
    const timer=setTimeout(()=>fail('STREAM_TIMEOUT','The live connection did not open in time. Retry the saved recording.'),25000);
    try{
      const token=await this.token();if(active.abort.signal.aborted)return await ready;
      const headers:Record<string,string>={Authorization:'Bearer '+token};
      if(!hostedEndpoint(this.base)){
        const response=await this.fetcher(this.base+'/v1/local-session',{signal:active.abort.signal,redirect:'error',cache:'no-store'});
        const value=await response.json();if(!response.ok||typeof value?.token!=='string'||!/^[a-f0-9]{64}$/.test(value.token))throw new Error('Invalid session');
        headers['x-sargosh-token']=value.token;
      }
      if(active.abort.signal.aborted)return await ready;
      const url=new URL(this.base+(request.practice?'/v1/practice/stream':'/v1/stream'));url.protocol=url.protocol==='https:'?'wss:':'ws:';
      url.searchParams.set('id',request.requestId);url.searchParams.set('language',request.language);url.searchParams.set('cleanup',request.cleanup?'1':'0');
      const socket=this.connect(url,{headers,handshakeTimeout:10000,maxPayload:1024*1024,followRedirects:false,perMessageDeflate:false});active.socket=socket;
      socket.on('unexpected-response',(_req,response)=>{
        handshake.end('failed',{statusCode:response.statusCode,handshakeFailure:'http-rejected'});
        response.resume();
        const status=response.statusCode;
        if(status===404||status===501)fail('STREAM_UNSUPPORTED','Live dictation is not available on this backend.');
        else if(status===429)fail('BUSY','A dictation is already processing. Wait for it to finish, then try again.');
        else if(status===401)fail('AUTH_REQUIRED','The live session could not be verified. Sign in again and retry.');
        else fail('STREAM_CONNECTION','Live dictation could not start. Check the service and your connection.');
      });
      socket.on('open',()=>handshake.end('ok',{statusCode:101}));
      socket.on('message',raw=>{
        if(settled||active.abort.signal.aborted)return;
        try{
          const message=JSON.parse(raw.toString());
          if(message.type==='ready'&&Number.isInteger(message.maxAudioSeconds)&&message.maxAudioSeconds>=1&&message.maxAudioSeconds<=(request.practice?20:300)){active.maxBytes=message.maxAudioSeconds*STREAM_BYTES_PER_SECOND;readyResolve({ok:true,maxAudioSeconds:message.maxAudioSeconds});return;}
          if(message.type==='error'&&typeof message.code==='string'&&message.code.length<=100&&typeof message.message==='string'&&message.message.length<=400){fail(message.code,message.message);return;}
          if(message.type==='result'&&active.finishing&&validStreamResult(message.result,request)){settled=true;complete({ok:true,result:message.result});socket.close(1000);return;}
          fail('STREAM_PROTOCOL','The service returned an invalid live response.');
        }catch{fail('STREAM_PROTOCOL','The service returned an unreadable live response.');}
      });
      socket.on('error',(error:Error & {code?:string})=>{
        const reason:TimingMeta['handshakeFailure']=error.message==='Invalid Sec-WebSocket-Accept header'?'invalid-accept-header':error.message==='Invalid Upgrade header'?'invalid-upgrade-header':error.message.includes('subprotocol')?'invalid-subprotocol':error.message.includes('Sec-WebSocket-Extensions')?'invalid-extensions':'socket-error';
        handshake.end('failed',{handshakeFailure:reason,networkError:error.code as TimingMeta['networkError']});
        fail('STREAM_CONNECTION','The live connection was interrupted. Retry the saved recording.');
      });
      socket.on('close',code=>{if(!settled){handshake.end('failed',{handshakeFailure:'socket-closed',closeCode:code});fail('STREAM_CONNECTION','The live connection closed before the transcript was ready. Retry the saved recording.');}});
      const opened=await ready;openTiming.end(opened.ok?'ok':'failed');return opened;
    }catch(error){handshake.end('failed',{handshakeFailure:'socket-error',networkError:(error as {code?:TimingMeta['networkError']})?.code});fail('STREAM_CONNECTION','Could not open live dictation. Retry the saved recording.');openTiming.end('failed');return await ready;}
    finally{clearTimeout(timer);}
  }
  chunk(id:string,audio:ArrayBuffer){
    const a=this.active;
    if(!a||a.request.requestId!==id||a.abort.signal.aborted)return false;
    if(a.finishing||!audio.byteLength||audio.byteLength%2||audio.byteLength>STREAM_MAX_CHUNK||a.bytes+audio.byteLength>a.maxBytes||a.socket?.readyState!==WebSocket.OPEN||a.socket.bufferedAmount>512*1024){a.fail('STREAM_LIMIT','The live connection could not accept more audio. Retry the saved recording.');return false;}
    a.bytes+=audio.byteLength;a.socket.send(Buffer.from(audio));return true;
  }
  async finish(id:string):Promise<StreamResult>{
    const a=this.active;if(!a||a.request.requestId!==id)return {ok:false,code:'STREAM_FAILED',message:'This live dictation is no longer available.'};
    const trace=new TimingTrace(a.request.traceId,'client',id);const span=trace.span('stream.transport');
    const timer=setTimeout(()=>a.fail('STREAM_TIMEOUT','Live dictation took too long. Retry the saved recording.'),45000);
    try{
      if(!a.abort.signal.aborted&&!a.finishing){a.finishing=true;a.socket?.send(JSON.stringify({type:'finish'}));}
      const result=await a.result;
      span.end(result.ok?'ok':'failed',result.ok?{model:result.result.cleanup?.ok?result.result.cleanup.result.model:undefined,serviceTier:result.result.cleanup?.ok?result.result.cleanup.result.serviceTier:undefined}:{});
      return result;
    }finally{clearTimeout(timer);a.abort.abort();a.socket?.terminate();if(this.active===a)this.active=undefined;}
  }
  cancel(id?:string){const a=this.active;if(!a||(id&&a.request.requestId!==id))return;a.fail('CANCELLED','Live dictation cancelled.');this.active=undefined;}
}
