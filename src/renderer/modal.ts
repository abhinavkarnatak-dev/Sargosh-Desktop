import { useEffect, type RefObject } from 'react';
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
