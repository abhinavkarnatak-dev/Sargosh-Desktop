import { expect,it,vi } from 'vitest';
import { createServer } from '../src/server/app';
import { UsageError,type UsageStore } from '../src/server/usage';
const usage={enabled:true,dailyLimitSeconds:600,monthlyLimitSeconds:6000,dailyUsedSeconds:0,monthlyUsedSeconds:0,dailyResetAt:'2026-10-27T00:00:00Z',monthlyResetAt:'2026-11-01T00:00:00Z'};
function setup(){
 const store={snapshot:vi.fn(async()=>usage),reserve:vi.fn(async(userId,requestId,kind)=>({userId,requestId,kind,leaseId:'lease-1'})),dispatch:vi.fn(async()=>{}),finish:vi.fn(async()=>{}),release:vi.fn(async()=>{})} as unknown as UsageStore;
 const provider=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({results:{channels:[{alternatives:[{transcript:'Hello.',confidence:.9}]}]},metadata:{duration:2}})));
 const normalized=vi.fn(async()=>({audio:Buffer.from('server-validated-mono-audio'),durationSeconds:2}));
 const app=createServer({hostedMode:true,allowedHosts:['api.test'],usageStore:store,verifySession:async token=>token==='valid'?'account-1':null,apiKey:'fixture-deepgram',geminiApiKey:'fixture-gemini',fetcher:provider,normalize:normalized});
 const upload=(id='one',audio='audio',token='valid')=>app.inject({method:'POST',url:'/v1/transcriptions?language=multi',headers:{host:'api.test',authorization:'Bearer '+token,'content-type':'audio/webm','x-sargosh-request-id':id},payload:Buffer.from(audio)});
 return{app,store,provider,normalized,upload};
}
it('keeps health public and rejects unauthenticated paid calls before decoding',async()=>{
 const x=setup();try{expect((await x.app.inject({url:'/health'})).json().status).toBe('ok');expect((await x.upload('one','audio','expired')).statusCode).toBe(401);expect(x.normalized).not.toHaveBeenCalled();expect(x.provider).not.toHaveBeenCalled();}finally{await x.app.close();}
});
it('normalizes audio, reserves before dispatch, and deduplicates transport retries',async()=>{
 const x=setup();try{
  expect((await x.upload()).statusCode).toBe(200);expect((await x.upload()).statusCode).toBe(200);expect(x.provider).toHaveBeenCalledOnce();
  expect(x.store.reserve).toHaveBeenCalledWith('account-1','one','stt',expect.any(String),2,174);
  expect(vi.mocked(x.store.dispatch).mock.invocationCallOrder[0]).toBeLessThan(x.provider.mock.invocationCallOrder[0]);
  expect(Buffer.from(x.provider.mock.calls[0][1]!.body as ArrayBuffer).toString()).toBe('server-validated-mono-audio');
  expect((await x.upload('one','different')).statusCode).toBe(409);
 }finally{await x.app.close();}
});
it('blocks exhausted allowances without starting paid work',async()=>{
 const x=setup();vi.mocked(x.store.reserve).mockRejectedValueOnce(new UsageError('DAILY_LIMIT','Daily allowance reached.',429,'2026-10-27T00:00:00Z'));
 try{const r=await x.upload();expect(r.statusCode).toBe(429);expect(r.json()).toMatchObject({code:'DAILY_LIMIT',resetAt:'2026-10-27T00:00:00Z'});expect(x.provider).not.toHaveBeenCalled();}finally{await x.app.close();}
});
it('does not call the provider when the shared quota service fails',async()=>{
 const x=setup();vi.mocked(x.store.reserve).mockRejectedValueOnce(new Error('private connection detail'));
 try{const r=await x.upload();expect(r.statusCode).toBe(503);expect(r.body).not.toContain('private');expect(x.provider).not.toHaveBeenCalled();}finally{await x.app.close();}
});
it('holds dispatched usage when a provider outcome is uncertain',async()=>{
 const x=setup();x.provider.mockRejectedValueOnce(new Error('network reset'));
 try{expect((await x.upload()).statusCode).toBe(502);expect(x.store.release).not.toHaveBeenCalled();expect(x.store.dispatch).toHaveBeenCalledOnce();}finally{await x.app.close();}
});
it('isolates an account usage request from supplied user IDs',async()=>{
 const x=setup();try{const r=await x.app.inject({url:'/v1/usage?userId=someone-else',headers:{host:'api.test',authorization:'Bearer valid'}});expect(r.statusCode).toBe(200);expect(x.store.snapshot).toHaveBeenCalledWith('account-1');}finally{await x.app.close();}
});
it('rejects browser origins and host mismatches',async()=>{
 const x=setup();try{for(const headers of [{host:'evil.test'},{host:'api.test',origin:'https://evil.test'}])expect((await x.app.inject({url:'/v1/usage',headers})).statusCode).toBe(403);expect(x.provider).not.toHaveBeenCalled();}finally{await x.app.close();}
});

it('reserves cleanup separately, reconciles token usage, and deduplicates cleanup retries',async()=>{
 const store={snapshot:vi.fn(async()=>usage),reserve:vi.fn(async(userId,requestId,kind)=>({userId,requestId,kind,leaseId:'lease-clean'})),dispatch:vi.fn(async()=>{}),finish:vi.fn(async()=>{}),release:vi.fn(async()=>{})} as unknown as UsageStore;
 const provider=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({usageMetadata:{promptTokenCount:100,totalTokenCount:140},candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({text:'Hello.'})}]}}]})));
 const app=createServer({hostedMode:true,allowedHosts:['api.test'],usageStore:store,verifySession:async()=> 'account-1',apiKey:'fixture',geminiApiKey:'fixture',geminiFetcher:provider});
 try{
  const submit=()=>app.inject({method:'POST',url:'/v1/cleanup',headers:{host:'api.test',authorization:'Bearer valid','x-sargosh-request-id':'cleanup-one','content-type':'application/json'},payload:{text:'Um hello.',language:'en'}});
  expect((await submit()).statusCode).toBe(200);expect((await submit()).statusCode).toBe(200);expect(provider).toHaveBeenCalledOnce();
  expect(store.reserve).toHaveBeenCalledWith('account-1','cleanup-one','cleanup',expect.any(String),0,expect.any(Number));
  expect(store.finish).toHaveBeenCalledWith(expect.objectContaining({kind:'cleanup'}),130);
 }finally{await app.close();}
});

it.each([false,true])('settles a failed standalone cleanup before accepting the next request, practice=%s',async practice=>{
 let active=false;
 const reserve=vi.fn<UsageStore['reserve']>(async(userId,requestId,kind)=>{if(active)throw new UsageError('BUSY','Another request is still processing for your account.');active=true;return {userId,requestId,kind,leaseId:'cleanup'};});
 const store={snapshot:async()=>usage,reserve,reservePractice:reserve,dispatch:async()=>{},finish:vi.fn(async()=>{active=false;}),release:vi.fn(async()=>{})} as unknown as UsageStore;
 const provider=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({}, {status:429})).mockResolvedValue(Response.json({model:'gpt-6-luna',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"text":"Hello."}'}]}]}));
 const app=createServer({hostedMode:true,allowedHosts:['api.test'],usageStore:store,verifySession:async()=> 'account-1',apiKey:'fixture',cleanupProvider:'openai',openaiApiKey:'fixture',openaiFetcher:provider});
 const submit=(id:string)=>app.inject({method:'POST',url:practice?'/v1/practice/cleanup':'/v1/cleanup',headers:{host:'api.test',authorization:'Bearer valid','x-sargosh-request-id':id},payload:{text:'Um hello.',language:'en'}});
 try{
  expect((await submit('failed')).json().code).toBe('OPENAI_QUOTA');expect(active).toBe(false);
  expect(store.finish).toHaveBeenCalledWith(expect.objectContaining({kind:'cleanup'}),undefined);expect(store.release).not.toHaveBeenCalled();
  expect((await submit('next')).statusCode).toBe(200);
 }finally{await app.close();}
});

it('reports service capacity without claiming the account already has a dictation',async()=>{
 const x=setup(),waiting:Array<()=>void>=[];
 x.provider.mockImplementation(async()=>{await new Promise<void>(resolve=>waiting.push(resolve));return Response.json({results:{channels:[{alternatives:[{transcript:'Hello.',confidence:.9}]}]},metadata:{duration:2}});});
 const first=Promise.resolve(x.upload('one')),second=Promise.resolve(x.upload('two'));
 try{
  for(let i=0;i<30&&waiting.length<2;i++)await new Promise<void>(resolve=>setImmediate(resolve));
  expect(waiting).toHaveLength(2);
  const blocked=await x.upload('third');expect(blocked.statusCode).toBe(429);expect(blocked.json()).toEqual({code:'SERVICE_BUSY',message:'The service is busy. Please try again shortly.'});
 }finally{waiting.forEach(resolve=>resolve());await Promise.all([first,second]);await x.app.close();}
});
