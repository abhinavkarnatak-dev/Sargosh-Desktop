// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement, useRef } from 'react'; import { createRoot } from 'react-dom/client';
import { useModalDialog } from '../src/renderer/modal';
afterEach(() => vi.unstubAllGlobals());
it('keeps the background locked when one of two dialogs closes first', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const scroll = document.createElement('div'); scroll.className = 'main-scroll'; scroll.style.overflow = 'auto'; document.body.append(scroll);
  function Modal({ name }: { name: string }) { const ref = useRef<HTMLDialogElement>(null); useModalDialog(ref); return createElement('dialog', { ref, 'aria-label': name }); }
  document.documentElement.style.setProperty('overflow', 'auto', 'important');
  try {
    await act(async () => root.render([createElement(Modal, { key: 'first', name: 'First' }), createElement(Modal, { key: 'second', name: 'Second' })]));
    await act(async () => root.render([createElement(Modal, { key: 'second', name: 'Second' })]));
    expect(document.documentElement.style.overflow).toBe('hidden'); expect(document.body.style.overflow).toBe('hidden'); expect(scroll.style.overflow).toBe('hidden');
    await act(async () => root.unmount());
    expect(document.documentElement.style.overflow).toBe('auto'); expect(scroll.style.overflow).toBe('auto'); expect(document.documentElement.style.getPropertyPriority('overflow')).toBe('important');
  } finally { scroll.remove(); host.remove(); document.documentElement.style.removeProperty('overflow'); }
});
