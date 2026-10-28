import { useEffect, useId, useRef } from 'react';
import './BrandRipple.css';

// Decorative only. Remove this component to roll back the brand ripple experiment.
export function BrandRipple() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const displacement = useRef<SVGFEDisplacementMapElement>(null);
  const turbulence = useRef<SVGFETurbulenceElement>(null);
  const filterId = 'brand-water-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  useEffect(() => {
    const surface = canvas.current;
    const frame = surface?.closest<HTMLElement>('.app-frame');
    const brand = frame?.querySelector<HTMLElement>('.brand');
    if (!surface || !frame || !brand) return;
    const context = surface.getContext('2d');
    if (!context) return;
    let animation = 0;
    let restoreChrome = () => {};
    const reset = () => {
      cancelAnimationFrame(animation);
      restoreChrome();
      restoreChrome = () => {};
      displacement.current?.setAttribute('scale', '0');
      context.clearRect(0, 0, surface.width, surface.height);
    };
    const play = (event: MouseEvent) => {
      reset();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const bounds = frame.getBoundingClientRect();
      const logo = brand.getBoundingClientRect();
      const x = event.detail === 0 ? logo.left - bounds.left + logo.width / 2 : event.clientX - bounds.left;
      const y = event.detail === 0 ? logo.top - bounds.top + logo.height / 2 : event.clientY - bounds.top;
      const width = bounds.width, height = bounds.height;
      const density = Math.min(window.devicePixelRatio || 1, 2);
      surface.width = Math.ceil(width * density);
      surface.height = Math.ceil(height * density);
      context.setTransform(density, 0, 0, density, 0, 0);
      const color = getComputedStyle(frame).getPropertyValue('--accent').trim();
      const chrome = Array.from(frame.querySelectorAll<HTMLElement>('.sidebar, .desktop-titlebar'));
      const previousFilters = chrome.map(element => element.style.filter);
      chrome.forEach(element => { element.style.filter = `url(#${filterId})`; });
      restoreChrome = () => chrome.forEach((element, index) => { element.style.filter = previousFilters[index]; });
      const main = frame.querySelector<HTMLElement>('.main-surface')?.getBoundingClientRect();
      const reach = Math.max(Math.hypot(x, y), Math.hypot(width - x, y), Math.hypot(x, height - y), Math.hypot(width - x, height - y)) + 90;
      const started = performance.now();
      const draw = (now: number) => {
        const elapsed = now - started;
        context.clearRect(0, 0, width, height);
        if (elapsed >= 2900) { reset(); return; }
        // Refract only the app chrome. The dashboard is never filtered or painted.
        const envelope = Math.sin(Math.min(elapsed / 350, 1) * Math.PI / 2) * Math.pow(1 - elapsed / 2900, 1.4);
        displacement.current?.setAttribute('scale', String(envelope * 9));
        turbulence.current?.setAttribute('baseFrequency', `${.009 + elapsed / 900000} ${.018 + elapsed / 600000}`);
        context.save();
        if (main) {
          context.beginPath();
          context.rect(0, 0, width, height);
          context.roundRect(main.left - bounds.left, main.top - bounds.top, main.width, main.height, 19);
          context.clip('evenodd');
        }
        for (let ring = 0; ring < 3; ring++) {
          const progress = (elapsed - ring * 180) / 2400;
          if (progress <= 0 || progress >= 1) continue;
          const radius = 12 + reach * progress;
          const strength = Math.sin(Math.min(progress * 8, Math.PI / 2)) * Math.pow(1 - progress, .8);
          for (let edge = 0; edge < 2; edge++) {
            context.beginPath();
            for (let step = 0; step <= 240; step++) {
              const angle = step / 240 * Math.PI * 2;
              const wobble = Math.sin(angle * 5 + progress * 9) * 7 + Math.sin(angle * 9 - progress * 7) * 3;
              const distance = radius + wobble + edge * 12;
              const px = x + Math.cos(angle) * distance, py = y + Math.sin(angle) * distance;
              if (step === 0) context.moveTo(px, py); else context.lineTo(px, py);
            }
            context.closePath();
            context.strokeStyle = edge === 0 ? color : '#000000';
            context.globalAlpha = strength * (edge === 0 ? .065 : .035);
            context.lineWidth = edge === 0 ? 16 : 24;
            context.stroke();
          }
        }
        context.restore();
        animation = requestAnimationFrame(draw);
      };
      animation = requestAnimationFrame(draw);
    };
    brand.addEventListener('click', play);
    return () => {
      brand.removeEventListener('click', play);
      reset();
    };
  }, [filterId]);
  return <>
    <svg className="brand-water-filter" aria-hidden="true" width="0" height="0"><defs>
      <filter id={filterId} x="-12%" y="-12%" width="124%" height="124%" colorInterpolationFilters="sRGB">
        <feTurbulence ref={turbulence} type="fractalNoise" baseFrequency=".009 .018" numOctaves="2" seed="6" result="water" />
        <feDisplacementMap ref={displacement} in="SourceGraphic" in2="water" scale="0" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs></svg>
    <canvas ref={canvas} className="brand-water-ripple" aria-hidden="true" />
  </>;
}
