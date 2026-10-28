import { expect,it,vi } from 'vitest';
const mock=vi.hoisted(()=>({handler:null as null|((request:unknown,reply:unknown)=>void)}));
vi.mock('node:http',()=>({createServer:(handler:typeof mock.handler)=>{
 mock.handler=handler;return {once:vi.fn(),removeListener:vi.fn(),listen:(_port:number,_host:string,ready:()=>void)=>ready(),address:()=>({port:48123}),close:vi.fn(),closeIdleConnections:vi.fn()};
}}));
import { GoogleCallback,GOOGLE_COMPLETION_URL } from '../src/main/google-callback';
function response(){return {setHeader:vi.fn(),writeHead:vi.fn(),end:vi.fn()};}
it('redirects only after the desktop exchange succeeds, without carrying codes or tokens',async()=>{
 const callback=new GoogleCallback(0);let resolve!:()=>void;const accept=vi.fn(()=>new Promise<void>(done=>resolve=done));
 try{
 const url=new URL(await callback.listen(accept,vi.fn()));const reply=response();mock.handler!({method:'GET',headers:{host:url.host},url:url.pathname+'?code=private-code'},reply);
 expect(accept).toHaveBeenCalledExactlyOnceWith('private-code');expect(reply.writeHead).not.toHaveBeenCalled();expect(reply.end).not.toHaveBeenCalled();
 resolve();await Promise.resolve();await Promise.resolve();
 expect(reply.writeHead).toHaveBeenCalledExactlyOnceWith(303,{Location:GOOGLE_COMPLETION_URL,'Content-Length':'0'});expect(reply.end).toHaveBeenCalledExactlyOnceWith();
 expect(GOOGLE_COMPLETION_URL).toBe('https://sargosh.abhinavkarnatak.com/auth/complete');expect(new URL(GOOGLE_COMPLETION_URL).search).toBe('');expect(reply.setHeader).toHaveBeenCalledWith('Referrer-Policy','no-referrer');
 }finally{callback.close();}
});
it('keeps failed exchanges on the local error page and never redirects them',async()=>{
 const callback=new GoogleCallback(0);
 try{
 const url=new URL(await callback.listen(async()=>{throw new Error('private exchange failure');},vi.fn()));const reply=response();mock.handler!({method:'GET',headers:{host:url.host},url:url.pathname+'?code=private-code'},reply);
 await Promise.resolve();await Promise.resolve();expect(reply.writeHead).toHaveBeenCalledWith(400);expect(reply.writeHead.mock.calls.some(call=>call[0]===303)).toBe(false);
 expect(reply.end.mock.calls[0][0]).toContain('Sign-in did not complete.');expect(reply.end.mock.calls[0][0]).not.toContain('private');
 }finally{callback.close();}
});
it('does not redirect a cancelled provider response or accept its code',async()=>{
 const callback=new GoogleCallback(0);const accept=vi.fn(),timeout=vi.fn();
 try{
 const url=new URL(await callback.listen(accept,timeout));const reply=response();mock.handler!({method:'GET',headers:{host:url.host},url:url.pathname+'?error=access_denied'},reply);
 expect(accept).not.toHaveBeenCalled();expect(timeout).toHaveBeenCalledOnce();expect(reply.writeHead).not.toHaveBeenCalled();expect(reply.end.mock.calls[0][0]).toContain('Sign-in did not complete.');
 }finally{callback.close();}
});
