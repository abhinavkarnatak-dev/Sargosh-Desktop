// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { StartupReady } from '../src/renderer/StartupReady';
it('notifies desktop only after the screen is ready and not on ordinary rerenders', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const ready = vi.fn(); window.sargosh = { startupReady: ready } as unknown as NonNullable<typeof window.sargosh>;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(createElement(StartupReady, { ready: false }))); expect(ready).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(StartupReady, { ready: true }))); expect(ready).toHaveBeenCalledOnce();
    await act(async () => root.render(createElement(StartupReady, { ready: true }))); expect(ready).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); delete window.sargosh; vi.unstubAllGlobals(); }
});
