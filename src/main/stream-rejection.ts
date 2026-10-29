import type { IncomingMessage } from 'node:http';
interface Rejection {code:string;message:string}
function rejection(status:number|undefined,body:string):Rejection {
 let code:unknown;try{code=JSON.parse(body)?.code;}catch{ /* Proxies can return HTML instead of an API error. */ }
 if(status===429||status===503){
  if(code==='SERVICE_BUSY')return {code:'SERVICE_BUSY',message:'The service is busy. Please try again shortly.'};
  if(code==='BUSY')return {code:'BUSY',message:'A dictation is already processing for your account. Wait for it to finish, then try again.'};
  if(code==='RATE_LIMIT')return {code:'RATE_LIMIT',message:'Too many requests. Please wait a minute.'};
 }
 if(status===404||status===501)return {code:'STREAM_UNSUPPORTED',message:'Live dictation is not available on this backend.'};
 if(status===401)return {code:'AUTH_REQUIRED',message:'The live session could not be verified. Sign in again and retry.'};
 if(status===429)return {code:'SERVICE_BUSY',message:'The service is busy. Please try again shortly.'};
 return {code:'STREAM_CONNECTION',message:'Live dictation could not start. Check the service and your connection.'};
}
// Read only a small rejection body; never display provider/proxy text to the user.
export function readStreamRejection(response:IncomingMessage):Promise<Rejection>{
 return new Promise(resolve=>{
  const chunks:Buffer[]=[];let bytes=0,ended=false;
  const finish=(body='')=>{
   if(ended)return;ended=true;clearTimeout(timer);
   response.removeListener('data',data);response.removeListener('end',end);response.removeListener('error',failed);response.removeListener('aborted',failed);
   resolve(rejection(response.statusCode,body));
  };
  const failed=()=>finish();
  const data=(chunk:Buffer|string)=>{const part=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=part.length;if(bytes>4096){finish();response.destroy();}else chunks.push(part);};
  const end=()=>finish(Buffer.concat(chunks).toString('utf8'));
  const timer=setTimeout(()=>{finish();response.destroy();},2000);
  response.on('data',data);response.once('end',end);response.once('error',failed);response.once('aborted',failed);response.resume();
 });
}
