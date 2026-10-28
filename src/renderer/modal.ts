import { useEffect, useRef, useState, type RefObject } from 'react';
const locks = new Map<HTMLElement, { count: number; value: string; priority: string }>();
export function useModalDialog(ref: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const element = ref.current; if (!element) return;
    element.showModal();
    const nodes = [document.documentElement, document.body, ...document.querySelectorAll<HTMLElement>('.main-scroll')];
    for (const node of nodes) {
      const current = locks.get(node);
      if (current) current.count++;
      else { locks.set(node, { count: 1, value: node.style.getPropertyValue('overflow'), priority: node.style.getPropertyPriority('overflow') }); node.style.setProperty('overflow', 'hidden', 'important'); }
    }
    return () => {
      element.close();
      for (const node of nodes) {
        const current = locks.get(node); if (!current || --current.count > 0) continue;
        if (current.value) node.style.setProperty('overflow', current.value, current.priority); else node.style.removeProperty('overflow');
        locks.delete(node);
      }
    };
  }, [ref]);
}

// Keep the modal in the top layer, with scroll/focus locks, until its exit finishes.
export function useModalDismiss(onClose: () => void) {
  const [closing,setClosing]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout> | null>(null);
  const finish=useRef(onClose);finish.current=onClose;
  useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);},[]);
  function dismiss(){
    if(timer.current!==null)return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){finish.current();return;}
    setClosing(true);
    timer.current=setTimeout(()=>{finish.current();},180);
  }
  return {closing,dismiss};
}
