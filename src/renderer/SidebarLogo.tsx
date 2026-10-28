import { useEffect, useId, useRef } from 'react';
import './SidebarLogo.css';
import { logoWavePaths, sPath } from './sidebar-logo-wave';

// Shared mark: original dimensions, stationary S, continuous wave, and fixed clearance.
export function SidebarLogo() {
  const clearanceId = useId().replace(/:/g, '') + '-wave-clearance';
  const waves = useRef<(SVGPathElement | null)[]>([]);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let start: number | undefined;
    const reset = () => logoWavePaths().forEach((d, index) => waves.current[index]?.setAttribute('d', d));
    const tick = (time: number) => {
      start ??= time;
      logoWavePaths(time - start).forEach((d, index) => waves.current[index]?.setAttribute('d', d));
      frame = requestAnimationFrame(tick);
    };
    const configure = () => {
      cancelAnimationFrame(frame);
      start = undefined;
      reset();
      if (!reduced.matches && !document.hidden) frame = requestAnimationFrame(tick);
    };
    configure();
    reduced.addEventListener('change', configure);
    document.addEventListener('visibilitychange', configure);
    return () => { cancelAnimationFrame(frame); reduced.removeEventListener('change', configure); document.removeEventListener('visibilitychange', configure); reset(); };

  }, []);
  return <svg className="sidebar-logo" viewBox="0 0 500 500" aria-hidden="true" focusable="false">
    <defs>
      <mask id={clearanceId} maskUnits="userSpaceOnUse" x="0" y="0" width="500" height="500" style={{ maskType: 'luminance' }}>
        <rect width="500" height="500" fill="white" />
        <path d={sPath} fill="black" stroke="black" strokeWidth="20" strokeLinejoin="round" />
      </mask>
    </defs>
    <path d={sPath} fill="currentColor" data-static-s="" />
    <g mask={`url(#${clearanceId})`} fill="none" stroke="currentColor" strokeWidth="16" strokeLinejoin="round" strokeLinecap="butt">
      {logoWavePaths().map((d, i) => <path key={i} d={d} ref={element => { waves.current[i] = element; }} data-moving-wave="" />)}
    </g>
  </svg>;
}

