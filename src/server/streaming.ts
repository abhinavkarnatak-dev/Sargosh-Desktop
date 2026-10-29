import { WebSocketServer, WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { STREAM_BYTES_PER_SECOND, STREAM_MAX_CHUNK, STREAM_MAX_BUFFER } from '../shared/streaming';
import { isRequestId, isSpeechLanguage } from '../shared/transcription';
import { TimingTrace, type TimingSink, type TimingMeta } from '../shared/timing';
import { openDeepgramStream, type LiveRecognizer } from './deepgram-stream';
import { SpeechError } from './deepgram';
import { UsageError, type UsageStore, type UsageLease } from './usage';
import { createCleanupProvider, type CleanupProviderOptions } from './cleanup-provider';
import { CleanupError } from './cleanup-common';
import { cleanupActualCost, cleanupReservationCost } from './cleanup-budget';
import { CLEANUP_PROMPT_VERSION } from './cleanup-prompt';
import { MAX_CLEANUP_CHARS } from '../shared/cleanup';

export interface StreamOptions extends CleanupProviderOptions {
  enabled: boolean; apiKey?: string; store?: UsageStore; rate?: number; timingSink?: TimingSink;
  authorize: (headers: import('node:http').IncomingHttpHeaders, ip: string) => Promise<string>;
  openRecognizer?: typeof openDeepgramStream;
}
export function installStreaming(server: FastifyInstance, options: StreamOptions) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: STREAM_MAX_CHUNK, perMessageDeflate: false });
  const accounts = new Set<string>(); let pending = 0;
  const handshakes = new Set<import('node:stream').Duplex>();
  const upgrade = (request:import('node:http').IncomingMessage, socket:import('node:stream').Duplex, head:Buffer) => {
    const reject = (status: number, code: string, message: string) => {
      const body=JSON.stringify({code,message});socket.end(`HTTP/1.1 ${status} Rejected\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    };
    let url: URL; try { url=new URL(request.url??'', 'http://localhost'); } catch { reject(400,'INVALID_REQUEST','Invalid live request.');return; }
    const practice=url.pathname==='/v1/practice/stream';
    if(url.pathname!=='/v1/stream'&&!practice){reject(404,'STREAM_UNSUPPORTED','Live dictation is not available on this backend.');return;}
    if(!options.enabled || !options.apiKey || (options.store && (!options.store.reserveStream || !options.store.finishStream))){reject(501,'STREAM_UNSUPPORTED','Live dictation is not enabled on this backend.');return;}
    if(practice&&(!options.store?.reservePracticeStream||!options.store.reservePractice)){reject(501,'STREAM_UNSUPPORTED','Live practice is not enabled on this backend.');return;}
    if(pending>=2){reject(429,'BUSY','The service is processing other recordings.');return;}
    const id=url.searchParams.get('id'),language=url.searchParams.get('language'),clean=url.searchParams.get('cleanup');
    if(!isRequestId(id)||!isSpeechLanguage(language)||!['0','1'].includes(clean??'')||[...url.searchParams.keys()].some(x=>!['id','language','cleanup'].includes(x))){reject(400,'INVALID_REQUEST','Invalid live request.');return;}
    pending++;
    const handshake=new TimingTrace(id,'server',id,options.timingSink).span('stream.handshake');
    let owner:string|undefined,owned=false,accepted=false,released=false;
    handshakes.add(socket);
    const release=()=>{
      if(released)return;
      released=true;pending--;clearTimeout(deadline);handshakes.delete(socket);
      if(owner && owned)accounts.delete(owner);
    };
    const closed=()=>{if(!accepted){handshake.end('failed',{handshakeFailure:'socket-closed'});release();}};
    const errored=(error:Error & {code?:string})=>{
      handshake.end('failed',{handshakeFailure:'socket-error',networkError:error.code as TimingMeta['networkError']});
      release();socket.destroy();
    };
    const deadline=setTimeout(()=>{handshake.end('failed',{handshakeFailure:'socket-destroyed'});release();socket.destroy();},15000);
    socket.once('close',closed);socket.once('error',errored);
    void (async()=>{
      try {
        const authorizedOwner=await new TimingTrace(id,'server',id,options.timingSink).measure('server.auth',()=>options.authorize(request.headers,request.socket.remoteAddress??''));
        if(released||socket.destroyed){handshake.end('failed',{handshakeFailure:'socket-destroyed'});release();return;}
        owner=authorizedOwner;
        if(accounts.has(owner))throw new UsageError('BUSY','A dictation is already running for this account.');
        accounts.add(owner);owned=true;
        const account=owner;
        sockets.handleUpgrade(request,socket,head,ws=>{
          accepted=true;handshakes.delete(socket);
          socket.removeListener('close',closed);socket.removeListener('error',errored);
          handshake.end('ok',{statusCode:101});
          clearTimeout(deadline);
          void serveStream(ws,account,id,language,clean==='1',options,practice).catch(()=>{ws.terminate();}).finally(release);
        });
        // With no verifyClient hook, ws invokes this callback synchronously on acceptance.
        // Invalid handshakes instead return normally: they must not retain the account lock.
        if(!accepted){handshake.end('failed',{handshakeFailure:'upgrade-rejected'});release();}
      } catch(error) {
        if(released)return;
        handshake.end('failed',{handshakeFailure:error instanceof UsageError?'http-rejected':'upgrade-exception',statusCode:error instanceof UsageError?error.status:500,networkError:(error as {code?:TimingMeta['networkError']})?.code});
        release();
        const e=error instanceof UsageError?error:new UsageError('STREAM_FAILED','The live connection could not start. Try again.',500);
        if(!socket.destroyed)reject(e.status,e.code,e.message);
      }
    })();
  };
  server.server.on('upgrade',upgrade);
  server.addHook('preClose',async()=>{server.server.removeListener('upgrade',upgrade);for(const socket of handshakes)socket.destroy();for(const client of sockets.clients)client.terminate();});
}
export async function serveStream(ws:WebSocket,owner:string,id:string,language:import('../shared/transcription').SpeechLanguage,combined:boolean,options:StreamOptions,practice=false) {
    const cleanup=createCleanupProvider(options);
    const trace=new TimingTrace(id,'server',id,options.timingSink);
    const abort=new AbortController();const store=options.store;
    let live:LiveRecognizer|undefined,lease:UsageLease|undefined,dispatched=false,bytes=0,limit=practice?20:300,finished=false,ready=false;
    let queue=Promise.resolve();let queuedBytes=0,queuedFrames=0;
    const cost=(seconds:number)=>Math.ceil(seconds*(options.rate??9200)/60);
    const fingerprint=createHash('sha256').update((practice?'practice:':'')+'stream:linear16:16000:mono:'+language).digest('hex');
    const send=(value:object)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value));};
    const timer=setTimeout(()=>{send({type:'error',code:'STREAM_TIMEOUT',message:'The live recording reached its time limit. Retry the saved recording.'});abort.abort();ws.close();},practice?90000:310000);
    const close=()=>{abort.abort();};ws.on('close',close);ws.on('error',close);
    let rejectEnd!:(e:Error)=>void,resolveEnd!:()=>void;
    const end=new Promise<void>((yes,no)=>{resolveEnd=yes;rejectEnd=no;});void end.catch(()=>{});
    const cancelled=()=>rejectEnd(new SpeechError('CANCELLED','Live dictation cancelled.',499));abort.signal.addEventListener('abort',cancelled,{once:true});
    const fail=(error:unknown)=>{
      const e=error instanceof SpeechError||error instanceof UsageError||error instanceof CleanupError?error:new SpeechError('STREAM_FAILED','Live dictation could not finish. Retry the saved recording.');
      send({type:'error',code:e.code,message:e.message});rejectEnd(e);abort.abort();ws.close();
    };
    ws.on('message',(raw,binary)=>{
      if(abort.signal.aborted)return;
      const size=Buffer.isBuffer(raw)?raw.length:raw instanceof ArrayBuffer?raw.byteLength:raw.reduce((n,x)=>n+x.length,0);
      if(++queuedFrames>256 || (queuedBytes+=size)>STREAM_MAX_BUFFER){fail(new SpeechError('STREAM_LIMIT','The live connection sent audio too quickly.'));return;}
      queue=queue.then(async()=>{
        if(abort.signal.aborted) return;
        if(!ready||finished)throw new SpeechError('STREAM_PROTOCOL','Unexpected live audio.');
        if(binary){
          const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw as ArrayBuffer);
          if(!chunk.length||chunk.length%2||chunk.length>STREAM_MAX_CHUNK||bytes+chunk.length>limit*STREAM_BYTES_PER_SECOND)throw new SpeechError('STREAM_LIMIT','The live recording exceeded its audio allowance.');
          // Persist dispatch before the first paid byte. Count bytes before send: uncertain sends remain charged.
          if(!dispatched && lease){await trace.measure('server.dispatch',()=>store!.dispatch(lease!));dispatched=true;}
          if(abort.signal.aborted)return;
          bytes+=chunk.length;live!.send(chunk);return;
        }
        if(raw.toString().length>1024)throw new SpeechError('STREAM_PROTOCOL','Invalid live control.');
        const control=JSON.parse(raw.toString());
        if(control?.type==='cancel'){abort.abort();return;}
        if(control?.type!=='finish'||Object.keys(control).length!==1)throw new SpeechError('STREAM_PROTOCOL','Invalid live control.');
        finished=true;
        const transcript=await trace.measure('stream.finalize',()=>live!.finish(Math.round(bytes/STREAM_BYTES_PER_SECOND*1000)),{bytes,model:'nova-3'},abort.signal);
        await settle();
        if(abort.signal.aborted)return;
        if(combined && transcript.text.trim()){
          let cleanLease:UsageLease|undefined,cleanDispatched=false;
          try {
            const text=transcript.text,model=cleanup.model;
            if(text.length>(practice?3000:MAX_CLEANUP_CHARS))throw new CleanupError('CLEANUP_INPUT','The transcript exceeds the cleanup limit.',400);
            const fp=createHash('sha256').update((practice?'practice:':'')+CLEANUP_PROMPT_VERSION+cleanup.fingerprint+language+text).digest('hex');
            if(store)cleanLease=await trace.measure('server.reserve',()=>practice?store.reservePractice!(owner,id,'cleanup',fp,0,cleanupReservationCost(text,language,model)):store.reserve(owner,id,'cleanup',fp,0,cleanupReservationCost(text,language,model)));
            if(abort.signal.aborted)throw new CleanupError('CANCELLED','Dictation cancelled.',499);
            if(cleanLease){await trace.measure('server.dispatch',()=>store!.dispatch(cleanLease!));cleanDispatched=true;}
            let actual:number|undefined;
            const result=await trace.measure('server.cleanup',()=>cleanup.clean({text,language,signal:abort.signal,measure:(stage,work)=>trace.measure(`provider.cleanup.${stage}`,work),onUsage:usage=>{actual=cleanupActualCost(usage,text,language,model);}}),{characters:text.length,model},abort.signal);
            if(cleanLease)await trace.measure('server.finish',()=>store!.finish(cleanLease!,actual));
            transcript.cleanup={ok:true,result};
          } catch(error){const e=error instanceof CleanupError||error instanceof UsageError?error:new CleanupError('CLEANUP_FAILED','Cleanup failed. The original transcript is available.');transcript.cleanup={ok:false,code:e.code,message:e.message};}
          finally{if(cleanLease&&!cleanDispatched)await store!.release(cleanLease).catch(()=>{});}
        }
        if(abort.signal.aborted)return;
        send({type:'result',result:transcript});resolveEnd();ws.close(1000);
      }).catch(fail).finally(()=>{queuedFrames--;queuedBytes-=size;});
    });
    async function settle(){
      if(!lease)return;
      const current=lease;
      if(dispatched){const seconds=Math.ceil(bytes/STREAM_BYTES_PER_SECOND);await trace.measure('server.finish',()=>store!.finishStream!(current,seconds,cost(seconds)));}
      else await store!.release(current);
      lease=undefined;
    }
    try {
      if(store){
        const usage=await trace.measure('server.eligibility',()=>store.snapshot(owner));
        if(!usage.enabled)throw new UsageError('AUTH_REQUIRED','Verify your email before using live dictation.',403);
        if(practice){
          if(!store.reservePracticeStream||!store.reservePractice||!store.finishStream)throw new UsageError('PRACTICE_UNAVAILABLE','Live practice is not available yet.',503);
          lease=await trace.measure('server.reserve',()=>store.reservePracticeStream!(owner,id,'stt',fingerprint,limit,cost(limit)));
        }else{
          const day=Math.floor(usage.dailyLimitSeconds-usage.dailyUsedSeconds),month=Math.floor(usage.monthlyLimitSeconds-usage.monthlyUsedSeconds);
          if(day<1)throw new UsageError('DAILY_LIMIT','You have reached your daily allowance.');
          if(month<1)throw new UsageError('MONTHLY_LIMIT','You have reached your monthly allowance.');
          limit=Math.min(300,day,month);
          lease=await trace.measure('server.reserve',()=>store.reserveStream!(owner,id,'stt',fingerprint,limit,cost(limit)));
        }
      }
      else if(practice)throw new UsageError('PRACTICE_UNAVAILABLE','Practice requires usage accounting.',503);
      if(abort.signal.aborted)throw new SpeechError('CANCELLED','Dictation cancelled.',499);
      live=(options.openRecognizer??openDeepgramStream)(options.apiKey!,language,abort.signal);
      await trace.measure('stream.connect',()=>live!.ready,{},abort.signal);
      if(abort.signal.aborted)throw new SpeechError('CANCELLED','Dictation cancelled.',499);
      ready=true;send({type:'ready',maxAudioSeconds:limit});
      await end;
    } catch(error){if(!abort.signal.aborted)fail(error);}
    finally{
      abort.abort();live?.cancel();clearTimeout(timer);ws.removeListener('close',close);ws.removeListener('error',close);
      // Await in-flight dispatch before settling disconnects. Never refund bytes possibly sent upstream.
      await queue;await settle().catch(()=>{});ws.close();
    }
  }
