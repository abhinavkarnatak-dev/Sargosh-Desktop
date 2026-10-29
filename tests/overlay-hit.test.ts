import { afterEach,expect,it,vi } from 'vitest';
import { OverlayHitTest } from '../src/main/overlay-hit';
import { validOverlayRegions } from '../src/shared/overlay-hit';
afterEach(()=>vi.useRealTimers());
function setup(){
 vi.useFakeTimers();let p={x:200,y:150},b={x:100,y:100},down=false;
 const ignore=vi.fn();const hit=new OverlayHitTest({cursor:()=>p,bounds:()=>b,pressed:()=>down,ignore});
 return {hit,ignore,move:(x:number,y:number)=>{p={x,y};hit.refresh();},bounds:(x:number,y:number)=>{b={x,y};hit.refresh();},press:(value:boolean)=>{down=value;hit.refresh();}};
}
it.each(['left','right','bottom'])('passes empty %s dock areas through, preserving the rounded circle and notice controls',()=>{
 const s=setup();try{
  expect(s.ignore).toHaveBeenLastCalledWith(true);
  s.hit.update([{x:10,y:10,width:44,height:44,radius:22}]);
  s.move(132,132);expect(s.ignore).toHaveBeenLastCalledWith(false);
  s.move(111,111);expect(s.ignore).toHaveBeenLastCalledWith(true);
  s.move(200,140);expect(s.ignore).toHaveBeenLastCalledWith(true);
  s.hit.update([{x:10,y:10,width:44,height:44,radius:22},{x:70,y:0,width:320,height:110,radius:16}]);
  expect(s.ignore).toHaveBeenLastCalledWith(false);
  s.hit.update([{x:10,y:10,width:44,height:44,radius:22}]);expect(s.ignore).toHaveBeenLastCalledWith(true);
 }finally{s.hit.dispose();}
});
it('holds mouse input through a control press and a drag, then releases empty space',()=>{
 const s=setup();try{
  s.hit.update([{x:10,y:10,width:44,height:44,radius:22}]);s.move(132,132);s.press(true);
  s.move(500,500);expect(s.ignore).toHaveBeenLastCalledWith(false);
  s.hit.drag(true);s.press(false);expect(s.ignore).toHaveBeenLastCalledWith(false);
  s.hit.drag(false);expect(s.ignore).toHaveBeenLastCalledWith(true);
 }finally{s.hit.dispose();}
});
it('does not steal an underlying app drag when the pointer crosses the overlay',()=>{
 const s=setup();try{s.hit.update([{x:10,y:10,width:44,height:44,radius:22}]);s.press(true);s.move(132,132);expect(s.ignore).toHaveBeenLastCalledWith(true);s.press(false);expect(s.ignore).toHaveBeenLastCalledWith(false);}finally{s.hit.dispose();}
});
it('tracks new window positions and disposes its cursor polling',()=>{
 const s=setup();s.hit.update([{x:10,y:10,width:44,height:44,radius:22}]);s.move(132,132);s.bounds(-200,0);expect(s.ignore).toHaveBeenLastCalledWith(true);
 s.move(-168,32);expect(s.ignore).toHaveBeenLastCalledWith(false);s.hit.dispose();const count=s.ignore.mock.calls.length;vi.advanceTimersByTime(100);expect(s.ignore).toHaveBeenCalledTimes(count);
});
it('rejects untrusted region sizes and nonfinite coordinates',()=>{
 expect(validOverlayRegions([{x:0,y:0,width:44,height:44,radius:22}])).toBe(true);
 for(const value of [[{x:NaN,y:0,width:44,height:44,radius:0}],[{x:0,y:0,width:1e8,height:44,radius:0}],Array(9).fill({x:0,y:0,width:1,height:1,radius:0})])expect(validOverlayRegions(value)).toBe(false);
});
it('reports outside desktop presses once without dismissing clicks on a menu or control',()=>{
 vi.useFakeTimers();let point={x:20,y:20},down=false;const outsidePress=vi.fn();
 const hit=new OverlayHitTest({bounds:()=>({x:0,y:0}),cursor:()=>point,pressed:()=>down,ignore:()=>{},outsidePress});
 try{
  hit.update([{x:10,y:10,width:38,height:38,radius:19},{x:64,y:0,width:180,height:122,radius:15}]);
  point={x:100,y:40};hit.refresh();down=true;hit.refresh();expect(outsidePress).not.toHaveBeenCalled();
  down=false;hit.refresh();point={x:300,y:160};hit.refresh();down=true;hit.refresh();hit.refresh();expect(outsidePress).toHaveBeenCalledOnce();
 }finally{hit.dispose();}
});
