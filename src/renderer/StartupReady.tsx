import { useEffect } from 'react';
export function StartupReady({ ready = true }: { ready?: boolean }) {
  useEffect(() => { if (ready) window.sargosh?.startupReady?.(); }, [ready]);
  return null;
}
