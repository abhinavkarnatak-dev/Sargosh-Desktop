import { useEffect } from 'react';
import { validOverlayRegions, type OverlayHitRegion } from '../shared/overlay-hit';
// Computed corner radii can be calc(% + px) while CSS interpolates them.
export function overlayCornerRadius(value:string,width:number,height:number){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return 0;
 const limit=Math.max(0,Math.min(width,height)/2);
 const expression=value.trim().replace(/^calc\((.*)\)$/,'$1').replace(/\s+/g,'');
 if(!/^[+-]?(?:\d*\.)?\d+(?:px|%)(?:[+-](?:\d*\.)?\d+(?:px|%))*$/.test(expression))return 0;
 const terms=expression.match(/[+-]?(?:\d*\.)?\d+(?:px|%)/g)??[];
 const radius=terms.reduce((sum,term)=>sum+parseFloat(term)*(term.endsWith('%')?Math.min(width,height)/100:1),0);
 return Number.isFinite(radius)?Math.max(0,Math.min(limit,radius)):0;
}
export function useOverlayHitRegions(){
 useEffect(()=>{
  const send=window.sargosh?.overlayHitRegions;if(!send)return;
  let frame=0,until=0,last='',alive=true;
  const measure=()=>{
   frame=0;if(!alive)return;
   const regions:OverlayHitRegion[]=[];
   for(const node of document.querySelectorAll<HTMLElement>('.overlay-pill,.overlay-notice,.overlay-language-menu')){
    const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
    if(!rect.width||!rect.height||style.visibility==='hidden'||style.display==='none'||style.pointerEvents==='none')continue;
    const radius=overlayCornerRadius(style.borderTopLeftRadius,rect.width,rect.height);
    const region={x:rect.x,y:rect.y,width:rect.width,height:rect.height,radius};
    if(validOverlayRegions([region]))regions.push(region);
   }
   const key=JSON.stringify(regions);
   if(key!==last){last=key;void send(regions).catch(()=>{});}
   if(performance.now()<until)frame=requestAnimationFrame(measure);
  };
  const refresh=()=>{until=performance.now()+600;if(!frame)frame=requestAnimationFrame(measure);};
  const observer=new MutationObserver(refresh);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','data-dock','data-closing','data-open']});
  const resize=new ResizeObserver(refresh);resize.observe(document.body);
  window.addEventListener('resize',refresh);document.addEventListener('transitionrun',refresh,true);document.addEventListener('animationstart',refresh,true);
  refresh();
  return()=>{alive=false;cancelAnimationFrame(frame);observer.disconnect();resize.disconnect();window.removeEventListener('resize',refresh);document.removeEventListener('transitionrun',refresh,true);document.removeEventListener('animationstart',refresh,true);void send([]).catch(()=>{});};
 },[]);
}
