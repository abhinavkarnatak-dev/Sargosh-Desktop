import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
interface Tip { anchor: HTMLElement; text: string; closing: boolean }
export function Tooltips() {
  const id = useId();
  const [tip, setTip] = useState<Tip | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const bubble = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active: HTMLElement | null = null;
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    function describe(element: HTMLElement, add: boolean) {
      const tokens = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean).filter(token => token !== id);
      if (add) tokens.push(id);
      if (tokens.length) element.setAttribute('aria-describedby', tokens.join(' ')); else element.removeAttribute('aria-describedby');
    }
    function hide() {
      clearTimeout(showTimer); clearTimeout(hideTimer);
      if (active) describe(active, false);
      active = null;
      setTip(current => current ? { ...current, closing: true } : null);
      hideTimer = setTimeout(() => setTip(null), 120);
    }
    function find(target: EventTarget | null) {
      return target instanceof Element ? target.closest<HTMLElement>('[data-tooltip],button[aria-label]') : null;
    }
    function show(element: HTMLElement | null) {
      if (!element || element === active) return;
      hide();
      const text = element.getAttribute('data-tooltip') ?? element.getAttribute('aria-label');
      if (!text || element.matches(':disabled') || element.getAttribute('aria-expanded') === 'true') return;
      active = element;
      showTimer = setTimeout(() => {
        if (active !== element || !element.isConnected || element.matches(':disabled') || element.getAttribute('aria-expanded') === 'true') return;
        clearTimeout(hideTimer); describe(element, true);
        setTip({ anchor: element, text, closing: false });
      }, 220);
    }
    const over = (event: Event) => show(find(event.target));
    const out = (event: Event) => { const related = (event as PointerEvent).relatedTarget; if (active && (!(related instanceof Node) || !active.contains(related))) hide(); };
    const escape = (event: KeyboardEvent) => { if (['Escape', 'Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) hide(); };
    const removed = new MutationObserver(() => { if (active && !active.isConnected) hide(); });
    removed.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerover', over); document.addEventListener('pointerout', out);
    document.addEventListener('focusin', over); document.addEventListener('focusout', out);
    document.addEventListener('click', hide, true); document.addEventListener('pointerdown', hide, true); document.addEventListener('keydown', escape);
    document.addEventListener('scroll', hide, true); window.addEventListener('resize', hide); window.addEventListener('blur', hide);
    return () => {
      clearTimeout(showTimer); clearTimeout(hideTimer); if (active) describe(active, false); removed.disconnect();
      document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', over); document.removeEventListener('focusout', out);
      document.removeEventListener('click', hide, true); document.removeEventListener('pointerdown', hide, true); document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); window.removeEventListener('blur', hide);
    };
  }, [id]);
  useLayoutEffect(() => {
    if (!tip || tip.closing || !bubble.current) return;
    const dock = tip.anchor.closest<HTMLElement>('.overlay-stage')?.dataset.dock;
    const control = dock ? tip.anchor.closest('.overlay-pill') : null;
    const anchor = (control ?? tip.anchor).getBoundingClientRect(), bounds = bubble.current.getBoundingClientRect();
    const place = tip.anchor.dataset.tooltipPlacement ?? (dock === 'left' ? 'right' : dock === 'right' ? 'left' : 'top');
    let left = anchor.left + (anchor.width - bounds.width) / 2;
    let top = anchor.top - bounds.height - 9;
    if (place === 'right') { left = anchor.right + 10; top = anchor.top + (anchor.height - bounds.height) / 2; if (left + bounds.width > window.innerWidth - 8) left = anchor.left - bounds.width - 10; }
    else if (place === 'left') { left = anchor.left - bounds.width - 10; top = anchor.top + (anchor.height - bounds.height) / 2; if (left < 8) left = anchor.right + 10; }
    else if (place === 'bottom' || top < 8) { top = anchor.bottom + 9; if (top + bounds.height > window.innerHeight - 8) top = anchor.top - bounds.height - 9; }
    setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8)) });
  }, [tip]);
  return tip ? createPortal(<div ref={bubble} id={id} role="tooltip" data-tone={tip.anchor.dataset.tooltipTone} className="custom-tooltip" data-closing={tip.closing} style={position}>{tip.text}</div>, tip.anchor.closest('dialog[open]') ?? document.body) : null;
}
