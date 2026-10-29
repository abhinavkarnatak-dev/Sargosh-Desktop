import { insideOverlayRegion, type OverlayHitRegion } from '../shared/overlay-hit';
interface Host {
 bounds():{x:number;y:number};cursor():{x:number;y:number};pressed():boolean;
 ignore(value:boolean):void;
 outsidePress?():void;
}
// Keep window rendering intact; only its mouse-input behavior changes. Screen
// and BrowserWindow coordinates are both Electron DIP coordinates on Windows.
export class OverlayHitTest {
 private regions:OverlayHitRegion[]=[];private ignored:boolean|undefined;private held=false;private pressed=false;private dragging=false;
 private timer:ReturnType<typeof setInterval>;
 constructor(private host:Host){this.refresh();this.timer=setInterval(()=>this.refresh(),16);this.timer.unref?.();}
 update(regions:OverlayHitRegion[]){this.regions=regions;this.refresh();}
 drag(value:boolean){this.dragging=value;this.refresh();}
 refresh(){
  const down=this.host.pressed();
  const began=down&&!this.pressed;
  if(down&&!this.pressed)this.held=this.ignored===false;
  if(!down)this.held=false;
  this.pressed=down;
  const p=this.host.cursor(),b=this.host.bounds();
  const inside=this.regions.some(r=>insideOverlayRegion(p.x-b.x,p.y-b.y,r));
  if(began&&!inside&&!this.held&&!this.dragging)this.host.outsidePress?.();
  // A press begun in the app beneath the overlay must stay there until release.
  const ignore=!(this.dragging||this.held||(!down&&inside));
  if(ignore!==this.ignored){this.ignored=ignore;this.host.ignore(ignore);}
 }
 dispose(){clearInterval(this.timer);}
}
