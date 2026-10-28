import { BrowserWindow } from 'electron';
import { dockAnchor, type DockBounds, type OverlayDock } from '../shared/overlay-dock';
export class OverlayDropZones {
  private windows: BrowserWindow[] = [];
  private ready = new Set<BrowserWindow>();
  private visible = false;
  private selected: OverlayDock | null = null;
  private placement = '';
  private theme = '';
  prepare(display: { id: number; workArea: DockBounds }, theme: 'light' | 'dark') {
    const positions: OverlayDock[] = ['left', 'right', 'bottom'];
    if (this.windows.some(window => window.isDestroyed())) this.dispose();
    if (!this.windows.length) {
      this.windows = positions.map(position => {
        const anchor = dockAnchor(position, display.workArea);
        const window = new BrowserWindow({ x: Math.round(Math.max(display.workArea.x, Math.min(anchor.x - 30, display.workArea.x + display.workArea.width - 60))),
          y: Math.round(anchor.y - 30), width: 60, height: 60, frame: false, transparent: true, focusable: false,
          alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } });
        window.setIgnoreMouseEvents(true);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', event => event.preventDefault());
        window.webContents.on('did-finish-load', () => {
          if (!this.windows.includes(window) || window.isDestroyed()) return;
          this.ready.add(window);
          if (this.visible) window.showInactive();
        });
        return window;
      });
    }
    const placement = JSON.stringify([display.id, display.workArea]);
    if (this.placement !== placement) {
      this.placement = placement;
      this.windows.forEach((window, index) => {
        const anchor = dockAnchor(positions[index], display.workArea);
        window.setPosition(Math.round(Math.max(display.workArea.x, Math.min(anchor.x - 30, display.workArea.x + display.workArea.width - 60))), Math.round(anchor.y - 30), false);
      });
    }
    if (this.theme !== theme) {
      this.theme = theme;
      this.windows.forEach(window => {
        this.ready.delete(window);
        const accent = theme === 'dark' ? '#bbd5a5' : '#375b3b', background = theme === 'dark' ? '#19231bdd' : '#fbfcf5ee';
        const markup = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;background:transparent;width:100%;height:100%;display:grid;place-items:center}div{width:48px;height:48px;border-radius:50%;border:2px solid ${accent};background:${background};display:grid;place-items:center}i{width:8px;height:8px;border-radius:50%;background:${accent}}</style><div><i></i></div>`;
        void window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(markup)).catch(() => {});
      });
    }
  }
  show(display: { id: number; workArea: DockBounds }, selected: OverlayDock | null, theme: 'light' | 'dark') {
    this.prepare(display, theme);
    const wasVisible = this.visible;
    this.visible = true;
    if (!wasVisible || this.selected !== selected) {
      this.selected = selected;
      this.windows.forEach((window, index) => window.setOpacity((['left', 'right', 'bottom'] as OverlayDock[])[index] === selected ? 1 : .4));
    }
    if (!wasVisible) this.windows.forEach(window => { if (this.ready.has(window)) window.showInactive(); });
  }
  hide() {
    this.visible = false;
    for (const window of this.windows) if (!window.isDestroyed()) window.hide();
  }
  dispose() {
    this.visible = false;
    for (const window of this.windows) if (!window.isDestroyed()) window.destroy();
    this.windows = []; this.ready.clear(); this.placement = ''; this.theme = ''; this.selected = null;
  }
}
