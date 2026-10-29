import { installStreaming } from './streaming';
import { API_VERSION } from './version';
import { createCleanupProvider, type CleanupProviderOptions } from './cleanup-provider';
import { cleanupReservationCost, cleanupActualCost } from './cleanup-budget';
import Fastify from 'fastify';
import { installTimingHooks, timeRequest, markCached, cancelRequestTiming, providerTiming } from './timing';
import type { TimingSink } from '../shared/timing';
import { createHash } from 'node:crypto';
import { MAX_AUDIO_BYTES } from '../shared/recording';
import { audioType,isRequestId,isSpeechLanguage,type Transcript } from '../shared/transcription';
import { MAX_CLEANUP_CHARS,type CleanupResult } from '../shared/cleanup';
import { CLEANUP_PROMPT_VERSION } from './cleanup-prompt';
import { CleanupError } from './cleanup-common';
import { recognizeAudio,SpeechError } from './deepgram';
import { normalizeAudio,AudioError,type NormalizedAudio } from './audio';
import { sessionVerifier } from './auth';
import { UsageError,type UsageStore,type UsageLease } from './usage';
export interface HostedOptions extends CleanupProviderOptions {
 openRecognizer?:typeof import('./deepgram-stream').openDeepgramStream;
 streamingEnabled?:boolean; streamRateMicroPerMinute?:number;
 timingSink?:TimingSink;
 authConfig?:{url:string;key:string};verifySession?:(token:string)=>Promise<string|null>;
 usageStore?:UsageStore;apiKey?:string;
 fetcher?:typeof fetch;allowedHosts?:string[];ffmpegPath?:string;
 sttRateMicroPerMinute?:number;
 deleteAccount?:(userId:string)=>Promise<void>;
 normalize?:(input:Buffer,signal:AbortSignal)=>Promise<NormalizedAudio>;
}
export function createHostedServer(options:HostedOptions){
 const cleanup=createCleanupProvider(options);
 const verify=options.verifySession??(options.authConfig?sessionVerifier(options.authConfig):undefined);
 if(!verify||!options.usageStore||!options.allowedHosts?.length||!options.apiKey||!cleanup.configured)throw new Error('Hosted API requires authentication, usage storage, an allowed host, and provider configuration.');
 const store=options.usageStore;
 const server=Fastify({logger:false,bodyLimit:MAX_AUDIO_BYTES,requestTimeout:90000});
 installTimingHooks(server, options.timingSink);
 installStreaming(server,{...options,store,enabled:options.streamingEnabled===true,rate:options.streamRateMicroPerMinute,
  authorize:async(headers)=>{
   if(!options.allowedHosts!.includes(headers.host??'')||headers.origin)throw new UsageError('API_ORIGIN','Use the Sargosh desktop app.',403);
   const h=headers.authorization;const owner=typeof h==='string'&&h.startsWith('Bearer ')?await verify(h.slice(7)).catch(()=>null):null;
   if(!owner)throw new UsageError('AUTH_REQUIRED','Sign in again to use live dictation.',401);return owner;
  }
 });
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
  const userId=token?await timeRequest(request,'server.auth',()=>verify(token).catch(()=>null)):null;
  if(!userId)return reply.code(401).send({code:'AUTH_REQUIRED',message:'Sign in again to use cloud dictation.'});owners.set(request,userId);
 };
 server.get('/health',async()=>({status:'ok',service:'sargosh-api',version:API_VERSION}));
 server.get('/v1/readiness',async()=>({auth:true,stt:true,cleanup:true}));
 server.get('/v1/usage',{onRequest:authorized},async(request,reply)=>{
  try{return await store.snapshot(owners.get(request)!);}catch{return reply.code(503).send({code:'USAGE_UNAVAILABLE',message:'Could not load your allowance. Please try again.'});}
 });
 server.delete('/v1/account',{onRequest:authorized,bodyLimit:1024},async(request,reply)=>{
  const body=request.body as {confirmation?:unknown}|null;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||body.confirmation!=='DELETE')return reply.code(400).send({code:'DELETE_CONFIRMATION',message:'Confirm account deletion before continuing.'});
  if(!options.deleteAccount)return reply.code(503).send({code:'DELETE_UNAVAILABLE',message:'Account deletion is unavailable. Please try later.'});
  const userId=owners.get(request)!;
  try{
   await options.deleteAccount(userId);
   for(const key of cache.keys())if(key.startsWith(userId+':'))cache.delete(key);
   return {deleted:true};
  }catch{return reply.code(503).send({code:'DELETE_FAILED',message:'Account deletion could not be confirmed. Please try again.'});}
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
 for(const route of ['/v1/transcriptions','/v1/practice/transcriptions','/v1/dictations','/v1/practice/dictations']) server.post(route,{onRequest:authorized},async(request,reply)=>{
  const practice=route.includes('/practice/'),combined=route.endsWith('/dictations');
  const language=(request.query as {language?:unknown})?.language,id=request.headers['x-sargosh-request-id'];
  if(!isSpeechLanguage(language)||!isRequestId(id)||!audioType(request.headers['content-type']??'')||!Buffer.isBuffer(request.body)||!request.body.length)return reply.code(400).send({code:'INVALID_REQUEST',message:'A recording, supported language, and request ID are required.'});
  const owner=owners.get(request)!;const fingerprint=createHash('sha256').update(practice?'practice:':'').update(combined?CLEANUP_PROMPT_VERSION+cleanup.fingerprint:'').update(language).update(request.body).digest('hex');
  const abort=new AbortController();const disconnect=()=>{if(!reply.raw.writableEnded){cancelRequestTiming(request);abort.abort();}};
  let lease:UsageLease|undefined,dispatched=false,entered=false;
  try{
   // Verify account eligibility before decoding untrusted audio.
   if(!(await timeRequest(request,'server.eligibility',()=>store.snapshot(owner))).enabled)throw new UsageError('AUTH_REQUIRED','Verify your email before using cloud dictation.',403);
   const previous=cached(owner,combined?'dictation':'stt',id,fingerprint);if(previous){markCached(request);return previous;}
   if(active>=2)throw new UsageError('SERVICE_BUSY','The service is busy. Please try again shortly.');active++;entered=true;
   request.raw.once('aborted',disconnect);reply.raw.once('close',disconnect);
   const normalized=await timeRequest(request,'server.normalize',()=>(options.normalize??((bytes,signal)=>normalizeAudio(bytes,signal,options.ffmpegPath)))(request.body as Buffer,abort.signal),{bytes:request.body.length},abort.signal);
   if(!Number.isInteger(normalized.durationSeconds)||normalized.durationSeconds<1||normalized.durationSeconds>300)throw new AudioError('RECORDING_LIMIT','A recording can be at most 5 minutes.');
   const cost=Math.ceil(normalized.durationSeconds*(options.sttRateMicroPerMinute??5200)/60);
   if(practice && normalized.durationSeconds>20)throw new UsageError('PRACTICE_DURATION','Keep practice recordings within 20 seconds.',400);
   if(practice && !store.reservePractice)throw new UsageError('PRACTICE_UNAVAILABLE','Practice is not available yet. Please try later.',503);
   lease=await timeRequest(request,'server.reserve',()=>practice?store.reservePractice!(owner,id,'stt',fingerprint,normalized.durationSeconds,cost):store.reserve(owner,id,'stt',fingerprint,normalized.durationSeconds,cost));
   if(abort.signal.aborted)throw new AudioError('CANCELLED','Recording cancelled.',499);
   await timeRequest(request,'server.dispatch',()=>store.dispatch(lease!));dispatched=true;
   const result=await timeRequest(request,'server.stt',()=>recognizeAudio({apiKey:options.apiKey!,audio:normalized.audio,mimeType:'audio/wav',language,signal:abort.signal,fetcher:options.fetcher,measure:providerTiming(request,'stt')}),{audioMs:normalized.durationSeconds*1000,model:'nova-3'},abort.signal);
   await timeRequest(request,'server.finish',()=>store.finish(lease!));
   if(combined && result.text.trim()) {
    let cleanupLease:UsageLease|undefined,cleanupDispatched=false,actualCost:number|undefined;
    try {
     if(abort.signal.aborted)throw new CleanupError('CANCELLED','Cleanup cancelled.',499);
     const model=cleanup.model,text=result.text;
     if(text.length>MAX_CLEANUP_CHARS)throw new CleanupError('CLEANUP_INPUT','The transcript exceeds the cleanup limit. The original transcript is available.',400);
     const cleanupFingerprint=createHash('sha256').update(practice?'practice:':'').update(CLEANUP_PROMPT_VERSION).update(cleanup.fingerprint).update(language).update(text).digest('hex');
     const reservedCost=cleanupReservationCost(text,language,model);
     if(practice && (text.length>3000 || !store.reservePractice))throw new UsageError('PRACTICE_UNAVAILABLE','This practice request cannot be processed.',400);
     cleanupLease=await timeRequest(request,'server.reserve',()=>practice?store.reservePractice!(owner,id,'cleanup',cleanupFingerprint,0,reservedCost):store.reserve(owner,id,'cleanup',cleanupFingerprint,0,reservedCost));
     if(abort.signal.aborted)throw new CleanupError('CANCELLED','Cleanup cancelled.',499);
     await timeRequest(request,'server.dispatch',()=>store.dispatch(cleanupLease!));cleanupDispatched=true;
     const cleaned=await timeRequest(request,'server.cleanup',()=>cleanup.clean({text,language,signal:abort.signal,measure:providerTiming(request,'cleanup'),onUsage:usage=>{actualCost=cleanupActualCost(usage,text,language,model);}}),{characters:text.length,model},abort.signal);
     await timeRequest(request,'server.finish',()=>store.finish(cleanupLease!,actualCost));cleanupLease=undefined;
     result.cleanup={ok:true,result:cleaned};
    } catch(error) {
     const known=error instanceof CleanupError||error instanceof UsageError;
     result.cleanup={ok:false,code:known?error.code:'CLEANUP_FAILED',message:known?error.message:'Cleanup failed. The original transcript is available.'};
    } finally {
     if(cleanupLease)await timeRequest(request,cleanupDispatched?'server.finish':'server.release',()=>cleanupDispatched?store.finish(cleanupLease!,actualCost):store.release(cleanupLease!)).catch(()=>console.warn(JSON.stringify({event:'cleanup_settlement_failed'})));
    }
   }
   save(owner,combined?'dictation':'stt',id,fingerprint,result);return result;
  }catch(error){return failure(error,reply);}finally{
   if(lease&&!dispatched)await timeRequest(request,'server.release',()=>store.release(lease!)).catch(()=>{});
   if(entered)active--;request.raw.removeListener('aborted',disconnect);reply.raw.removeListener('close',disconnect);
  }
 });
 for(const route of ['/v1/cleanup','/v1/practice/cleanup']) server.post(route,{bodyLimit:128*1024,onRequest:authorized},async(request,reply)=>{
  const practice=route.includes('/practice/');
  const body=request.body as {text?:unknown;language?:unknown}|null,id=request.headers['x-sargosh-request-id'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['text','language'].includes(key))||typeof body.text!=='string'||!body.text.trim()||body.text.length>MAX_CLEANUP_CHARS||!isSpeechLanguage(body.language)||!isRequestId(id))return reply.code(400).send({code:'CLEANUP_INPUT',message:'A transcript, supported language, and request ID are required.'});
  const owner=owners.get(request)!,model=cleanup.model;
  const fingerprint=createHash('sha256').update(practice?'practice:':'').update(CLEANUP_PROMPT_VERSION).update(cleanup.fingerprint).update(body.language).update(body.text).digest('hex');
  const abort=new AbortController();const disconnect=()=>{if(!reply.raw.writableEnded){cancelRequestTiming(request);abort.abort();}};
  let lease:UsageLease|undefined,dispatched=false,entered=false,settled=false,actualCost:number|undefined;
  try{
   if(!(await timeRequest(request,'server.eligibility',()=>store.snapshot(owner))).enabled)throw new UsageError('AUTH_REQUIRED','Verify your email before using cloud dictation.',403);
   const previous=cached(owner,'cleanup',id,fingerprint);if(previous){markCached(request);return previous;}
   if(active>=2)throw new UsageError('SERVICE_BUSY','The service is busy. Please try again shortly.');active++;entered=true;
   request.raw.once('aborted',disconnect);reply.raw.once('close',disconnect);
   // UTF-8 byte count conservatively bounds text tokens; output includes the model's thinking budget.
   const reservedCost=cleanupReservationCost(body.text,body.language,model);
   if(practice && (body.text.length>3000 || !store.reservePractice))throw new UsageError('PRACTICE_UNAVAILABLE','This practice request cannot be processed.',400);
   lease=await timeRequest(request,'server.reserve',()=>practice?store.reservePractice!(owner,id,'cleanup',fingerprint,0,reservedCost):store.reserve(owner,id,'cleanup',fingerprint,0,reservedCost));
   if(abort.signal.aborted)throw new AudioError('CANCELLED','Cleanup cancelled.',499);
   await timeRequest(request,'server.dispatch',()=>store.dispatch(lease!));dispatched=true;
   const text=body.text, language=body.language;
   const result=await timeRequest(request,'server.cleanup',()=>cleanup.clean({text,language,signal:abort.signal,measure:providerTiming(request,'cleanup'),onUsage:usage=>{actualCost=cleanupActualCost(usage,text,language,model);}}),{characters:text.length,model},abort.signal);
   await timeRequest(request,'server.finish',()=>store.finish(lease!,actualCost));settled=true;save(owner,'cleanup',id,fingerprint,result);return result;
  }catch(error){return failure(error,reply);}finally{
   if(lease&&!settled)await timeRequest(request,dispatched?'server.finish':'server.release',()=>dispatched?store.finish(lease!,actualCost):store.release(lease!)).catch(()=>console.warn(JSON.stringify({event:'cleanup_settlement_failed'})));
   if(entered)active--;request.raw.removeListener('aborted',disconnect);reply.raw.removeListener('close',disconnect);
  }
 });
 return server;
}
