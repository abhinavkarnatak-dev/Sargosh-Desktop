import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:mock.spawn}));
import { NativeStoreBridge } from '../src/main/store-bridge';
function child(){
  const proc=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});
  let request:{id:string;action:string;hwnd:string};
  proc.stdin.on('data',raw=>{request=JSON.parse(raw.toString());});mock.spawn.mockReturnValueOnce(proc);
  return {proc,request:()=>request!,reply:(value:object)=>proc.stdout.write(JSON.stringify({id:request!.id,...value})+'\n')};
}
afterEach(()=>{vi.clearAllMocks();vi.useRealTimers();});
it('uses a fixed native executable over stdio and only accepts the matching operation response',async()=>{
  const c=child();const bridge=new NativeStoreBridge('C:/fixed/sargosh-store-updater.exe',()=> '1234');
  const result=bridge.call('check');
  expect(mock.spawn).toHaveBeenCalledWith('C:/fixed/sargosh-store-updater.exe',[],{stdio:'pipe',windowsHide:true});
  expect(c.request()).toMatchObject({action:'check',hwnd:'1234'});
  c.proc.stdout.write('{"id":"unrelated","ok":true,"downloaded":true}\n');
  c.reply({ok:true,available:true,downloaded:false,aumid:'AbhinavKarnatak.Sargosh_123456789abcd!Sargosh',private:'never forwarded'});
  expect(await result).toMatchObject({ok:true,available:true,downloaded:false,aumid:'AbhinavKarnatak.Sargosh_123456789abcd!Sargosh'});
  expect(await result).not.toHaveProperty('private');bridge.stop();
});
it('rejects overlapping requests and only reports progress for the active operation',async()=>{
  const c=child();const bridge=new NativeStoreBridge('fixture.exe',()=> '1234'),progress=vi.fn();
  const pending=bridge.call('download',progress);await expect(bridge.call('check')).rejects.toThrow('in progress');
  c.reply({type:'progress',progress:.5});expect(progress).toHaveBeenCalledWith(.5);c.reply({ok:false,code:'CANCELLED'});
  expect(await pending).toMatchObject({ok:false,code:'CANCELLED'});bridge.stop();
});
it('requires another download after the native process is lost, rather than claiming it is still ready',async()=>{
  const c=child();const bridge=new NativeStoreBridge('fixture.exe',()=> '1234');const pending=bridge.call('check');
  const rejected=expect(pending).rejects.toThrow('stopped');c.proc.emit('exit',1);await rejected;
  expect(await bridge.call('install')).toEqual({ok:false,code:'NOT_DOWNLOADED'});expect(mock.spawn).toHaveBeenCalledOnce();bridge.stop();
});
it('bounds checks and rejects stalled or malformed native replies',async()=>{
  vi.useFakeTimers();const c=child();const bridge=new NativeStoreBridge('fixture.exe',()=> '1234');const pending=bridge.call('check');
  const rejected=expect(pending).rejects.toThrow('stopped');await vi.advanceTimersByTimeAsync(45000);await rejected;expect(c.proc.kill).toHaveBeenCalledOnce();
  const next=child();const retry=bridge.call('check');const malformed=expect(retry).rejects.toThrow('stopped');next.proc.stdout.write('not-json\n');await malformed;bridge.stop();
});
it('does not launch against an invalid window handle or forward an arbitrary restart target',async()=>{
  const invalid=new NativeStoreBridge('fixture.exe',()=> 'not-a-handle');await expect(invalid.call('check')).rejects.toThrow('stopped');expect(mock.spawn).not.toHaveBeenCalled();
  const c=child();const bridge=new NativeStoreBridge('fixture.exe',()=> '1234');const result=bridge.call('check');c.reply({ok:true,available:true,aumid:'other.exe'});
  expect(await result).not.toHaveProperty('aumid', 'other.exe');bridge.stop();
});
