import { expect,it,vi } from 'vitest';
import { createServer } from '../src/server/app';
import { UsageError,type UsageStore } from '../src/server/usage';
function fixture(seconds=5){
 const reserve=vi.fn(),practice=vi.fn(async(userId,requestId,kind)=>({userId,requestId,kind,leaseId:'lease'}));
 const store={snapshot:async()=>({enabled:true}),reserve,reservePractice:practice,dispatch:async()=>{},finish:async()=>{},release:async()=>{}} as unknown as UsageStore;
 const stt=vi.fn<typeof fetch>(async()=>Response.json({results:{channels:[{alternatives:[{transcript:'Hello.',confidence:1}]}]},metadata:{duration:seconds}}));
 const llm=vi.fn<typeof fetch>(async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({text:'Hello.'})}]}}]}));
 const app=createServer({hostedMode:true,allowedHosts:['api.test'],usageStore:store,verifySession:async token=>token==='valid'?'user':null,apiKey:'fixture',geminiApiKey:'fixture',fetcher:stt,geminiFetcher:llm,normalize:async()=>({audio:Buffer.from('wav'),durationSeconds:seconds})});
 const headers={host:'api.test',authorization:'Bearer valid','x-sargosh-request-id':'practice'};
 return {app,reserve,practice,stt,llm,headers};
}
it('routes both practice stages through separate reservations and keeps normal allowance untouched',async()=>{
 const x=fixture();try{
  const speech=await x.app.inject({method:'POST',url:'/v1/practice/transcriptions?language=en',headers:{...x.headers,'content-type':'audio/webm'},payload:Buffer.from('audio')});expect(speech.statusCode).toBe(200);
  const clean=await x.app.inject({method:'POST',url:'/v1/practice/cleanup',headers:x.headers,payload:{text:'Hello.',language:'en'}});expect(clean.statusCode).toBe(200);
  expect(x.practice).toHaveBeenCalledWith('user','practice','stt',expect.any(String),5,expect.any(Number));expect(x.practice).toHaveBeenCalledWith('user','practice','cleanup',expect.any(String),0,expect.any(Number));expect(x.reserve).not.toHaveBeenCalled();
  expect(x.stt).toHaveBeenCalledOnce();expect(x.llm).toHaveBeenCalledOnce();
 }finally{await x.app.close();}
});
it('rejects long, unauthenticated, or exhausted practice before provider calls',async()=>{
 const x=fixture(21);try{
  const submit=(token='valid')=>x.app.inject({method:'POST',url:'/v1/practice/transcriptions?language=en',headers:{...x.headers,authorization:'Bearer '+token,'content-type':'audio/webm'},payload:Buffer.from('audio')});
  expect((await submit('expired')).statusCode).toBe(401);expect((await submit()).statusCode).toBe(400);expect(x.practice).not.toHaveBeenCalled();expect(x.stt).not.toHaveBeenCalled();
 }finally{await x.app.close();}
 const y=fixture();y.practice.mockRejectedValueOnce(new UsageError('PRACTICE_LIMIT','Practice exhausted.'));
 try{expect((await y.app.inject({method:'POST',url:'/v1/practice/transcriptions?language=en',headers:{...y.headers,'content-type':'audio/webm'},payload:Buffer.from('audio')})).statusCode).toBe(429);expect(y.stt).not.toHaveBeenCalled();expect(y.reserve).not.toHaveBeenCalled();}finally{await y.app.close();}
});
