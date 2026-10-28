import { createLogoWavePaths, logoWavePaths, sPath } from '../shared/logo-wave';
export const LOGO_ANIMATION_SCRIPT = `(()=>{
 const paths=(${createLogoWavePaths.toString()})();
 const waves=document.querySelectorAll('[data-moving-wave]');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let frame=0,start;
 function reset(){paths().forEach((d,i)=>waves[i].setAttribute('d',d));}
 function tick(time){start??=time;paths(time-start).forEach((d,i)=>waves[i].setAttribute('d',d));frame=requestAnimationFrame(tick);}
 function configure(){cancelAnimationFrame(frame);start=undefined;reset();if(!reduced.matches&&!document.hidden)frame=requestAnimationFrame(tick);}
 reduced.addEventListener('change',configure);document.addEventListener('visibilitychange',configure);configure();
})();`;

export function animatedLogo(){
 return `<svg class="animated-logo" viewBox="0 0 500 500" aria-hidden="true" focusable="false"><defs><mask id="wave-clearance" maskUnits="userSpaceOnUse" x="0" y="0" width="500" height="500" style="mask-type:luminance"><rect width="500" height="500" fill="white"/><path d="${sPath}" fill="black" stroke="black" stroke-width="20" stroke-linejoin="round"/></mask></defs><path d="${sPath}" fill="currentColor"/><g mask="url(#wave-clearance)" fill="none" stroke="currentColor" stroke-width="16" stroke-linejoin="round" stroke-linecap="butt">${logoWavePaths().map(d=>`<path d="${d}" data-moving-wave/>`).join('')}</g></svg>`;
}
