// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { syncOverlayTheme } from '../src/renderer/overlay-theme';
afterEach(()=>{delete window.sargosh;delete document.documentElement.dataset.theme;vi.unstubAllGlobals();});
it('uses the main window preference, follows live changes and cleans up without touching recording',async()=>{
  let update!:(theme:'light'|'dark')=>void;const release=vi.fn();
  window.sargosh={windowTheme:async()=> 'light',onWindowTheme:(listener:typeof update)=>{update=listener;return release;}} as unknown as NonNullable<typeof window.sargosh>;
  const stop=syncOverlayTheme();await Promise.resolve();expect(document.documentElement.dataset.theme).toBe('light');
  update('dark');expect(document.documentElement.dataset.theme).toBe('dark');
  stop();expect(release).toHaveBeenCalledOnce();update('light');expect(document.documentElement.dataset.theme).toBe('dark');
});
it('does not let a delayed initial theme overwrite a newer main-window event',async()=>{
  let update!:(theme:'light'|'dark')=>void,resolve!:(theme:'light'|'dark')=>void;
  window.sargosh={windowTheme:()=>new Promise(yes=>{resolve=yes;}),onWindowTheme:(listener:typeof update)=>{update=listener;return()=>{};}} as unknown as NonNullable<typeof window.sargosh>;
  const stop=syncOverlayTheme();update('dark');resolve('light');await Promise.resolve();expect(document.documentElement.dataset.theme).toBe('dark');stop();
});

