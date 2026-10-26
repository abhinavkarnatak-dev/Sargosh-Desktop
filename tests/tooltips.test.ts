// @vitest-environment happy-dom
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { act,createElement } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { Tooltips } from '../src/renderer/Tooltips';
let root:Root,host:HTMLDivElement,button:HTMLButtonElement;
beforeEach(async()=>{
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 button=document.createElement('button');button.dataset.tooltip='Dictation';button.dataset.tooltipPlacement='right';button.setAttribute('aria-describedby','existing-help');document.body.append(button);
 vi.spyOn(button,'getBoundingClientRect').mockReturnValue({left:20,right:60,top:20,bottom:60,width:40,height:40} as DOMRect);
 await act(async()=>root.render(createElement(Tooltips)));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();button.remove();vi.useRealTimers();vi.unstubAllGlobals();});
const tip=()=>document.querySelector<HTMLElement>('[role="tooltip"]');
async function send(event:Event){await act(async()=>button.dispatchEvent(event));}
async function advance(ms:number){await act(async()=>{vi.advanceTimersByTime(ms);});}
it('shows custom hover text after a short delay and fades away without losing existing descriptions',async()=>{
 await send(new PointerEvent('pointerover',{bubbles:true}));await advance(219);expect(tip()).toBeNull();await advance(1);
 expect(tip()?.textContent).toBe('Dictation');expect(button.hasAttribute('title')).toBe(false);expect(button.getAttribute('aria-describedby')).toContain(tip()!.id);
 expect(tip()?.style.left).toBe('70px');
 await send(new PointerEvent('pointerout',{bubbles:true,relatedTarget:null}));expect(tip()?.dataset.closing).toBe('true');expect(button.getAttribute('aria-describedby')).toBe('existing-help');await advance(120);expect(tip()).toBeNull();
});
it('supports keyboard focus and Escape without moving focus',async()=>{
 button.focus();await advance(220);expect(tip()).not.toBeNull();
 await send(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await advance(120);expect(tip()).toBeNull();expect(document.activeElement).toBe(button);
});
it('does not show tooltips for disabled controls or open menus',async()=>{
 button.disabled=true;await send(new PointerEvent('pointerover',{bubbles:true}));await advance(300);expect(tip()).toBeNull();
 button.disabled=false;button.setAttribute('aria-expanded','true');await send(new PointerEvent('pointerover',{bubbles:true}));await advance(300);expect(tip()).toBeNull();
});
it('renders inside the active dialog top layer and stays within viewport bounds',async()=>{
 const dialog=document.createElement('dialog');document.body.append(dialog);dialog.append(button);dialog.showModal();
 try{vi.spyOn(button,'getBoundingClientRect').mockReturnValue({left:window.innerWidth-5,right:window.innerWidth+5,top:1,bottom:41,width:10,height:40} as DOMRect);
 await send(new PointerEvent('pointerover',{bubbles:true}));await advance(220);expect(tip()?.parentElement).toBe(dialog);expect(Number.parseFloat(tip()!.style.left)).toBeLessThanOrEqual(window.innerWidth-8);expect(Number.parseFloat(tip()!.style.top)).toBeGreaterThanOrEqual(8);
 }finally{dialog.close();document.body.append(button);dialog.remove();}
});
it('clears a delayed hover when clicked before the tooltip opens',async()=>{
 await send(new PointerEvent('pointerover',{bubbles:true}));await send(new MouseEvent('click',{bubbles:true}));await advance(400);expect(tip()).toBeNull();
});

it('cancels a delayed tooltip if its menu opens before the delay ends',async()=>{
 await send(new PointerEvent('pointerover',{bubbles:true}));button.setAttribute('aria-expanded','true');await advance(300);expect(tip()).toBeNull();
});
