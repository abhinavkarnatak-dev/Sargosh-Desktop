export interface OverlayHitRegion { x:number;y:number;width:number;height:number;radius:number }
export function validOverlayRegions(value:unknown):value is OverlayHitRegion[]{
 return Array.isArray(value)&&value.length<=8&&value.every(r=>r&&['x','y','width','height','radius'].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k]))&&Math.abs(r.x)<=4096&&Math.abs(r.y)<=4096&&r.width>0&&r.width<=4096&&r.height>0&&r.height<=4096&&r.radius>=0&&r.radius<=2048);
}
export function insideOverlayRegion(x:number,y:number,r:OverlayHitRegion){
 if(x<r.x||y<r.y||x>=r.x+r.width||y>=r.y+r.height)return false;
 const radius=Math.min(r.radius,r.width/2,r.height/2);
 const cx=Math.max(r.x+radius,Math.min(x,r.x+r.width-radius)),cy=Math.max(r.y+radius,Math.min(y,r.y+r.height-radius));
 return (x-cx)**2+(y-cy)**2<=radius**2;
}
