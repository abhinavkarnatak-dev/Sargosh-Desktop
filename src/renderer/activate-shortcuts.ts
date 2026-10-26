import type { DesktopBridge } from '../shared/types';
let pending: Promise<unknown> = Promise.resolve();
export function activateShortcuts(shortcut: string, bridge: DesktopBridge | undefined = window.sargosh) {
  const work = pending.then(async () => {
    if (!bridge?.windowsStatus || !bridge.startWindowsRecording) throw new Error('Open the desktop app to use recording shortcuts.');
    const current = await bridge.windowsStatus();
    if (current.enabled && current.purpose === 'recording' && current.shortcut === shortcut) return current;
    if (['pending', 'listening'].includes(current.phase)) throw new Error('Finish your recording before changing shortcuts.');
    const next = await bridge.startWindowsRecording(shortcut);
    if (!next.enabled) throw new Error('Your shortcut could not start. Try another combination in Settings.');
    return next;
  });
  pending = work.catch(() => {}); return work;
}
