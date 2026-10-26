import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
interface Option { value: string; label: string; icon?: ReactNode }
interface Props { id?: string; label?: string; value: string; options: readonly Option[]; disabled?: boolean; placeholder?: string; compact?: boolean; tooltip?: string; triggerIcon?: ReactNode; onChange(value: string): void }
export function ThemedSelect({ id, label, value, options, disabled = false, placeholder = 'Choose an option', compact = false, tooltip, triggerIcon, onChange }: Props) {
  const generatedId = useId(); const controlId = id ?? generatedId; const listId = controlId + '-options';
  const container = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false); const [active, setActive] = useState(0);
  const selected = options.findIndex(option => option.value === value);
  const optionId = (index: number) => listId + '-' + index;
  function show(index = Math.max(0, selected)) { if (!disabled && options.length) { setActive(index); setOpen(true); } }
  function choose(index: number) {
    const option = options[index]; if (!option || disabled) return;
    setOpen(false); trigger.current?.focus();
    if (option.value !== value) onChange(option.value);
  }
  useEffect(() => {
    if (disabled || !options.length) setOpen(false);
    setActive(index => Math.min(index, Math.max(0, options.length - 1)));
  }, [disabled, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !menu.current) return;
    const element = menu.current;
    // The native popover top layer escapes scrolling panels and stays above Settings.
    element.showPopover?.();
    const position = () => {
      const bounds = trigger.current?.getBoundingClientRect(); if (!bounds) return;
      const width = Math.min(Math.max(220, bounds.width), window.innerWidth - 16);
      const below = window.innerHeight - bounds.bottom - 12; const above = bounds.top - 12;
      const up = below < Math.min(240, options.length * 36 + 12) && above > below;
      const height = Math.max(40, Math.min(240, up ? above : below));
      Object.assign(element.style, { left: Math.max(8, Math.min(compact ? bounds.right - width : bounds.left, window.innerWidth - width - 8)) + 'px', width: width + 'px', maxHeight: height + 'px', top: up ? 'auto' : bounds.bottom + 6 + 'px', bottom: up ? window.innerHeight - bounds.top + 6 + 'px' : 'auto' });
    };
    position(); window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    return () => { element.hidePopover?.(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [open, options.length, compact]);
  useEffect(() => { if (open) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' }); }, [open, active]);
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === 'Escape') { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (open) choose(active); else show(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home') show(0); else if (event.key === 'End') show(options.length - 1);
      else if (!open) show(); else setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); const now = performance.now();
      let text = (now - search.current.time < 700 ? search.current.text : '') + event.key.toLocaleLowerCase();
      let index = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(text));
      if (index < 0) { text = event.key.toLocaleLowerCase(); index = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(text)); }
      search.current = { text, time: now }; if (index >= 0) show(index);
    }
  }
  return <div className={compact ? "themed-select compact" : "themed-select"} ref={container} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button type="button" ref={trigger} id={controlId} className="themed-select-trigger" data-tooltip={open ? '' : tooltip ?? (compact ? options[selected]?.label : '')} data-tooltip-placement="bottom" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open ? optionId(active) : undefined} disabled={disabled || !options.length} onClick={() => open ? setOpen(false) : show()} onKeyDown={keyDown}>
      {compact ? triggerIcon : <><span>{options[selected]?.label ?? placeholder}</span><ChevronDown size={14} aria-hidden="true" /></>}
    </button>
    {open && <div ref={menu} id={listId} role="listbox" aria-label={label ?? 'Options'} className="themed-select-menu" popover="manual">
      {options.map((option, index) => <div id={optionId(index)} key={option.value} role="option" aria-selected={option.value === value} className={'themed-select-option' + (index === active ? ' active' : '')} onMouseMove={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => choose(index)}>
        {option.icon}<span>{option.label}</span>{option.value === value && <Check size={14} aria-hidden="true" />}
      </div>)}
    </div>}
  </div>;
}
