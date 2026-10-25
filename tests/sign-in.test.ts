// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';import { createRoot, type Root } from 'react-dom/client';
import { SignIn } from '../src/renderer/SignIn';import { INITIAL_AUTH } from '../src/shared/auth';
let host:HTMLDivElement;let root:Root;const send=vi.fn();const verify=vi.fn();const google=vi.fn();
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);send.mockReset().mockResolvedValue(undefined);verify.mockReset().mockResolvedValue(undefined);google.mockReset().mockResolvedValue(undefined);window.sargosh={sendEmailCode:send,verifyEmailCode:verify,signInGoogle:google} as unknown as NonNullable<typeof window.sargosh>;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete window.sargosh;vi.unstubAllGlobals();});
async function render(){await act(async()=>root.render(createElement(SignIn,{state:{...INITIAL_AUTH,configured:true,phase:'signed-out'}})));}
async function input(selector:string,value:string){const field=host.querySelector(selector) as HTMLInputElement;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;await act(async()=>{setter.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
it('requests email OTP and then verifies a code inside the app',async()=>{await render();await input('#sign-in-email','person@example.com');await submit();expect(send).toHaveBeenCalledExactlyOnceWith('person@example.com');expect(host.textContent).toContain('Verify and sign in');await input('#sign-in-code','123456');await submit();expect(verify).toHaveBeenCalledExactlyOnceWith('person@example.com','123456');});
it('keeps failed delivery visible and allows another attempt',async()=>{await render();send.mockRejectedValueOnce(new Error('Email delivery is not configured.'));await input('#sign-in-email','person@example.com');await submit();expect(host.textContent).toContain('Email delivery is not configured.');expect(host.querySelector('#sign-in-code')).toBeNull();});
it('starts Google only on an explicit click',async()=>{await render();expect(google).not.toHaveBeenCalled();await act(async()=>(host.querySelector('.sign-in-google') as HTMLElement).click());expect(google).toHaveBeenCalledOnce();});

it('accepts only six digits and does not silently shorten an eight-digit paste',async()=>{
  await render();await input('#sign-in-email','person@example.com');await submit();const field=host.querySelector('#sign-in-code') as HTMLInputElement;expect(field.maxLength).toBe(6);expect(field.pattern).toBe('[0-9]{6}');
  await input('#sign-in-code','12345');await submit();expect(verify).not.toHaveBeenCalled();
  const clipboardData=new DataTransfer();clipboardData.setData('text','12345678');await act(async()=>field.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData})));expect(field.value).toBe('12345');expect(host.textContent).toContain('6-digit');expect(verify).not.toHaveBeenCalled();
  clipboardData.setData('text','012 345');await act(async()=>field.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData})));expect(field.value).toBe('012345');await submit();expect(verify).toHaveBeenCalledExactlyOnceWith('person@example.com','012345');
});

it('switches to a dedicated OTP screen and returns without keeping the old OTP',async()=>{
  await render();await input('#sign-in-email','person@example.com');await submit();
  expect(host.querySelector('h1')?.textContent).toBe('Verify your OTP');
  expect(host.querySelector('#sign-in-email')).toBeNull();expect(host.querySelector('.sign-in-google')).toBeNull();
  expect(host.querySelector('.otp-destination')?.textContent).toBe('person@example.com');
  expect(document.activeElement).toBe(host.querySelector('#sign-in-code'));
  await input('#sign-in-code','012345');
  const back=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Back to sign in')!;
  await act(async()=>back.click());
  expect(host.querySelector('h1')?.textContent).toBe('Welcome to Sargosh');
  expect(host.querySelector('#sign-in-code')).toBeNull();expect(host.querySelector('.sign-in-google')).not.toBeNull();
  expect((host.querySelector('#sign-in-email') as HTMLInputElement).value).toBe('person@example.com');
  await submit();expect((host.querySelector('#sign-in-code') as HTMLInputElement).value).toBe('');expect(verify).not.toHaveBeenCalled();
});
