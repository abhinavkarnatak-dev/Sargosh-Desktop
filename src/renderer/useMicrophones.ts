import { useEffect, useState } from 'react';
export function useMicrophones() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    let alive = true, revision = 0;
    async function refresh() {
      const current = ++revision;
      try {
        const values = await media.enumerateDevices();
        if (alive && current === revision) setDevices(values.filter(device => device.kind === 'audioinput'));
      } catch { /* The microphone test explains permission and device failures. */ }
    }
    void refresh();
    media.addEventListener('devicechange', refresh);
    return () => { alive = false; revision++; media.removeEventListener('devicechange', refresh); };
  }, []);
  return [devices, setDevices] as const;
}
