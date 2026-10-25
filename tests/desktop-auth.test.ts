import { beforeEach, expect, it, vi } from 'vitest';
import { DesktopAuth } from '../src/main/auth';
import type { AuthState } from '../src/shared/auth';
import type { AuthStorage } from '../src/main/auth-storage';
const mock = vi.hoisted(() => ({ getSession: vi.fn(), getUser: vi.fn(), signInWithOtp: vi.fn(), verifyOtp: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(), signInWithOAuth: vi.fn(), exchangeCodeForSession: vi.fn(), onAuthStateChange: vi.fn(), stopAutoRefresh: vi.fn() }));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({auth:mock})}));
const callback=vi.hoisted(()=>({listen:vi.fn(),close:vi.fn()}));
vi.mock('../src/main/google-callback',()=>({GoogleCallback:class {listen=callback.listen;close=callback.close;}}));
const user={id:'11111111-1111-4111-8111-111111111111',email:'person@example.com',user_metadata:{first_name:'Priya',last_name:'Sharma'}};
const session={user,access_token:'never-render-access-token',refresh_token:'never-render-refresh-token'};
const switched=vi.fn(async (_id:string|null)=>{}); const changes=vi.fn((_state:AuthState)=>{});
function service(){return new DesktopAuth({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},{} as AuthStorage,switched,changes,async()=>{});}
beforeEach(()=>{ vi.clearAllMocks();mock.getSession.mockResolvedValue({data:{session:null},error:null}); mock.getUser.mockResolvedValue({data:{user},error:null});mock.onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe:vi.fn()}}});mock.signInWithOtp.mockResolvedValue({error:null});mock.verifyOtp.mockResolvedValue({data:{session},error:null});mock.signOut.mockResolvedValue({error:null});mock.signInWithOAuth.mockResolvedValue({data:{url:'https://fixture.supabase.co/auth/v1/authorize?provider=google'},error:null});mock.exchangeCodeForSession.mockResolvedValue({data:{session},error:null});callback.listen.mockResolvedValue('http://127.0.0.1:48123/auth/callback/nonce');switched.mockResolvedValue(undefined);});
it('verifies a restored session with Supabase before opening the account and never publishes tokens',async()=>{
  mock.getSession.mockResolvedValue({data:{session},error:null}); const auth=service(); await auth.initialize();
  expect(mock.getUser).toHaveBeenCalledOnce();expect(switched).toHaveBeenCalledWith(user.id);expect(auth.snapshot().user?.firstName).toBe('Priya');expect(JSON.stringify(changes.mock.calls)).not.toContain('never-render');await auth.dispose();
});
it('rejects an invalid restored session instead of opening its local account',async()=>{
  mock.getSession.mockResolvedValue({data:{session},error:null});mock.getUser.mockResolvedValue({data:{user:null},error:{message:'expired'}});const auth=service();await auth.initialize();expect(auth.snapshot().phase).toBe('signed-out');expect(switched).not.toHaveBeenCalledWith(user.id);await expect(auth.accessToken()).rejects.toThrow('Sign in');await auth.dispose();
});
it('sends one bounded email code, validates its destination and opens the verified account',async()=>{
  const auth=service();await auth.initialize();await expect(auth.sendCode('invalid')).rejects.toThrow('valid email');await auth.sendCode('person@example.com');await expect(auth.sendCode('person@example.com')).rejects.toThrow('one minute');await expect(auth.verifyCode('different@example.com','123456')).rejects.toThrow('latest');expect(mock.verifyOtp).not.toHaveBeenCalled();await auth.verifyCode('person@example.com','123456');expect(switched).toHaveBeenLastCalledWith(user.id);expect(auth.snapshot().phase).toBe('signed-in');await auth.signOut();expect(switched).toHaveBeenLastCalledWith(null);expect(auth.snapshot().user).toBeNull();await auth.dispose();
});
it('does not expose signed-in state when the local workspace cannot be opened',async()=>{
  const auth=service();await auth.initialize();await auth.sendCode('person@example.com');switched.mockRejectedValueOnce(new Error('disk unavailable'));await expect(auth.verifyCode('person@example.com','123456')).rejects.toThrow('disk unavailable');expect(auth.snapshot().phase).not.toBe('signed-in');await auth.dispose();
});

it('opens only the configured Google authorization endpoint and exchanges its callback before signing in',async()=>{
  const open=vi.fn(async (_url:string)=>{});const auth=new DesktopAuth({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},{} as AuthStorage,switched,changes,open);
  await auth.initialize();await auth.signInGoogle();expect(auth.snapshot().googlePending).toBe(true);expect(open).toHaveBeenCalledWith('https://fixture.supabase.co/auth/v1/authorize?provider=google');expect(mock.signInWithOAuth).toHaveBeenCalledWith({provider:'google',options:{redirectTo:'http://127.0.0.1:48123/auth/callback/nonce',skipBrowserRedirect:true,scopes:'openid email profile'}});
  await callback.listen.mock.calls[0][0]('callback-code');expect(mock.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('callback-code');expect(auth.snapshot().phase).toBe('signed-in');await auth.dispose();
});
it('never opens a provider URL outside the configured Supabase project',async()=>{
  const open=vi.fn(async (_url:string)=>{});const auth=new DesktopAuth({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},{} as AuthStorage,switched,changes,open);await auth.initialize();mock.signInWithOAuth.mockResolvedValueOnce({data:{url:'https://untrusted.example/'},error:null});await expect(auth.signInGoogle()).rejects.toThrow('Could not open');expect(open).not.toHaveBeenCalled();expect(callback.close).toHaveBeenCalled();await auth.dispose();
});

it('updates only bounded profile fields and keeps tokens out of profile results',async()=>{
  mock.getSession.mockResolvedValue({data:{session},error:null});mock.updateUser.mockResolvedValue({data:{user:{...user,user_metadata:{first_name:'Riya',last_name:'Sharma'}}},error:null});const auth=service();await auth.initialize();await expect(auth.updateProfile('A'.repeat(81),'Name')).rejects.toThrow('80 characters');expect(mock.updateUser).not.toHaveBeenCalled();await auth.updateProfile(' Riya ',' Sharma ');expect(mock.updateUser).toHaveBeenCalledExactlyOnceWith({data:{first_name:'Riya',last_name:'Sharma'}});expect(auth.snapshot().user?.firstName).toBe('Riya');expect(JSON.stringify(auth.snapshot())).not.toContain('never-render');await auth.dispose();
});

it('requires a nonblank first name and blocks cloud access until profile setup is saved',async()=>{
  const incomplete={...session,user:{...user,user_metadata:{}}};mock.getSession.mockResolvedValue({data:{session:incomplete},error:null});mock.getUser.mockResolvedValue({data:{user:incomplete.user},error:null});const auth=service();await auth.initialize();
  await expect(auth.accessToken()).rejects.toThrow('Enter your name');await expect(auth.updateProfile('   ','Name')).rejects.toThrow('Enter your first name');
  expect(mock.updateUser).not.toHaveBeenCalled();await auth.dispose();
});

it('rejects non-six-digit email codes before calling Supabase',async()=>{
  const auth=service();await auth.initialize();await auth.sendCode('person@example.com');
  for(const code of ['12345','1234567','12345678','abcdef','123 456'])await expect(auth.verifyCode('person@example.com',code)).rejects.toThrow('6-digit');
  expect(mock.verifyOtp).not.toHaveBeenCalled();await auth.verifyCode('person@example.com','012345');expect(mock.verifyOtp).toHaveBeenCalledExactlyOnceWith({email:'person@example.com',token:'012345',type:'email'});await auth.dispose();
});
