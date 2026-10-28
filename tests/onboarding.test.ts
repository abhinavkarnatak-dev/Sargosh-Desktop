// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Onboarding } from '../src/renderer/Onboarding';
import { DEFAULT_PREFERENCES, type Preferences } from '../src/shared/types';
const fake=vi.hoisted(()=>({activate:vi.fn(async()=>{}),mode:vi.fn(),cancel:vi.fn(),clear:vi.fn(),start:vi.fn(async()=>{}),complete:vi.fn(async()=>{}),clean:{phase:'idle',sessionId:null,result:null} as any}));
vi.mock('../src/renderer/activate-shortcuts',()=>({activateShortcuts:fake.activate}));
vi.mock('../src/renderer/MicrophoneTest',()=>({MicrophoneTest:()=>createElement('p',null,'Microphone test available')}));
vi.mock('../src/renderer/ShortcutEditor',()=>({ShortcutEditor:({onSave}:{onSave(value:string):Promise<void>})=>createElement('button',{onClick:()=>void onSave('Control+Alt+K')},'Choose custom shortcut')}));
vi.mock('../src/renderer/audio/runtime',()=>({setTutorialMode:fake.mode,cancelRecording:fake.cancel,recording:{clear:fake.clear},startRecording:fake.start,finishRecording:async()=>{},cloudBusy:()=>false,transcription:{configure:()=>{}},useRecording:()=>({phase:'idle',level:0}),useTranscription:()=>({phase:'completed',language:'en',sessionId:'practice'}),useCleanup:()=>fake.clean}));
it('walks through microphone, saved shortcut, and real-practice controls, persisting completion only at the end',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();fake.clean={phase:'idle',sessionId:null,result:null};
 window.sargosh={completeOnboarding:fake.complete} as unknown as NonNullable<typeof window.sargosh>;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 function Harness(){const[prefs,setPrefs]=useState<Preferences>(DEFAULT_PREFERENCES);return createElement(Onboarding,{preferences:prefs,onSave:async(update)=>{setPrefs(current=>({...current,...update}));}});}
 async function click(text:string){const button=Array.from(host.querySelectorAll('button')).find(value=>value.textContent===text)!;expect(button).toBeTruthy();await act(async()=>button.click());}
 try{
  await act(async()=>root.render(createElement(Harness)));expect(host.querySelector('dialog')!.open).toBe(true);expect(host.textContent).toContain('Microphone test available');expect(fake.complete).not.toHaveBeenCalled();
  const cancel=new Event('cancel',{cancelable:true});host.querySelector('dialog')!.dispatchEvent(cancel);expect(cancel.defaultPrevented).toBe(true);
  await click('Continue');await click('Choose custom shortcut');expect(fake.complete).not.toHaveBeenCalled();
  await click('Continue');expect(fake.activate).toHaveBeenCalledWith('Control+Alt+K');expect(host.textContent).toContain('Ctrl + Alt + K');
  await click('Start recording');expect(fake.start).toHaveBeenCalledOnce();
  fake.clean={phase:'completed',sessionId:'practice',result:{text:'Hi, I am trying Sargosh.'}};
  await act(async()=>root.render(createElement(Harness)));expect(host.querySelector('textarea')!.value).toBe('Hi, I am trying Sargosh.');
  vi.useFakeTimers();
  fake.complete.mockRejectedValueOnce(new Error('Setup could not be saved. Please try again.'));await click('Finish setup');
  expect(host.querySelector('dialog')!.dataset.closing).toBe('true');expect(fake.complete).not.toHaveBeenCalled();
  await act(async()=>vi.advanceTimersByTimeAsync(180));
  expect(host.textContent).toContain('Setup could not be saved');expect(host.querySelector('dialog')!.dataset.closing).toBe('false');
  await click('Finish setup');expect(fake.complete).toHaveBeenCalledTimes(1);
  await act(async()=>vi.advanceTimersByTimeAsync(180));expect(fake.complete).toHaveBeenCalledTimes(2);
 }finally{await act(async()=>root.unmount());host.remove();delete window.sargosh;vi.useRealTimers();vi.unstubAllGlobals();}
 expect(fake.mode).toHaveBeenLastCalledWith(false);expect(fake.clear).toHaveBeenCalled();
});
