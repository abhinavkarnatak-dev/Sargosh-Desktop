interface Point { x: number; y: number }
interface Bounds extends Point { width: number; height: number }
export interface OverlayGripBounds extends Bounds {}
interface DragHost {
  bounds(): Bounds;
  cursor(): Point;
  area(point: Point): Bounds;
  pressed(): boolean;
  move(x: number, y: number): void;
  started?(pill: OverlayGripBounds, point: Point): void;
  moved?(point: Point): void;
  ended?(point: Point): void;
}

// Cursor and window positions stay in Electron DIP coordinates throughout.
export class OverlayDrag {
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private host: DragHost) {}
  start(pill: OverlayGripBounds) {
    this.stop(false);
    if (!pill || ![pill.x, pill.y, pill.width, pill.height].every(Number.isFinite) || pill.width < 1 || pill.height < 1) return;
    const bounds = this.host.bounds(), cursor = this.host.cursor();
    if (pill.x < 0 || pill.y < 0 || pill.x + pill.width > bounds.width + 1 || pill.y + pill.height > bounds.height + 1) return;
    const grab = { x: cursor.x - bounds.x - pill.x, y: cursor.y - bounds.y - pill.y };
    const bottom = bounds.height - pill.y - pill.height;
    const offsetX = pill.x;
    let lastTarget = { x: bounds.x, y: bounds.y };
    this.host.started?.(pill, cursor);
    this.timer = setInterval(() => {
      if (!this.host.pressed()) { this.stop(); return; }
      const point = this.host.cursor(), area = this.host.area(point), current = this.host.bounds();
      this.host.moved?.(point);
      const left = Math.max(area.x, Math.min(point.x - grab.x, area.x + area.width - pill.width));
      const top = Math.max(area.y, Math.min(point.y - grab.y, area.y + area.height - pill.height));
      // Transparent padding may extend off-screen; the visible pill may not.
      const x = Math.round(left - offsetX);
      const y = Math.round(top - (current.height - bottom - pill.height));
      // Windows can report a neighbouring DIP after rounding to physical pixels.
      // Compare with our last target, not that rounded result, to avoid chasing it.
      if (Math.abs(x - lastTarget.x) > 1 || Math.abs(y - lastTarget.y) > 1) {
        lastTarget = { x, y };
        this.host.move(x, y);
      }
    }, 16);
  }
  stop(snap = true) {
    const active = this.timer !== undefined;
    clearInterval(this.timer); this.timer = undefined;
    if (active && snap) this.host.ended?.(this.host.cursor());
  }
}
