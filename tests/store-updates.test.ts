import { afterEach, expect, it, vi } from 'vitest';
import { StoreUpdates } from '../src/main/store-updates';
import type { StoreReply } from '../src/shared/store-update';
const aumid='AbhinavKarnatak.Sargosh_123456789abcd!Sargosh';
const available={ok:true,available:true,aumid};
const ready={...available,downloaded:true};
function setup(enabled=true){
  let busy=false;const bridge={call:vi.fn(async(_action:string,_progress?: (value:number)=>void):Promise<StoreReply>=>available),stop:vi.fn()};
  const changed=vi.fn(),prepare=vi.fn(async()=>{}),restore=vi.fn(async()=>{}),restart=vi.fn();
  const manager=new StoreUpdates(enabled,bridge,()=>busy,changed,prepare,restore,restart);
  return {manager,bridge,changed,prepare,restore,restart,setBusy:(value:boolean)=>{busy=value;manager.activityChanged();}};
}
afterEach(()=>{vi.useRealTimers();});
it('confirms a successful manual check with no updates and allows checking again',async()=>{
  const s=setup();s.bridge.call.mockResolvedValue({ok:true,available:false,downloaded:false,aumid});
  expect(await s.manager.action('check')).toMatchObject({phase:'idle',prompt:false,message:'Sargosh is already up to date.'});
  expect(await s.manager.action('check')).toMatchObject({phase:'idle',prompt:false,message:'Sargosh is already up to date.'});
  expect(s.bridge.call).toHaveBeenCalledTimes(2);expect(s.restart).not.toHaveBeenCalled();s.manager.dispose();
});
it('keeps successful background checks quiet when there is no update',async()=>{
  vi.useFakeTimers();const s=setup();s.bridge.call.mockResolvedValue({ok:true,available:false,downloaded:false,aumid});s.manager.start();
  await vi.advanceTimersByTimeAsync(30000);expect(s.manager.snapshot()).toMatchObject({phase:'idle',prompt:false,message:''});
  await vi.advanceTimersByTimeAsync(15*60*1000);expect(s.manager.snapshot()).toMatchObject({phase:'idle',message:''});
  expect(s.bridge.call).toHaveBeenCalledTimes(2);s.manager.dispose();
});
it('does not misreport a failed check as up to date or an installation failure',async()=>{
  const s=setup();s.bridge.call.mockResolvedValueOnce({ok:false,code:'STORE_ERROR'});
  expect(await s.manager.action('check')).toMatchObject({phase:'error',prompt:false,message:'Could not check for updates. Please try again.'});
  s.bridge.call.mockResolvedValueOnce({ok:true,available:false,downloaded:false,aumid});
  expect(await s.manager.action('check')).toMatchObject({phase:'idle',message:'Sargosh is already up to date.'});s.manager.dispose();
});
it('does not touch Windows Store or schedule checks in development and direct installs',async()=>{
  vi.useFakeTimers();const s=setup(false);s.manager.start();await vi.advanceTimersByTimeAsync(60*60*1000);
  expect((await s.manager.action('download')).phase).toBe('unsupported');expect(s.bridge.call).not.toHaveBeenCalled();s.manager.dispose();
});
it('offers an update once, keeps it available after Later, and does not repeat the popup on polling',async()=>{
  const s=setup();expect(await s.manager.action('check')).toMatchObject({phase:'available',prompt:true});
  expect(await s.manager.action('later')).toMatchObject({phase:'available',prompt:false});
  expect(await s.manager.action('check')).toMatchObject({phase:'available',prompt:false});s.manager.dispose();
});
it('does not announce download readiness until Windows confirms the completed download',async()=>{
  const s=setup();await s.manager.action('check');let finish!:(reply:StoreReply)=>void;
  s.bridge.call.mockImplementationOnce(async(_action,progress)=>{progress?.(.7);progress?.(.2);progress?.(1);return new Promise(resolve=>{finish=resolve;});});
  const download=s.manager.action('download');expect(s.manager.snapshot()).toMatchObject({phase:'downloading',progress:1,prompt:false});
  await s.manager.action('download');expect(s.bridge.call).toHaveBeenCalledTimes(2);
  finish(ready);expect(await download).toMatchObject({phase:'ready',progress:1});s.manager.dispose();
});
it('keeps the update in the sidebar when Windows download consent is cancelled',async()=>{
  const s=setup();await s.manager.action('check');s.bridge.call.mockResolvedValueOnce({ok:false,code:'CANCELLED'});
  expect(await s.manager.action('download')).toMatchObject({phase:'available',prompt:false});expect(s.restart).not.toHaveBeenCalled();s.manager.dispose();
});
it('never installs while recording, transcribing, inserting or other protected work is active',async()=>{
  const s=setup();await s.manager.action('check');s.bridge.call.mockResolvedValueOnce(ready);await s.manager.action('download');s.setBusy(true);
  expect(await s.manager.action('install')).toMatchObject({phase:'ready',blocked:true});
  expect(s.prepare).not.toHaveBeenCalled();expect(s.bridge.call).toHaveBeenCalledTimes(2);s.manager.dispose();
});
it('flushes state before installation and rechecks activity after that asynchronous work',async()=>{
  const s=setup();await s.manager.action('check');s.bridge.call.mockResolvedValueOnce(ready);await s.manager.action('download');
  s.prepare.mockImplementationOnce(async()=>{s.setBusy(true);});
  expect(await s.manager.action('install')).toMatchObject({phase:'ready',blocked:true});expect(s.bridge.call).toHaveBeenCalledTimes(2);expect(s.restore).toHaveBeenCalledOnce();s.manager.dispose();
});
it('requests the Store installation only after flushing, then relaunches by verified package identity',async()=>{
  const s=setup();await s.manager.action('check');s.bridge.call.mockResolvedValueOnce(ready);await s.manager.action('download');
  const order:string[]=[];s.prepare.mockImplementationOnce(async()=>{order.push('flush');});
  s.bridge.call.mockImplementationOnce(async(action)=>{order.push(action);return {...ready,state:'installed'};});
  await s.manager.action('install');expect(order).toEqual(['flush','install']);expect(s.restart).toHaveBeenCalledWith(aumid);expect(s.restore).not.toHaveBeenCalled();s.manager.dispose();
});
it('restores normal recording availability when installation is declined',async()=>{
  const s=setup();await s.manager.action('check');s.bridge.call.mockResolvedValueOnce(ready);await s.manager.action('download');s.bridge.call.mockResolvedValueOnce({ok:false,code:'CANCELLED'});
  expect(await s.manager.action('install')).toMatchObject({phase:'ready'});expect(s.restore).toHaveBeenCalledOnce();expect(s.restart).not.toHaveBeenCalled();s.manager.dispose();
});
it('returns to downloading if a restarted native bridge no longer owns the downloaded package list',async()=>{
  const s=setup();await s.manager.action('check');s.bridge.call.mockResolvedValueOnce(ready);await s.manager.action('download');s.bridge.call.mockResolvedValueOnce({ok:false,code:'NOT_DOWNLOADED'});
  expect(await s.manager.action('install')).toMatchObject({phase:'available',progress:0});expect(s.restart).not.toHaveBeenCalled();s.manager.dispose();
});
it('does not trust a download response containing an arbitrary restart destination',async()=>{
  const s=setup();s.bridge.call.mockResolvedValueOnce({...ready,aumid:'malicious.exe'});
  expect(await s.manager.action('check')).toMatchObject({phase:'error'});await s.manager.action('install');expect(s.restart).not.toHaveBeenCalled();expect(s.prepare).not.toHaveBeenCalled();s.manager.dispose();
});
it('handles Store exceptions without announcing an update or interrupting other work',async()=>{
  const s=setup();s.bridge.call.mockRejectedValueOnce(new Error('private native detail'));
  expect(await s.manager.action('check')).toMatchObject({phase:'error',prompt:false});expect(s.manager.snapshot().message).not.toContain('private');expect(s.prepare).not.toHaveBeenCalled();s.manager.dispose();
});
it('checks after startup, polls without touching an active recording, and stops after disposal',async()=>{
  vi.useFakeTimers();const s=setup();s.manager.start();s.manager.start();await vi.advanceTimersByTimeAsync(30000);expect(s.bridge.call).toHaveBeenCalledOnce();
  s.setBusy(true);await vi.advanceTimersByTimeAsync(15*60*1000);expect(s.bridge.call).toHaveBeenCalledOnce();s.setBusy(false);
  await vi.advanceTimersByTimeAsync(15*60*1000);expect(s.bridge.call).toHaveBeenCalledTimes(2);s.manager.dispose();await vi.advanceTimersByTimeAsync(15*60*1000);expect(s.bridge.call).toHaveBeenCalledTimes(2);
});
