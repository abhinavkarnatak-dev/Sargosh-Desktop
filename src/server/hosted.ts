import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { MAX_AUDIO_BYTES } from '../shared/recording';
import { audioType,isRequestId,isSpeechLanguage,type Transcript } from '../shared/transcription';
import { DEFAULT_CLEANUP_MODEL,MAX_CLEANUP_CHARS,type CleanupModel,type CleanupResult } from '../shared/cleanup';
import { CLEANUP_INSTRUCTIONS,CLEANUP_PROMPT_VERSION } from './cleanup-prompt';
import { cleanTranscript,CleanupError,cleanupOutputLimit } from './gemini';
import { recognizeAudio,SpeechError } from './deepgram';
import { normalizeAudio,AudioError,type NormalizedAudio } from './audio';
import { sessionVerifier } from './auth';
import { UsageError,type UsageStore,type UsageLease } from './usage';
export interface HostedOptions {
 authConfig?:{url:string;key:string};verifySession?:(token:string)=>Promise<string|null>;
 usageStore?:UsageStore;apiKey?:string;geminiApiKey?:string;geminiModel?:CleanupModel;
 fetcher?:typeof fetch;geminiFetcher?:typeof fetch;allowedHosts?:string[];ffmpegPath?:string;
 sttRateMicroPerMinute?:number;
 normalize?:(input:Buffer,signal:AbortSignal)=>Promise<NormalizedAudio>;
}
export function createHostedServer(options:HostedOptions){
 const verify=options.verifySession??(options.authConfig?sessionVerifier(options.authConfig):undefined);
 if(!verify||!options.usageStore||!options.allowedHosts?.length||!options.apiKey||!options.geminiApiKey)throw new Error('Hosted API requires authentication, usage storage, an allowed host, and provider configuration.');
 const store=options.usageStore;
 const server=Fastify({logger:false,bodyLimit:MAX_AUDIO_BYTES,requestTimeout:90000});
 const owners=new WeakMap<object,string>();let active=0;
 const cache=new Map<string,{fingerprint:string;time:number;result:Transcript|CleanupResult}>();
 server.addHook('onRequest',async(request,reply)=>{
  reply.header('Cache-Control','no-store');reply.header('X-Content-Type-Options','nosniff');
  if(request.url==='/health')return;
  if(!options.allowedHosts!.includes(request.headers.host??'')||request.headers.origin)return reply.code(403).send({code:'API_ORIGIN',message:'This endpoint is available to the Sargosh desktop app.'});
 });
 server.setErrorHandler((error:Error&{statusCode?:number},_request,reply)=>{
  reply.code(error.statusCode===413?413:500).send({code:error.statusCode===413?'REQUEST_TOO_LARGE':'API_ERROR',message:'The request could not be processed.'});
 });
 const authorized=async(request:any,reply:any)=>{
  const header=request.headers.authorization;const token=typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7):'';
  const userId=token?await verify(token).catch(()=>null):null;
  if(!userId)return reply.code(401).send({code:'AUTH_REQUIRED',message:'Sign in again to use cloud dictation.'});owners.set(request,userId);
 };
 server.get('/health',async()=>({status:'ok',service:'sargosh-api',version:'0.1.0'}));
 server.get('/v1/readiness',async()=>({auth:true,stt:true,cleanup:true}));
 server.get('/v1/usage',{onRequest:authorized},async(request,reply)=>{
  try{return await store.snapshot(owners.get(request)!);}catch{return reply.code(503).send({code:'USAGE_UNAVAILABLE',message:'Could not load your allowance. Please try again.'});}
 });
 server.addContentTypeParser(/^audio\/(webm|ogg|wav|mpeg|mp4)(?:\s*;.*)?$/i,{parseAs:'buffer',bodyLimit:MAX_AUDIO_BYTES},(_request,body,done)=>done(null,body));
 function cached(owner:string,kind:string,id:string,fingerprint:string){
  const now=Date.now();for(const[key,item]of cache)if(now-item.time>5*60000)cache.delete(key);
  const entry=cache.get(owner+':'+kind+':'+id);
  if(entry&&entry.fingerprint!==fingerprint)throw new UsageError('REQUEST_ID_REUSED','Use a new request ID for different content.',409);
  return entry?.result;
 }
 function save(owner:string,kind:string,id:string,fingerprint:string,result:Transcript|CleanupResult){
  if(cache.size>=64)cache.delete(cache.keys().next().value!);cache.set(owner+':'+kind+':'+id,{fingerprint,time:Date.now(),result});
 }
 function failure(error:unknown,reply:any){
  if(error instanceof UsageError||error instanceof AudioError||error instanceof SpeechError||error instanceof CleanupError)return reply.code(error.status).send({code:error.code,message:error.message,...(error instanceof UsageError&&error.resetAt?{resetAt:error.resetAt}:{})});
  return reply.code(503).send({code:'CLOUD_UNAVAILABLE',message:'Cloud dictation could not complete. Please try later.'});
 }
 server.post('/v1/transcriptions',{onRequest:authorized},async(request,reply)=>{
  const language=(request.query as {language?:unknown})?.language,id=request.headers['x-sargosh-request-id'];
  if(!isSpeechLanguage(language)||!isRequestId(id)||!audioType(request.headers['content-type']??'')||!Buffer.isBuffer(request.body)||!request.body.length)return reply.code(400).send({code:'INVALID_REQUEST',message:'A recording, supported language, and request ID are required.'});
  const owner=owners.get(request)!;const fingerprint=createHash('sha256').update(language).update(request.body).digest('hex');
  const abort=new AbortController();const disconnect=()=>{if(!reply.raw.writableEnded)abort.abort();};
  let lease:UsageLease|undefined,dispatched=false,entered=false;
  try{
   // Verify account eligibility before decoding untrusted audio.
   if(!(await store.snapshot(owner)).enabled)throw new UsageError('AUTH_REQUIRED','Verify your email before using cloud dictation.',403);
   const previous=cached(owner,'stt',id,fingerprint);if(previous)return previous;
   if(active>=2)throw new UsageError('BUSY','The service is processing other recordings. Please try shortly.');active++;entered=true;
   request.raw.once('aborted',disconnect);reply.raw.once('close',disconnect);
   const normalized=await(options.normalize??((bytes,signal)=>normalizeAudio(bytes,signal,options.ffmpegPath)))(request.body,abort.signal);
   if(!Number.isInteger(normalized.durationSeconds)||normalized.durationSeconds<1||normalized.durationSeconds>300)throw new AudioError('RECORDING_LIMIT','A recording can be at most 5 minutes.');
   const cost=Math.ceil(normalized.durationSeconds*(options.sttRateMicroPerMinute??5200)/60);
   lease=await store.reserve(owner,id,'stt',fingerprint,normalized.durationSeconds,cost);
   if(abort.signal.aborted)throw new AudioError('CANCELLED','Recording cancelled.',499);
   await store.dispatch(lease);dispatched=true;
   const result=await recognizeAudio({apiKey:options.apiKey!,audio:normalized.audio,mimeType:'audio/wav',language,signal:abort.signal,fetcher:options.fetcher});
   await store.finish(lease);save(owner,'stt',id,fingerprint,result);return result;
  }catch(error){return failure(error,reply);}finally{
   if(lease&&!dispatched)await store.release(lease).catch(()=>{});
   if(entered)active--;request.raw.removeListener('aborted',disconnect);reply.raw.removeListener('close',disconnect);
  }
 });
 server.post('/v1/cleanup',{bodyLimit:128*1024,onRequest:authorized},async(request,reply)=>{
  const body=request.body as {text?:unknown;language?:unknown}|null,id=request.headers['x-sargosh-request-id'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['text','language'].includes(key))||typeof body.text!=='string'||!body.text.trim()||body.text.length>MAX_CLEANUP_CHARS||!isSpeechLanguage(body.language)||!isRequestId(id))return reply.code(400).send({code:'CLEANUP_INPUT',message:'A transcript, supported language, and request ID are required.'});
  const owner=owners.get(request)!,model=options.geminiModel??DEFAULT_CLEANUP_MODEL;
  const fingerprint=createHash('sha256').update(CLEANUP_PROMPT_VERSION).update(model).update(body.language).update(body.text).digest('hex');
  const abort=new AbortController();const disconnect=()=>{if(!reply.raw.writableEnded)abort.abort();};
  let lease:UsageLease|undefined,dispatched=false,entered=false;
  try{
   if(!(await store.snapshot(owner)).enabled)throw new UsageError('AUTH_REQUIRED','Verify your email before using cloud dictation.',403);
   const previous=cached(owner,'cleanup',id,fingerprint);if(previous)return previous;
   if(active>=2)throw new UsageError('BUSY','The service is processing other recordings. Please try shortly.');active++;entered=true;
   request.raw.once('aborted',disconnect);reply.raw.once('close',disconnect);
   // UTF-8 byte count conservatively bounds text tokens; output includes the model's thinking budget.
   const reservedCost=Math.ceil((Buffer.byteLength(JSON.stringify({language:body.language,transcript:body.text}))+Buffer.byteLength(CLEANUP_INSTRUCTIONS)+1024)*.30+cleanupOutputLimit(body.text)*2.50);
   lease=await store.reserve(owner,id,'cleanup',fingerprint,0,reservedCost);
   if(abort.signal.aborted)throw new AudioError('CANCELLED','Cleanup cancelled.',499);
   await store.dispatch(lease);dispatched=true;let actualCost:number|undefined;
   const result=await cleanTranscript({apiKey:options.geminiApiKey!,model,text:body.text,language:body.language,signal:abort.signal,fetcher:options.geminiFetcher,onUsage:usage=>{actualCost=Math.ceil(usage.inputTokens*.30+usage.outputTokens*2.50);}});
   await store.finish(lease,actualCost);save(owner,'cleanup',id,fingerprint,result);return result;
  }catch(error){return failure(error,reply);}finally{
   if(lease&&!dispatched)await store.release(lease).catch(()=>{});
   if(entered)active--;request.raw.removeListener('aborted',disconnect);reply.raw.removeListener('close',disconnect);
  }
 });
 return server;
}
