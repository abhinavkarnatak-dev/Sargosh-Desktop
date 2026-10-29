// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OverlayLanguage } from '../src/renderer/OverlayLanguage';
import { readSpeechLanguage, saveSpeechLanguage } from '../src/renderer/speech-language';

afterEach(() => { localStorage.clear(); delete window.sargosh; vi.unstubAllGlobals(); });
it.each(['left', 'right', 'bottom'])('selects and displays the shared language at the %s dock and closes on an outside desktop press', async dock => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let outside: (() => void) | undefined;
  const unsubscribe = vi.fn();
  window.sargosh = { onOverlayOutsidePress: (listener: () => void) => { outside = listener; return unsubscribe; } } as unknown as NonNullable<typeof window.sargosh>;
  const error = vi.fn();
  function Probe() {
    const [open, setOpen] = useState(false);
    return createElement('div', { className: 'overlay-stage', 'data-dock': dock }, createElement(OverlayLanguage, { open, onOpen: setOpen, onError: error }));
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const click = async (selector: string) => { await act(async () => (host.querySelector(selector) as HTMLButtonElement).click()); };
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(host.querySelector('.overlay-language-trigger')?.textContent).toBe('A');
    await click('.overlay-language-trigger');
    expect(host.querySelector('.overlay-language-menu')?.getAttribute('data-open')).toBe('true');
    await click('[role=menuitemradio]:nth-child(2)');
    expect(readSpeechLanguage()).toBe('hi');
    expect(host.querySelector('.overlay-language-trigger')?.textContent).toBe('अ');
    expect(host.querySelector('[aria-label="Speech language: Hindi"]')).not.toBeNull();
    expect(host.querySelector('.overlay-language-menu')?.getAttribute('data-open')).toBe('false');
    await act(async () => saveSpeechLanguage('multi'));
    expect(host.querySelector('.overlay-language-trigger')?.textContent).toBe('Aअ');
    await click('.overlay-language-trigger'); await act(async () => outside?.());
    expect(host.querySelector('.overlay-language-menu')?.getAttribute('data-open')).toBe('false');
    expect(unsubscribe).toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    await click('.overlay-language-trigger');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('.overlay-language-menu')?.getAttribute('data-open')).toBe('false');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
