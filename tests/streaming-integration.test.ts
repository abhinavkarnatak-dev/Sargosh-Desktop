import { expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createHostedServer } from '../src/server/hosted';
import { DesktopStreamer } from '../src/main/streaming';
import type { UsageLease } from '../src/server/usage';

it.each([false,true])('connects the authenticated desktop websocket to one cleanup and one audio charge (practice=%s)',async(practice)=>{
  const audio:Buffer[]=[];
  const lease:UsageLease={userId:'owner',requestId:'live-id',kind:'stt',leaseId:'lease'};
  const store={snapshot:vi.fn(async()=>({enabled:true,dailyLimitSeconds:600,monthlyLimitSeconds:6000,dailyUsedSeconds:practice?600:0,monthlyUsedSeconds:practice?6000:0,dailyResetAt:'',monthlyResetAt:''})),reserveStream:vi.fn(async()=>lease),reservePracticeStream:vi.fn(async()=>lease),reservePractice:vi.fn(async()=>({...lease,kind:'cleanup' as const})),reserve:vi.fn(async()=>({...lease,kind:'cleanup' as const})),dispatch:vi.fn(async()=>{}),finish:vi.fn(async()=>{}),release:vi.fn(async()=>{}),finishStream:vi.fn(async()=>{})};
  const clean=vi.fn(async()=>Response.json({model:'gpt-6-luna',status:'completed',service_tier:'fast',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"text":"The final sentence."}'}]}],usage:{input_tokens:50,output_tokens:10}}));
  // Use the real upgrade/auth/frame code with a fake paid provider boundary.
  const server=createHostedServer({streamingEnabled:true,openRecognizer:()=>({ready:Promise.resolve(),send:chunk=>audio.push(chunk),finish:async durationMs=>({text:'The final sentence.',language:'en',model:'nova-3',durationMs,confidence:null}),cancel:()=>{}}),apiKey:'fixture',allowedHosts:['api.example.com'],verifySession:async token=>token==='fixture-access'?'owner':null,usageStore:store,cleanupProvider:'openai',openaiApiKey:'fixture',openaiFetcher:clean});
  await server.listen({host:'127.0.0.1',port:0});
  const address=server.server.address();if(!address||typeof address==='string')throw new Error('Missing address');
  const client=new DesktopStreamer(async()=> 'fixture-access','https://api.example.com',fetch,(url,options)=>{const s=new WebSocket(`ws://127.0.0.1:${address.port}${url.pathname}${url.search}`,{...options,headers:{...options.headers,host:'api.example.com'}});return s;});
  try{
    const opened=await client.start({requestId:'live-id',traceId:'live-id',language:'en',cleanup:true,...(practice?{practice:true}:{})});
    expect(opened).toMatchObject({ok:true,maxAudioSeconds:practice?20:300});
    expect(client.chunk('live-id',new ArrayBuffer(3200))).toBe(true);
    const result=await client.finish('live-id');
    expect(result).toMatchObject({ok:true,result:{text:'The final sentence.',cleanup:{ok:true,result:{text:'The final sentence.',model:'gpt-6-luna'}}}});
    expect(audio).toHaveLength(1);expect(practice?store.reservePracticeStream:store.reserveStream).toHaveBeenCalledOnce();expect(store.finishStream).toHaveBeenCalledWith(lease,1,154);expect(clean).toHaveBeenCalledOnce();
    expect(practice?store.reservePractice:store.reserve).toHaveBeenCalledOnce();
    expect(practice?store.reserveStream:store.reservePracticeStream).not.toHaveBeenCalled();
    const unauthorized=new DesktopStreamer(async()=> 'invalid-access','https://api.example.com',fetch,(url,options)=>new WebSocket(`ws://127.0.0.1:${address.port}${url.pathname}${url.search}`,{...options,headers:{...options.headers,host:'api.example.com'}}));
    const rejected=await unauthorized.start({requestId:'reject-id',traceId:'reject-id',language:'en',cleanup:true,...(practice?{practice:true}:{})});expect(rejected.ok).toBe(false);unauthorized.cancel();expect(practice?store.reservePracticeStream:store.reserveStream).toHaveBeenCalledOnce();
  }finally{client.cancel();await server.close();}
});
