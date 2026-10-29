import {expect,it,vi} from 'vitest';
import {AccountUsageStore} from '../src/renderer/account-usage';
const usage=(used=0)=>({enabled:true,dailyLimitSeconds:600,monthlyLimitSeconds:6000,dailyUsedSeconds:used,monthlyUsedSeconds:used,dailyResetAt:'2026-10-30T00:00:00Z',monthlyResetAt:'2026-11-01T00:00:00Z'});
it('shares in-flight requests and performs one queued refresh after dictation',async()=>{
 let resolve!:(value:ReturnType<typeof usage>)=>void;
 const fetch=vi.fn().mockImplementationOnce(()=>new Promise(done=>{resolve=done;})).mockResolvedValue(usage(100));
 const store=new AccountUsageStore(fetch);const first=store.refresh();expect(store.refresh()).toBe(first);
 expect(store.refresh(true)).toBe(first);expect(store.refresh(true)).toBe(first);expect(fetch).toHaveBeenCalledOnce();
 resolve(usage(10));await first;expect(fetch).toHaveBeenCalledTimes(2);expect(store.getState()).toMatchObject({usage:usage(100),loading:false,error:''});
});
it('discards an old account response even when it arrives after the new account response',async()=>{
 let resolve!:(value:ReturnType<typeof usage>)=>void;
 const fetch=vi.fn().mockImplementationOnce(()=>new Promise(done=>{resolve=done;})).mockResolvedValue(usage(5));
 const store=new AccountUsageStore(fetch);store.reset('old');const old=store.refresh();store.reset('new');await store.refresh();
 resolve(usage(600));await old;expect(store.getState()).toMatchObject({accountId:'new',usage:usage(5),loading:false});
});
it('preserves the last allowance on failure and allows a successful retry',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(usage(50)).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(usage(60));
 const store=new AccountUsageStore(fetch);await store.refresh();await store.refresh();
 expect(store.getState()).toMatchObject({usage:usage(50),loading:false,error:'Could not load your allowance. Please try again.'});
 await store.refresh();expect(store.getState()).toMatchObject({usage:usage(60),error:''});
});
