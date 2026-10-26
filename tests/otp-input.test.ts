// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { OtpInput } from '../src/renderer/OtpInput';
let host: HTMLDivElement, root: Root; const invalid = vi.fn();
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);invalid.mockClear();host=document.createElement('div');document.body.append(host);root=createRoot(host);
 function Example(){const[value,setValue]=useState('');const inputRef=useRef<HTMLInputElement>(null);return createElement('div',null,createElement('label',{htmlFor:'otp'},'OTP'),createElement(OtpInput,{id:'otp',value,inputRef,onChange:setValue,onInvalid:invalid}),createElement('p',{id:'otp-help'},'Enter six digits'));}
 await act(async()=>root.render(createElement(Example)));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const field=()=>host.querySelector('input')!;
const digits=()=>[...host.querySelectorAll('.otp-digit')].map(node=>node.textContent).join('');
async function type(value:string,start=value.length){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field(),value);field().setSelectionRange(start,start);field().dispatchEvent(new Event('input',{bubbles:true}));});}
async function paste(value:string){const clipboardData=new DataTransfer();clipboardData.setData('text',value);await act(async()=>field().dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData})));}
it('shows six digit boxes with one accessible, autofill-enabled keyboard input',()=>{
 expect(host.querySelectorAll('.otp-digit')).toHaveLength(6);expect(host.querySelector('.otp-digits')?.getAttribute('aria-hidden')).toBe('true');
 expect(field().labels?.[0].textContent).toBe('OTP');expect(field().autocomplete).toBe('one-time-code');expect(field().inputMode).toBe('numeric');expect(field().getAttribute('aria-describedby')).toBe('otp-help');expect(document.activeElement).toBe(field());
});
it('advances the active digit and preserves leading zeroes',async()=>{
 await type('0');expect(host.querySelector('.otp-digit[data-active=true]')).toBe(host.querySelectorAll('.otp-digit')[1]);
 await type('012345');expect(digits()).toBe('012345');expect(field().selectionStart).toBe(6);
});
it('pastes a full OTP including spaces into all six boxes and moves to the end',async()=>{
 await paste('012 345');expect(field().value).toBe('012345');expect(digits()).toBe('012345');expect(field().selectionStart).toBe(6);expect(invalid).not.toHaveBeenCalled();
});
it('rejects incomplete, oversized, or nonnumeric pasted values without damaging existing digits',async()=>{
 await type('1234');for(const value of ['123','12345678','12a456']){await paste(value);expect(field().value).toBe('1234');}expect(invalid).toHaveBeenCalledTimes(3);
});
it('selects a clicked filled box and updates its replacement without losing the rest of the OTP',async()=>{
 await paste('123456');vi.spyOn(field(),'getBoundingClientRect').mockReturnValue({left:0,width:360} as DOMRect);
 await act(async()=>field().dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,clientX:150})));
 expect(field().selectionStart).toBe(2);expect(field().selectionEnd).toBe(3);
 await type('129456',3);expect(digits()).toBe('129456');expect(field().selectionStart).toBe(3);
});
it('keeps Backspace, Delete, arrows, select-all, copy, and cut available to the native input',async()=>{
 await type('123456');
 for(const [key,ctrlKey] of [['Backspace',false],['Delete',false],['ArrowLeft',false],['ArrowRight',false],['Home',false],['End',false],['a',true],['c',true],['x',true]] as const){const event=new KeyboardEvent('keydown',{key,ctrlKey,bubbles:true,cancelable:true});await act(async()=>field().dispatchEvent(event));expect(event.defaultPrevented).toBe(false);}
 await type('12345');expect(digits()).toBe('12345');await type('');expect(digits()).toBe('');expect(field().selectionStart).toBe(0);
});
it('filters typed non-digits and accepts an autofilled six-digit value',async()=>{
 await type('12a3');expect(digits()).toBe('123');await type('001234');expect(digits()).toBe('001234');
});
