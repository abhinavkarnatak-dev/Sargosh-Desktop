import { WELCOME_HTML } from './template.ts';
export interface WelcomeConfig { url: string; serviceKey: string; jobToken: string; resendKey: string; from: string }
interface Job { user_id: string; lease_id: string; email: string; first_name: string }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function welcomeEmail(name: string) {
  return {
    subject: 'Welcome to Sargosh',
    html: WELCOME_HTML.replace('{{first_name}}', escapeHtml(name)),
    text: `Welcome, ${name}.\n\nYour Sargosh account is ready.\n\n1. Click the text box where you want to write.\n2. Hold your recording shortcut and speak. Release it when you finish.\n3. Sargosh turns your speech into text and inserts it into the selected text box.\n\nFor hands-free dictation, double-tap your shortcut to start and double-tap again to finish. View or change your shortcut in Settings.\n\nSpeak freely. Stay in your flow.`
  };
}
function equalSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let different = 0; for (let i=0;i<a.length;i++) different |= a.charCodeAt(i)^b.charCodeAt(i);
  return different===0;
}
// Token claims are unverified here and used only to diagnose rejected requests.
// They must never grant access. Never log headers, tokens, payloads, or fingerprints.
function diagnosticClaims(token: string): { role: string | null; ref: string | null } {
  try {
    if(token.length>12000) return {role:null,ref:null};
    const part=token.split('.')[1];
    const payload=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'=')));
    const role=['service_role','anon','authenticated'].includes(payload.role)?payload.role:'other';
    return {role,ref:typeof payload.ref==='string'?payload.ref:null};
  } catch { return {role:null,ref:null}; }
}
export function welcomeAuthDiagnostic(header: string, serverKey: string) {
  const match=/^Bearer (.*)$/i.exec(header);
  const token=match?.[1]??'';
  const received=diagnosticClaims(token), expected=diagnosticClaims(serverKey);
  return {
    event:'welcome_auth_check',version:3,
    serverCredentialConfigured:Boolean(serverKey),
    authorizationHeaderPresent:Boolean(header),
    bearerHeaderPresent:Boolean(match),
    extraBearerPrefix:/^Bearer /i.test(token),
    tokenHasWhitespace:/\s/.test(token),
    serverCredentialHasWhitespace:/\s/.test(serverKey),
    credentialMatches:Boolean(serverKey)&&equalSecret(header,'Bearer '+serverKey),
    receivedRoleUnverified:received.role,
    serverRoleUnverified:expected.role,
    projectClaimMatches:received.ref&&expected.ref?received.ref===expected.ref:null
  };
}
export interface WelcomeRunDiagnostic {
  event: 'welcome_worker'; version: 4; stage: string;
  count?: number; sent?: number; failed?: number; status?: number; code?: string;
  databaseConfigured?: boolean; resendConfigured?: boolean; senderConfigured?: boolean; urlConfigured?: boolean;
}
class WelcomeWorkerError extends Error {
  constructor(readonly stage: string, readonly status: number, readonly code: string) { super('welcome_worker_error'); }
}
const response = (status: number, value: object) => new Response(JSON.stringify(value), {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export function createWelcomeHandler(config: WelcomeConfig, send: typeof fetch = fetch, reportAuth: (details: ReturnType<typeof welcomeAuthDiagnostic>) => void = details => console.warn(JSON.stringify(details)), reportRun: (details: WelcomeRunDiagnostic) => void = details => console.info(JSON.stringify(details))) {
  const report = (stage: string, details: Omit<WelcomeRunDiagnostic,'event'|'version'|'stage'> = {}) => reportRun({event:'welcome_worker',version:4,stage,...details});
  async function rpc(name: string, body: object): Promise<unknown> {
    let result: Response;
    try { result = await send(config.url+'/rest/v1/rpc/'+name, {
      method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{apikey:config.serviceKey,...(config.serviceKey.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+config.serviceKey}),'Content-Type':'application/json'},body:JSON.stringify(body)
    }); } catch { throw new WelcomeWorkerError(name,0,'database_unreachable'); }
    if (!result.ok) {
      let code='database_rejected';
      try {
        const value=await result.json() as {code?:unknown};
        if(typeof value.code==='string'&&/^(PGRST[0-9]{3}|[0-9A-Z]{5})$/.test(value.code)) code=value.code;
      } catch { /* Do not log raw response bodies. */ }
      throw new WelcomeWorkerError(name,result.status,code);
    }
    try { return await result.json(); } catch { throw new WelcomeWorkerError(name,result.status,'database_invalid_response'); }
  }
  return async (request: Request): Promise<Response> => {
    if (request.method!=='POST') return response(405,{error:'method_not_allowed'});
    if (!config.jobToken || !equalSecret(request.headers.get('Authorization')??'', 'Bearer '+config.jobToken)) {
      reportAuth(welcomeAuthDiagnostic(request.headers.get('Authorization')??'', config.jobToken));
      return response(401,{error:'unauthorized'});
    }
    if (!config.serviceKey || !config.resendKey || !config.from || !config.url.startsWith('https://')) {
      report('configuration_missing',{databaseConfigured:Boolean(config.serviceKey),resendConfigured:Boolean(config.resendKey),senderConfigured:Boolean(config.from),urlConfigured:config.url.startsWith('https://')});
      return response(503,{error:'email_not_configured'});
    }
    report('started');
    try {
      const jobs=await rpc('claim_welcome_emails',{}) as Job[];
      if(!Array.isArray(jobs)) throw new WelcomeWorkerError('claim_welcome_emails',200,'database_invalid_response');
      report('queue_claimed',{count:jobs.length});
      let sent=0,failed=0;
      for(const job of jobs){
        const lease={p_user_id:job.user_id,p_lease_id:job.lease_id};
        let provider: Response;
        try {
          provider=await send('https://api.resend.com/emails',{
            method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
            headers:{Authorization:'Bearer '+config.resendKey,'Content-Type':'application/json','Idempotency-Key':'welcome/'+job.user_id},
            body:JSON.stringify({from:config.from,to:[job.email],...welcomeEmail(job.first_name)})
          });
        } catch {
          report('provider_unreachable');
          await rpc('fail_welcome_email',{...lease,p_error:'provider_unreachable',p_retry:true});failed++;continue;
        }
        if(!provider.ok){
          report('provider_rejected',{status:provider.status});
          await rpc('fail_welcome_email',{...lease,p_error:'provider_http_'+provider.status,p_retry:provider.status>=500||provider.status===429||provider.status===408});failed++;continue;
        }
        // Never store/log the raw provider response, which may include recipient details.
        let id: unknown;
        try { id=(await provider.json() as {id?:unknown}).id; } catch { /* Retry using the same request identifier. */ }
        if(typeof id!=='string'||!id||id.length>200){report('provider_invalid_response');await rpc('fail_welcome_email',{...lease,p_error:'provider_invalid_response',p_retry:true});failed++;continue;}
        const finished=await rpc('finish_welcome_email',{...lease,p_provider_id:id});
        if(finished!==true) throw new WelcomeWorkerError('finish_welcome_email',409,'lease_lost');
        sent++;
      }
      report('completed',{sent,failed});
      return response(200,{sent,failed});
    }catch(error) {
      if(error instanceof WelcomeWorkerError) {
        report(error.stage,{status:error.status,code:error.code});
        return response(503,{error:'database_request_failed',stage:error.stage,status:error.status,code:error.code});
      }
      report('unexpected_error');
      return response(503,{error:'welcome_worker_unavailable'});
    }
  };
}
