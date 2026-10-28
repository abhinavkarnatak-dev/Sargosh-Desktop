// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';import { createRoot, type Root } from 'react-dom/client';
import { SignIn } from '../src/renderer/SignIn';import { INITIAL_AUTH } from '../src/shared/auth';
let host:HTMLDivElement;let root:Root;const send=vi.fn();const verify=vi.fn();const google=vi.fn();const cancelGoogle=vi.fn();
beforeEach(()=>{vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout','setInterval','clearInterval']});vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);send.mockReset().mockResolvedValue(undefined);verify.mockReset().mockResolvedValue(undefined);google.mockReset().mockResolvedValue(undefined);cancelGoogle.mockReset().mockResolvedValue(undefined);window.sargosh={sendEmailCode:send,verifyEmailCode:verify,signInGoogle:google,cancelGoogleSignIn:cancelGoogle} as unknown as NonNullable<typeof window.sargosh>;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete window.sargosh;vi.useRealTimers();vi.unstubAllGlobals();});
async function render(googlePending=false){await act(async()=>root.render(createElement(SignIn,{state:{...INITIAL_AUTH,configured:true,phase:'signed-out',googlePending}})));}
async function input(selector:string,value:string){const field=host.querySelector(selector) as HTMLInputElement;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;await act(async()=>{setter.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
it('requests email OTP and then verifies a code inside the app',async()=>{await render();await input('#sign-in-email','person@example.com');await submit();expect(send).toHaveBeenCalledExactlyOnceWith('person@example.com');expect(host.textContent).toContain('Verify and sign in');await input('#sign-in-code','123456');await submit();expect(verify).toHaveBeenCalledExactlyOnceWith('person@example.com','123456');});
it('keeps failed delivery visible and allows another attempt',async()=>{await render();send.mockRejectedValueOnce(new Error('Email delivery is not configured.'));await input('#sign-in-email','person@example.com');await submit();expect(host.textContent).toContain('Email delivery is not configured.');expect(host.querySelector('#sign-in-code')).toBeNull();});
it('starts Google only on an explicit click',async()=>{await render();expect(google).not.toHaveBeenCalled();await act(async()=>(host.querySelector('.sign-in-google') as HTMLElement).click());expect(google).toHaveBeenCalledOnce();expect(host.querySelector('.sign-in-google')?.getAttribute('data-tooltip')).toBe('');});

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

it('shows a wall-clock countdown and only allows resend after the full minute',async()=>{
 await render();await input('#sign-in-email','person@example.com');await submit();
 const resend=()=>Array.from(host.querySelectorAll('button')).find(x=>x.textContent==='Resend OTP');
 expect(host.querySelector('[role=timer]')?.textContent).toBe('Resend OTP in 1:00');expect(resend()).toBeUndefined();
 await act(async()=>vi.advanceTimersByTime(59000));expect(host.querySelector('[role=timer]')?.textContent).toBe('Resend OTP in 0:01');expect(send).toHaveBeenCalledOnce();
 await act(async()=>vi.advanceTimersByTime(1000));expect(host.querySelector('[role=timer]')).toBeNull();expect(resend()).toBeDefined();
 await input('#sign-in-code','012345');await act(async()=>resend()!.click());
 expect(send).toHaveBeenCalledTimes(2);expect(host.querySelector('[role=timer]')?.textContent).toBe('Resend OTP in 1:00');expect((host.querySelector('#sign-in-code') as HTMLInputElement).value).toBe('');
 expect(host.querySelector('.success-toast')?.textContent).toContain('A new OTP has been sent.');expect(host.querySelector('.success-toast button')).toBeNull();
});
it('shows the initial send as a two-second toast and keeps the animated logo on the OTP screen',async()=>{
 await render();expect(host.querySelector('.sign-in-animated-logo .sidebar-logo')).not.toBeNull();await input('#sign-in-email','person@example.com');await submit();
 expect(host.querySelector('.sign-in-animated-logo .sidebar-logo')).not.toBeNull();expect(host.querySelector('.sign-in-animated-logo')?.getAttribute('aria-label')).toBe('Sargosh');
 expect(host.querySelector('.success-toast')?.textContent).toContain('OTP sent. Check your email.');
 await act(async()=>vi.advanceTimersByTime(1999));expect(host.querySelector('.success-toast')).not.toBeNull();await act(async()=>vi.advanceTimersByTime(1));expect(host.querySelector('.success-toast')).toBeNull();
});
it('refreshes the resend deadline after returning from a background window',async()=>{
 await render();await input('#sign-in-email','person@example.com');await submit();
 vi.setSystemTime(Date.now()+61000);await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(host.querySelector('[role=timer]')).toBeNull();expect(Array.from(host.querySelectorAll('button')).some(x=>x.textContent==='Resend OTP')).toBe(true);
});
it('does not announce a successful resend when sending fails',async()=>{
 await render();await input('#sign-in-email','person@example.com');await submit();await act(async()=>vi.advanceTimersByTime(60000));
 send.mockRejectedValueOnce(new Error('Could not send the OTP.'));
 const button=Array.from(host.querySelectorAll('button')).find(x=>x.textContent==='Resend OTP')!;await act(async()=>button.click());
 expect(host.querySelector('.success-toast')).toBeNull();expect(host.querySelector('.sign-in-message')?.textContent).toBe('Could not send the OTP.');expect(host.querySelector('[role=timer]')?.textContent).toBe('Resend OTP in 1:00');
});

it('shows the OTP cooldown message as a brief informational toast instead of inline text',async()=>{
 send.mockRejectedValueOnce(new Error('Wait one minute before requesting another OTP.'));
 await render();await input('#sign-in-email','person@example.com');await submit();
 expect(host.querySelector('.toast')?.textContent).toBe('Wait one minute before requesting another OTP.');expect(host.querySelector('.sign-in-message')).toBeNull();expect(host.querySelector('.toast .lucide-info')).not.toBeNull();expect(host.querySelector('.toast button')).toBeNull();
 await act(async()=>vi.advanceTimersByTime(2000));expect(host.querySelector('.toast')).toBeNull();
});

it('keeps the cancel action inside the Google area and only enables it while waiting',async()=>{
 await render();const area=host.querySelector('.sign-in-google-area')!;
 const cancel=area.querySelector('.sign-in-google-cancel') as HTMLButtonElement;
 const divider=host.querySelector('.sign-in-divider');const email=host.querySelector('#sign-in-email');
 expect(cancel.disabled).toBe(true);expect(cancel.tabIndex).toBe(-1);expect(cancel.getAttribute('aria-hidden')).toBe('true');
 await render(true);
 expect(host.querySelector('.sign-in-google-area')).toBe(area);expect(host.querySelector('.sign-in-divider')).toBe(divider);expect(host.querySelector('#sign-in-email')).toBe(email);
 expect(area.getAttribute('data-pending')).toBe('true');expect(area.querySelector('button button')).toBeNull();
 expect(cancel.disabled).toBe(false);expect(cancel.tabIndex).toBe(0);expect(cancel.getAttribute('data-tooltip')).toBe('Cancel sign-in');
 expect((area.querySelector('.sign-in-google') as HTMLButtonElement).disabled).toBe(true);expect((email as HTMLInputElement).disabled).toBe(true);
 await act(async()=>{cancel.click();cancel.click();});expect(cancelGoogle).toHaveBeenCalledOnce();expect(google).not.toHaveBeenCalled();
 await render(false);expect(cancel.disabled).toBe(true);expect((email as HTMLInputElement).disabled).toBe(false);
});
it('keeps Google cancellation failures visible and retryable',async()=>{
 await render(true);cancelGoogle.mockRejectedValueOnce(new Error('Google sign-in is finishing. Please wait a moment.'));
 const cancel=host.querySelector('.sign-in-google-cancel') as HTMLButtonElement;
 await act(async()=>cancel.click());expect(host.querySelector('.sign-in-message')?.textContent).toContain('Google sign-in is finishing.');expect(cancel.disabled).toBe(false);
});
