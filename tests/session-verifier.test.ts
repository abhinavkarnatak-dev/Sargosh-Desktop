import { afterEach, expect, it, vi } from 'vitest';
import { sessionVerifier } from '../src/server/auth';
afterEach(()=>vi.unstubAllGlobals());
it('asks the configured Supabase Auth service to verify tokens instead of trusting their contents',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({id:'verified-user',email:'person@example.com'}),{status:200,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
  const verify=sessionVerifier({url:'https://fixture.supabase.co',key:'sb_publishable_fixture-key'});
  expect(await verify('fake.payload.signature')).toBe('verified-user');expect(String(fetcher.mock.calls[0][0])).toBe('https://fixture.supabase.co/auth/v1/user');
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({message:'invalid token'}),{status:401,headers:{'content-type':'application/json'}}));expect(await verify('expired.payload.signature')).toBeNull();
  const before=fetcher.mock.calls.length;expect(await verify('x'.repeat(8193))).toBeNull();expect(fetcher).toHaveBeenCalledTimes(before);
});
