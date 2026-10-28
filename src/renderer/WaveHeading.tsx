import { useEffect, useRef } from 'react';
import './WaveHeading.css';

// Kept separate so this visual experiment can be removed without touching page layouts.
export function WaveHeading({ children: text }: { children: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animations: Animation[] = [];
    const start = () => {
      animations.forEach(animation => animation.cancel());
      animations = [];
      if (motion.matches) return;
      const letters = Array.from(heading.current?.querySelectorAll<HTMLElement>('.wave-heading-letter') ?? []);
      // Finish the entire pass before the one-second pause and next wave.
      const duration = 1440 + Math.max(0, letters.length - 1) * 45 + 1000;
      const startTime = document.timeline.currentTime;
      animations = letters.map((letter, index) => {
        const offset = index * 45;
        const animation = letter.animate([
          { transform: 'translateY(0)', offset: 0 },
          { transform: 'translateY(0)', offset: offset / duration, easing: 'ease-in-out' },
          { transform: 'translateY(-2px)', offset: (offset + 480) / duration, easing: 'ease-in-out' },
          { transform: 'translateY(1px)', offset: (offset + 960) / duration, easing: 'ease-in-out' },
          { transform: 'translateY(0)', offset: (offset + 1440) / duration },
          { transform: 'translateY(0)', offset: 1 },
        ], { duration, iterations: Infinity });
        if (startTime !== null) animation.startTime = startTime;
        return animation;
      });
    };
    start();
    motion.addEventListener('change', start);
    return () => {
      motion.removeEventListener('change', start);
      animations.forEach(animation => animation.cancel());
    };
  }, [text]);
  let index=0;
  return <h1 ref={heading} className="wave-heading" aria-label={text}><span aria-hidden="true">{text.split(/(\s+)/u).map((word,part)=>/\s/u.test(word)?word:<span className="wave-heading-word" key={part}>{Array.from(word).map(letter=><span className="wave-heading-letter" key={index++}>{letter}</span>)}</span>)}</span></h1>;
}
