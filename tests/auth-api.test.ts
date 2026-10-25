import { expect, it, vi } from 'vitest';
import { createServer } from '../src/server/app';
const host = { host: '127.0.0.1:4318' };
const data = { results: { channels: [{ alternatives: [{ transcript: 'Verified words.', confidence: .9 }] }] }, metadata: { duration: 1 } };
it('blocks transcription and cleanup before paid calls when an account token is missing or invalid', async () => {
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(data)));const verifySession=vi.fn(async (_token:string)=>null);
  const app=createServer({localMode:true,apiKey:'fixture',geminiApiKey:'fixture',fetcher,geminiFetcher:fetcher,verifySession});
  try {
    const token=(await app.inject({method:'GET',url:'/v1/local-session',headers:host})).json().token;
    for(const authorization of [undefined,'Bearer expired'])for(const path of ['/v1/transcriptions?language=en','/v1/cleanup']){
      const response=await app.inject({method:'POST',url:path,headers:{...host,'x-sargosh-token':token,...(authorization?{authorization}:{}),'content-type':path.includes('cleanup')?'application/json':'audio/webm','x-sargosh-request-id':'test'},payload:path.includes('cleanup')?JSON.stringify({text:'Hello',language:'en'}):Buffer.from('voice')});
      expect(response.statusCode).toBe(401);expect(response.json().code).toBe('AUTH_REQUIRED');
    }
    expect(fetcher).not.toHaveBeenCalled();
  }finally{await app.close();}
});
it('separates cached transcripts by verified account even with identical request IDs',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(data)));const app=createServer({localMode:true,apiKey:'fixture',fetcher,verifySession:async token=>token==='token-a'?'user-a':token==='token-b'?'user-b':null});
  try{
    const local=(await app.inject({method:'GET',url:'/v1/local-session',headers:host})).json().token;
    for(const token of ['token-a','token-a','token-b']){
      const result=await app.inject({method:'POST',url:'/v1/transcriptions?language=en',headers:{...host,authorization:'Bearer '+token,'x-sargosh-token':local,'x-sargosh-request-id':'same-id','content-type':'audio/webm'},payload:Buffer.from('voice')});expect(result.statusCode).toBe(200);
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  }finally{await app.close();}
});
