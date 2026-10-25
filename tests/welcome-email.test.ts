import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWelcomeHandler, welcomeEmail, welcomeAuthDiagnostic } from '../supabase/functions/send-welcome/worker';
import { WELCOME_HTML } from '../supabase/functions/send-welcome/template';
const config={url:'https://fixture.supabase.co',serviceKey:'server-fixture-key',jobToken:'job-fixture-token',resendKey:'resend-fixture-key',from:'Sargosh <hello@example.com>'};
const job={user_id:'11111111-1111-4111-8111-111111111111',lease_id:'22222222-2222-4222-8222-222222222222',email:'person@example.com',first_name:'Priya'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
const request=(token=config.jobToken,body='{}')=>new Request('https://fixture.supabase.co/functions/v1/send-welcome',{method:'POST',headers:{Authorization:'Bearer '+token},body});
it('escapes names and keeps the deployed email identical to its editable source',()=>{
  expect(WELCOME_HTML).toBe(readFileSync('assets/email/welcome.html','utf8').replace(/\r\n/g,'\n'));
  const mail=welcomeEmail('<img src=x onerror=alert(1)>');expect(mail.html).toContain('&lt;img');expect(mail.html).not.toContain('<img src=x');expect(mail.html).not.toContain('{{first_name}}');expect(mail.html).not.toContain('{{ .Token }}');expect(mail.html).toContain('prefers-color-scheme: dark');expect(mail.subject).toBe('Welcome to Sargosh');
});
it('rejects browser/public credentials without touching the database or provider',async()=>{
  const send=vi.fn<typeof fetch>();const handler=createWelcomeHandler(config,send,vi.fn());
  expect((await handler(request('publishable-fixture-key'))).status).toBe(401);
  expect((await handler(new Request('https://fixture.supabase.co'))).status).toBe(405);
  expect(send).not.toHaveBeenCalled();
});
it('sends only the claimed recipient, with a stable identifier, and records acceptance under its lease',async()=>{
  const send=vi.fn<typeof fetch>().mockResolvedValueOnce(reply([job])).mockResolvedValueOnce(reply({id:'email-123'})).mockResolvedValueOnce(reply(true));
  const response=await createWelcomeHandler(config,send)(request(config.jobToken,JSON.stringify({to:'attacker@example.com'})));
  expect(await response.json()).toEqual({sent:1,failed:0});
  const options=send.mock.calls[1][1]!;expect(JSON.parse(options.body as string).to).toEqual([job.email]);expect(new Headers(options.headers).get('Idempotency-Key')).toBe('welcome/'+job.user_id);
  expect(JSON.parse(send.mock.calls[2][1]!.body as string)).toEqual({p_user_id:job.user_id,p_lease_id:job.lease_id,p_provider_id:'email-123'});
});
it.each([429,408,500,503,400,401,403,422])('handles provider status %i without exposing its response',async status=>{
  const send=vi.fn<typeof fetch>().mockResolvedValueOnce(reply([job])).mockResolvedValueOnce(reply({message:'private recipient details'},status)).mockResolvedValueOnce(reply(true));
  const result=await createWelcomeHandler(config,send)(request());expect(await result.text()).not.toContain('private');
  expect(JSON.parse(send.mock.calls[2][1]!.body as string)).toEqual({p_user_id:job.user_id,p_lease_id:job.lease_id,p_error:'provider_http_'+status,p_retry:status>=500||status===429||status===408});
});
it('retries uncertain network outcomes using the persisted job',async()=>{
  const send=vi.fn<typeof fetch>().mockResolvedValueOnce(reply([job])).mockRejectedValueOnce(new Error('private network detail')).mockResolvedValueOnce(reply(true));
  const result=await createWelcomeHandler(config,send)(request());expect(await result.json()).toEqual({sent:0,failed:1});expect(JSON.parse(send.mock.calls[2][1]!.body as string).p_retry).toBe(true);
});
it('does not report success if recording acceptance fails',async()=>{
  const send=vi.fn<typeof fetch>().mockResolvedValueOnce(reply([job])).mockResolvedValueOnce(reply({id:'accepted'})).mockResolvedValueOnce(reply({},503));
  const result=await createWelcomeHandler(config,send)(request());expect(result.status).toBe(503);expect(await result.text()).not.toContain(config.serviceKey);
});
it('does not contact Resend when the queue is empty or configuration is missing',async()=>{
  const send=vi.fn<typeof fetch>().mockResolvedValueOnce(reply([]));expect(await (await createWelcomeHandler(config,send)(request())).json()).toEqual({sent:0,failed:0});expect(send).toHaveBeenCalledOnce();
  const disabled=vi.fn<typeof fetch>();expect((await createWelcomeHandler({...config,resendKey:''},disabled)(request())).status).toBe(503);expect(disabled).not.toHaveBeenCalled();
});

it('diagnoses rejection without exposing credentials or trusting token claims',async()=>{
  const jwt=(role:string,ref:string)=>'header.'+btoa(JSON.stringify({role,ref}))+'.private-signature';
  const server=jwt('service_role','same-project');
  const wrong=jwt('anon','same-project');
  const report=vi.fn(),send=vi.fn<typeof fetch>();
  expect((await createWelcomeHandler({...config,jobToken:server},send,report)(request(wrong))).status).toBe(401);
  expect(send).not.toHaveBeenCalled();
  expect(report.mock.calls[0][0]).toMatchObject({serverCredentialConfigured:true,credentialMatches:false,receivedRoleUnverified:'anon',serverRoleUnverified:'service_role',projectClaimMatches:true});
  expect(JSON.stringify(report.mock.calls)).not.toContain(server);expect(JSON.stringify(report.mock.calls)).not.toContain(wrong);expect(JSON.stringify(report.mock.calls)).not.toContain('private-signature');expect(JSON.stringify(report.mock.calls)).not.toContain('same-project');
  expect(welcomeAuthDiagnostic('Bearer '+server,'')).toMatchObject({serverCredentialConfigured:false});
  expect(welcomeAuthDiagnostic('Bearer Bearer '+server,server)).toMatchObject({extraBearerPrefix:true,tokenHasWhitespace:true});
  expect(welcomeAuthDiagnostic('Bearer '+jwt('service_role','different-project'),server)).toMatchObject({projectClaimMatches:false});
  expect(welcomeAuthDiagnostic('',server)).toMatchObject({authorizationHeaderPresent:false});
});

it('accepts the explicit job token when the database uses a different opaque secret key',async()=>{
  const send=vi.fn<typeof fetch>().mockResolvedValueOnce(reply([]));
  const options={...config,serviceKey:'sb_secret_database-fixture'};
  expect((await createWelcomeHandler(options,send)(request())).status).toBe(200);
  const headers=new Headers(send.mock.calls[0][1]!.headers);
  expect(headers.get('apikey')).toBe(options.serviceKey);expect(headers.has('Authorization')).toBe(false);
  const rejected=vi.fn<typeof fetch>();
  expect((await createWelcomeHandler(options,rejected,vi.fn())(request(options.serviceKey))).status).toBe(401);expect(rejected).not.toHaveBeenCalled();
});
it('fails closed if the explicit job token has not been configured',async()=>{
  const send=vi.fn<typeof fetch>();expect((await createWelcomeHandler({...config,jobToken:''},send,vi.fn())(request())).status).toBe(401);expect(send).not.toHaveBeenCalled();
});
it('preserves legacy JWT authorization for database calls',async()=>{
 const send=vi.fn<typeof fetch>().mockResolvedValueOnce(reply([]));
 await createWelcomeHandler(config,send)(request());expect(new Headers(send.mock.calls[0][1]!.headers).get('Authorization')).toBe('Bearer '+config.serviceKey);
});

it('reports an empty queue explicitly without exposing recipient data',async()=>{
 const report=vi.fn(),send=vi.fn<typeof fetch>().mockResolvedValueOnce(reply([]));
 await createWelcomeHandler(config,send,vi.fn(),report)(request());
 expect(report.mock.calls.map(call=>call[0].stage)).toEqual(['started','queue_claimed','completed']);
 expect(report.mock.calls[1][0].count).toBe(0);
 expect(JSON.stringify(report.mock.calls)).not.toContain(config.serviceKey);
});
it('identifies a rejected database request without leaking its message',async()=>{
 const report=vi.fn(),send=vi.fn<typeof fetch>().mockResolvedValueOnce(reply({code:'42501',message:'private database data '+config.serviceKey},403));
 const result=await createWelcomeHandler(config,send,vi.fn(),report)(request());
 expect(await result.json()).toEqual({error:'database_request_failed',stage:'claim_welcome_emails',status:403,code:'42501'});
 expect(report.mock.calls.at(-1)![0]).toMatchObject({stage:'claim_welcome_emails',status:403,code:'42501'});
 expect(JSON.stringify(report.mock.calls)).not.toContain('private');expect(JSON.stringify(report.mock.calls)).not.toContain(config.serviceKey);
});
it('identifies missing configuration before touching the database',async()=>{
 const report=vi.fn(),send=vi.fn<typeof fetch>();
 await createWelcomeHandler({...config,resendKey:''},send,vi.fn(),report)(request());
 expect(report.mock.calls[0][0]).toMatchObject({stage:'configuration_missing',resendConfigured:false,senderConfigured:true,databaseConfigured:true});expect(send).not.toHaveBeenCalled();
});
it('identifies network failures in the database stage',async()=>{
 const report=vi.fn(),send=vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('private network detail'));
 const result=await createWelcomeHandler(config,send,vi.fn(),report)(request());expect(result.status).toBe(503);
 expect(report.mock.calls.at(-1)![0]).toMatchObject({stage:'claim_welcome_emails',code:'database_unreachable'});
 expect(JSON.stringify(report.mock.calls)).not.toContain('private network');
});
