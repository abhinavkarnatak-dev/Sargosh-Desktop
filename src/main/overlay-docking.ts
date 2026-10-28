import { dockBounds, localDockAnchor, nearestDock, type DockBounds, type DockPoint, type DockPreference, type DockState } from '../shared/overlay-dock';
interface Display { id: number; workArea: DockBounds }
interface DockHost {
  bounds(): DockBounds;
  setBounds(bounds: DockBounds): void;
  displays(): Display[];
  primary(): Display;
  displayAt(point: DockPoint): Display;
  notify(state: DockState): void;
  guides(display: Display, target: DockState['target']): void;
  hideGuides(): void;
  save(preference: DockPreference): void;
  reducedMotion(): boolean;
}
export class OverlayDocking {
  state: DockState;
  private displayId: number;
  private requestedHeight = 120;
  private pill: DockBounds | null = null;
  private animation: ReturnType<typeof setInterval> | undefined;
  constructor(private host: DockHost, saved?: DockPreference) {
    this.state = { position: saved?.position ?? 'bottom', dragging: false, target: null };
    this.displayId = saved?.displayId ?? host.primary().id;
    this.reflow();
  }
  private display() { return this.host.displays().find(display => display.id === this.displayId) ?? this.host.primary(); }
  private emit() { this.host.notify({ ...this.state }); }
  private cancelAnimation() { clearInterval(this.animation); this.animation = undefined; }
  reflow() {
    if (this.state.dragging || this.animation) return;
    const display = this.display(); this.displayId = display.id;
    this.host.setBounds(dockBounds(this.state.position, display.workArea, this.requestedHeight));
  }
  resize(height: number) {
    this.requestedHeight = Math.max(120, Math.min(400, Math.round(height)));
    this.reflow();
  }
  start(pill: DockBounds, point: DockPoint) {
    this.cancelAnimation(); this.pill = pill;
    this.state = { ...this.state, dragging: true, target: nearestDock(point, this.host.displayAt(point).workArea) };
    this.host.guides(this.host.displayAt(point), this.state.target); this.emit();
  }
  move(point: DockPoint) {
    if (!this.state.dragging) return;
    const display = this.host.displayAt(point), target = nearestDock(point, display.workArea);
    this.host.guides(display, target);
    if (target !== this.state.target) { this.state.target = target; this.emit(); }
  }
  end(point: DockPoint) {
    if (!this.state.dragging || !this.pill) return;
    const current = this.host.bounds(), display = this.host.displayAt(point);
    const center = { x: current.x + this.pill.x + this.pill.width / 2, y: current.y + this.pill.y + this.pill.height / 2 };
    this.displayId = display.id;
    this.state = { position: nearestDock(point, display.workArea), dragging: false, target: null };
    this.pill = null; this.host.hideGuides(); this.emit();
    const target = dockBounds(this.state.position, display.workArea, this.requestedHeight);
    const anchor = localDockAnchor(this.state.position, target);
    const start = { ...target, x: Math.round(center.x - anchor.x), y: Math.round(center.y - anchor.y) };
    this.host.save({ position: this.state.position, displayId: display.id });
    if (this.host.reducedMotion()) { this.host.setBounds(target); return; }
    this.host.setBounds(start);
    const began = Date.now();
    this.animation = setInterval(() => {
      const progress = Math.min(1, (Date.now() - began) / 240), eased = 1 - (1 - progress) ** 3;
      this.host.setBounds({ ...target, x: Math.round(start.x + (target.x - start.x) * eased), y: Math.round(start.y + (target.y - start.y) * eased) });
      if (progress === 1) { this.cancelAnimation(); this.reflow(); }
    }, 16);
  }
  cancel() { this.cancelAnimation(); this.pill = null; this.state = { ...this.state, dragging: false, target: null }; this.host.hideGuides(); this.emit(); this.reflow(); }
  dispose() { this.cancelAnimation(); this.host.hideGuides(); }
}
