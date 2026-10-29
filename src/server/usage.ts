import type { AccountUsage } from '../shared/usage';
export class UsageError extends Error {
 constructor(public code: string, message: string, public status=429, public resetAt?: string){super(message);}
}
export interface UsageLease { userId:string; requestId:string; kind:'stt'|'cleanup'; leaseId:string }
export interface UsageStore {
 reserve(userId:string,requestId:string,kind:'stt'|'cleanup',fingerprint:string,seconds:number,costMicro:number):Promise<UsageLease>;
 dispatch(lease:UsageLease):Promise<void>;
 finish(lease:UsageLease,costMicro?:number):Promise<void>;
 release(lease:UsageLease):Promise<void>;
 reserveStream?(userId:string,requestId:string,kind:'stt',fingerprint:string,seconds:number,costMicro:number):Promise<UsageLease>;
 finishStream?(lease:UsageLease,seconds:number,costMicro:number):Promise<void>;
 reservePractice?(userId:string,requestId:string,kind:'stt'|'cleanup',fingerprint:string,seconds:number,costMicro:number):Promise<UsageLease>;
 reservePracticeStream?(userId:string,requestId:string,kind:'stt',fingerprint:string,seconds:number,costMicro:number):Promise<UsageLease>;
 snapshot(userId:string):Promise<AccountUsage>;
}
const messages:Record<string,string>={
 PRACTICE_LIMIT:'Your three practice attempts are used. Finish setup to start normal dictation.',
 PRACTICE_UNAVAILABLE:'Practice is available only during unfinished first-time setup.',
 AUTH_REQUIRED:'Verify your email before using cloud dictation.',
 DAILY_LIMIT:'You have reached your daily 10-minute allowance.',
 MONTHLY_LIMIT:'You have reached your monthly 100-minute allowance.',
 SERVICE_BUDGET:'Cloud dictation has reached its monthly service allowance. Please try after the reset.',
 BUSY:'Another request is still processing for your account.',RATE_LIMIT:'Too many requests. Please wait a minute.',
 REQUEST_ID_REUSED:'Use a new request ID for a different recording.',
 REQUEST_PENDING:'This request has already been submitted. Please wait before checking again.',
 ALREADY_PROCESSED:'This request was already processed. Use the saved result, or explicitly retry with a new request.'
};
export class SupabaseUsageStore implements UsageStore {
 constructor(private url:string,private key:string,private fetcher:typeof fetch=fetch){}
 private async rpc(name:string,body:object):Promise<any>{
  try {
   const response=await this.fetcher(this.url+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:this.key,...(this.key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+this.key}),'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!response.ok){console.warn(JSON.stringify({event:'usage_storage_error',rpc:name,status:response.status}));throw new Error();}return await response.json();
  }catch{throw new UsageError('USAGE_UNAVAILABLE','Could not confirm your usage allowance. Please try again.',503);}
 }
 async reserve(userId:string,requestId:string,kind:'stt'|'cleanup',fingerprint:string,seconds:number,costMicro:number){return this.reserveWith('reserve_usage',userId,requestId,kind,fingerprint,seconds,costMicro);}
 async reserveStream(userId:string,requestId:string,kind:'stt',fingerprint:string,seconds:number,costMicro:number){return this.reserveWith('reserve_stream_usage',userId,requestId,kind,fingerprint,seconds,costMicro);}
 async finishStream(x:UsageLease,seconds:number,costMicro:number){if(await this.rpc('finish_stream_usage',{...this.args(x),p_seconds:seconds,p_cost_micro:costMicro})!==true)throw new UsageError('USAGE_UNAVAILABLE','Live audio usage could not be confirmed. Do not resend automatically.',503);}
 async reservePractice(userId:string,requestId:string,kind:'stt'|'cleanup',fingerprint:string,seconds:number,costMicro:number){return this.reserveWith('reserve_practice_usage',userId,requestId,kind,fingerprint,seconds,costMicro);}
 async reservePracticeStream(userId:string,requestId:string,kind:'stt',fingerprint:string,seconds:number,costMicro:number){return this.reserveWith('reserve_practice_stream_usage',userId,requestId,kind,fingerprint,seconds,costMicro);}
 private async reserveWith(rpc:string,userId:string,requestId:string,kind:'stt'|'cleanup',fingerprint:string,seconds:number,costMicro:number){
  const result=await this.rpc(rpc,{p_user_id:userId,p_request_id:requestId,p_kind:kind,p_fingerprint:fingerprint,p_seconds:seconds,p_cost_micro:costMicro});
  if(result?.code!=='OK'||typeof result.leaseId!=='string'){
   const code=typeof result?.code==='string'?result.code:'USAGE_UNAVAILABLE';
   const resetAt=typeof result?.resetAt==='string'?result.resetAt:undefined;

   throw new UsageError(code,(messages[code]??'Your allowance could not be checked.'),code==='AUTH_REQUIRED'?403:code==='REQUEST_ID_REUSED'||code==='ALREADY_PROCESSED'?409:429,resetAt);
  }
  return {userId,requestId,kind,leaseId:result.leaseId} as UsageLease;
 }
 private args(x:UsageLease){return {p_user_id:x.userId,p_request_id:x.requestId,p_kind:x.kind,p_lease_id:x.leaseId};}
 async dispatch(x:UsageLease){if(await this.rpc('dispatch_usage',this.args(x))!==true)throw new UsageError('REQUEST_PENDING','The request reservation expired. Try again.',409);}
 async finish(x:UsageLease,costMicro?:number){if(await this.rpc('finish_usage',{...this.args(x),p_cost_micro:costMicro??null})!==true)throw new UsageError('USAGE_UNAVAILABLE','The request completed, but its usage could not be confirmed. Do not resend automatically.',503);}
 async release(x:UsageLease){await this.rpc('release_usage',this.args(x));}
 async snapshot(userId:string){return this.rpc('account_usage',{p_user_id:userId}) as Promise<AccountUsage>;}
}
