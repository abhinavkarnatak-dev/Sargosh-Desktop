import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ windows: [] as any[] }));
vi.mock('electron', () => ({ BrowserWindow: class {
  destroyed = false;
  listeners = new Map<string, () => void>();
  webContents = { on: vi.fn((event: string, callback: () => void) => { this.listeners.set(event, callback); }), setWindowOpenHandler: vi.fn() };
  setIgnoreMouseEvents = vi.fn(); setPosition = vi.fn(); setOpacity = vi.fn(); showInactive = vi.fn(); hide = vi.fn();
  loadURL = vi.fn(async () => {});
  destroy = vi.fn(() => { this.destroyed = true; });
  isDestroyed() { return this.destroyed; }
  constructor(readonly options: unknown) { native.windows.push(this); }
} }));
import { OverlayDropZones } from '../src/main/overlay-drop-zones';
const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
beforeEach(() => { native.windows = []; });
const ready = () => native.windows.forEach(window => window.listeners.get('did-finish-load')?.());

it('preloads invisibly, then shows immediately and reuses all three windows on subsequent drags', () => {
  const zones = new OverlayDropZones(); zones.prepare(display, 'dark'); ready();
  expect(native.windows).toHaveLength(3);
  for (const window of native.windows) { expect(window.showInactive).not.toHaveBeenCalled(); expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true); }
  zones.show(display, 'left', 'dark');
  for (const window of native.windows) expect(window.showInactive).toHaveBeenCalledOnce();
  zones.show(display, 'right', 'dark'); zones.hide(); zones.show(display, 'bottom', 'dark');
  expect(native.windows).toHaveLength(3);
  for (const window of native.windows) {
    expect(window.loadURL).toHaveBeenCalledOnce(); expect(window.destroy).not.toHaveBeenCalled(); expect(window.showInactive).toHaveBeenCalledTimes(2);
  }
  zones.dispose(); for (const window of native.windows) expect(window.destroy).toHaveBeenCalledOnce();
});
it('repositions on another monitor without recreating renderers or reloading their content', () => {
  const zones = new OverlayDropZones(); zones.prepare(display, 'light'); ready(); zones.show(display, 'left', 'light');
  const next = { id: 2, workArea: { x: -1280, y: 0, width: 1280, height: 960 } };
  zones.show(next, 'right', 'light');
  for (const window of native.windows) { expect(window.loadURL).toHaveBeenCalledOnce(); expect(window.setPosition).toHaveBeenCalledTimes(2); }
  expect(native.windows[1].setOpacity).toHaveBeenLastCalledWith(1); zones.dispose();
});
it('does not flash delayed windows after the drag ends or the app shuts down', () => {
  const zones = new OverlayDropZones(); zones.show(display, 'bottom', 'dark'); zones.hide(); ready();
  for (const window of native.windows) expect(window.showInactive).not.toHaveBeenCalled();
  zones.show(display, 'bottom', 'dark'); zones.dispose();
  for (const window of native.windows) window.showInactive.mockClear();
  ready(); for (const window of native.windows) expect(window.showInactive).not.toHaveBeenCalled();
});
