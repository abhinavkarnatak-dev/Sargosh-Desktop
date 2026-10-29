// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../src/renderer/App';
import { EMPTY_SNAPSHOT } from '../src/shared/types';
import type { AuthState } from '../src/shared/auth';
vi.mock('../src/renderer/DictationGuide',()=>({DictationGuide:()=>createElement('div',null,'Recording workspace')}));
vi.mock('../src/renderer/Onboarding',()=>({Onboarding:()=>createElement('div',null,'First-time setup tutorial')}));
vi.mock('../src/renderer/HistoryList',()=>({HistoryList:()=>createElement('div',null,'Saved history')}));
vi.mock('../src/renderer/SettingsDialog',()=>({SettingsDialog:()=>null}));
vi.mock('../src/renderer/AllowanceWarning',()=>({AllowanceWarning:()=>null}));
// This suite exercises account gates, not native Web Animation cancellation.
vi.mock('../src/renderer/WaveHeading',()=>({WaveHeading:({children}:{children:ReactNode})=>createElement('h1',null,children)}));
vi.mock('../src/renderer/audio/runtime',()=>({setRecordingPreferences:()=>{}}));
let root:Root;let host:HTMLDivElement;let state:AuthState;const listeners=new Set<(state:AuthState)=>void>();
const save=vi.fn();const snapshot=vi.fn();const signOut=vi.fn();
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);listeners.clear();
  state={configured:true,phase:'signed-in',user:{id:'11111111-1111-4111-8111-111111111111',email:'person@example.com',firstName:'',lastName:''},googlePending:false,message:''};
  snapshot.mockReset().mockResolvedValue(EMPTY_SNAPSHOT);signOut.mockReset().mockResolvedValue(undefined);
  save.mockReset().mockImplementation(async(firstName:string,lastName:string)=>{state={...state,user:{...state.user!,firstName,lastName}};listeners.forEach(listener=>listener(state));});
  window.sargosh={authState:async()=>state,onAuthState:(listener:(state:AuthState)=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);},updateProfile:save,signOut,snapshot,onHistoryChanged:()=>()=>{},setWindowTheme:async()=>{}} as unknown as NonNullable<typeof window.sargosh>;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete window.sargosh;vi.unstubAllGlobals();});
async function render(){await act(async()=>root.render(createElement(App)));}
async function input(selector:string,value:string){const field=host.querySelector(selector) as HTMLInputElement;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;await act(async()=>{setter.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
it('keeps verified accounts without a name out of the workspace until the profile is saved',async()=>{
  await render();expect(host.textContent).toContain('What should we call you?');expect(snapshot).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Recording workspace');
  await input('#setup-first-name','  Priya  ');await input('#setup-last-name',' Sharma ');await submit();
  expect(save).toHaveBeenCalledExactlyOnceWith('Priya','Sharma');expect(host.textContent).toContain('Welcome back, Priya');expect(host.textContent).toContain('Recording workspace');expect(snapshot).toHaveBeenCalledOnce();
});
it('allows a single name and rejects whitespace-only first names',async()=>{
  await render();await input('#setup-first-name','   ');await submit();expect(save).not.toHaveBeenCalled();expect(host.textContent).toContain('Enter your first name.');
  await input('#setup-first-name','Priya');await submit();expect(save).toHaveBeenCalledExactlyOnceWith('Priya','');
});
it('stays on setup and shows the error when saving fails',async()=>{
  await render();save.mockRejectedValueOnce(new Error('Your profile could not be saved. Please try again.'));await input('#setup-first-name','Priya');await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be saved');expect(snapshot).not.toHaveBeenCalled();expect(host.querySelector('#setup-first-name')).not.toBeNull();
});
it('takes returning accounts with a saved name directly to the workspace',async()=>{
  state={...state,user:{...state.user!,firstName:'Priya'}};await render();expect(host.querySelector('#setup-first-name')).toBeNull();expect(host.textContent).toContain('Welcome back, Priya');expect(snapshot).toHaveBeenCalledOnce();
});
it('asks again after reopening if the account still has no saved name',async()=>{
  await render();await input('#setup-first-name','Unsaved name');await act(async()=>root.unmount());root=createRoot(host);await render();
  expect((host.querySelector('#setup-first-name') as HTMLInputElement).value).toBe('');expect(snapshot).not.toHaveBeenCalled();
});

it('shows new email accounts the tutorial only after saving their name',async()=>{
 state={...state,user:{...state.user!,onboardingRequired:true}};await render();expect(host.textContent).not.toContain('First-time setup tutorial');
 await input('#setup-first-name','Priya');await submit();expect(host.textContent).toContain('First-time setup tutorial');
});
it('shows new Google accounts with names the tutorial, and hides it after completion',async()=>{
 state={...state,user:{...state.user!,firstName:'Priya',onboardingRequired:true}};await render();expect(host.textContent).toContain('First-time setup tutorial');
 await act(async()=>{state={...state,user:{...state.user!,onboardingRequired:false}};listeners.forEach(listener=>listener(state));});
 expect(host.textContent).not.toContain('First-time setup tutorial');
});
