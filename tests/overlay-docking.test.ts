import { afterEach, expect, it, vi } from 'vitest';
import { dockBounds, nearestDock, validDockPreference, type DockBounds, type DockPreference, type DockState } from '../src/shared/overlay-dock';
import { OverlayDocking } from '../src/main/overlay-docking';
afterEach(() => vi.useRealTimers());
const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const secondary = { id: 2, workArea: { x: -1280, y: -100, width: 1280, height: 1024 } };
function setup(saved?: DockPreference, reduced = false) {
  vi.useFakeTimers();
  let bounds: DockBounds = { x: 750, y: 912, width: 420, height: 120 };
  let displays = [primary, secondary];
  const notify = vi.fn<(state: DockState) => void>(), save = vi.fn(), guides = vi.fn(), hideGuides = vi.fn();
  const controller = new OverlayDocking({ bounds: () => bounds, setBounds: next => { bounds = next; },
    displays: () => displays, primary: () => primary, displayAt: point => point.x < 0 && displays.includes(secondary) ? secondary : primary,
    notify, save, guides, hideGuides, reducedMotion: () => reduced }, saved);
  return { controller, bounds: () => bounds, notify, save, guides, hideGuides, removeMonitor: () => { displays = [primary]; } };
}
it('selects only left, right or bottom and keeps all docked windows within the monitor work area', () => {
  expect(nearestDock({ x: 0, y: 500 }, primary.workArea)).toBe('left');
  expect(nearestDock({ x: 1910, y: 500 }, primary.workArea)).toBe('right');
  expect(nearestDock({ x: 960, y: 1030 }, primary.workArea)).toBe('bottom');
  for (const position of ['left', 'right', 'bottom'] as const) for (const display of [primary, secondary]) {
    const bounds = dockBounds(position, display.workArea, 400);
    expect(bounds.x).toBeGreaterThanOrEqual(display.workArea.x);
    expect(bounds.y).toBeGreaterThanOrEqual(display.workArea.y);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(display.workArea.x + display.workArea.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(display.workArea.y + display.workArea.height);
  }
});
it('shows zones while dragging, smoothly snaps on release and saves the chosen monitor and position', () => {
  const test = setup(); const initial = test.bounds();
  test.controller.start({ x: 160, y: 64, width: 100, height: 44 }, { x: 940, y: 998 });
  expect(test.controller.state.dragging).toBe(true); expect(test.guides).toHaveBeenCalled();
  test.controller.move({ x: 1900, y: 520 }); expect(test.controller.state.target).toBe('right');
  test.controller.end({ x: 1900, y: 520 });
  expect(test.hideGuides).toHaveBeenCalledOnce(); expect(test.save).toHaveBeenCalledExactlyOnceWith({ position: 'right', displayId: 1 });
  expect(test.bounds()).not.toEqual(dockBounds('right', primary.workArea, 120));
  vi.advanceTimersByTime(128); expect(test.bounds().x).toBeGreaterThan(initial.x);
  vi.advanceTimersByTime(160); expect(test.bounds()).toEqual(dockBounds('right', primary.workArea, 120));
  expect(test.controller.state).toEqual({ position: 'right', dragging: false, target: null }); test.controller.dispose();
});
it('restores a saved dock, handles notice resizing, and falls back safely when its monitor is removed', () => {
  const test = setup({ position: 'left', displayId: 2 });
  expect(test.bounds()).toEqual(dockBounds('left', secondary.workArea, 120));
  test.controller.resize(390); expect(test.bounds()).toEqual(dockBounds('left', secondary.workArea, 390));
  test.removeMonitor(); test.controller.reflow();
  expect(test.bounds()).toEqual(dockBounds('left', primary.workArea, 390)); test.controller.dispose();
});
it('does not resize under a drag and respects reduced motion on release', () => {
  const test = setup(undefined, true); const initial = test.bounds();
  test.controller.start({ x: 160, y: 64, width: 100, height: 44 }, { x: 940, y: 998 });
  test.controller.resize(380); expect(test.bounds()).toEqual(initial);
  test.controller.end({ x: -1200, y: 400 });
  expect(test.bounds()).toEqual(dockBounds('left', secondary.workArea, 380));
  expect(vi.getTimerCount()).toBe(0); test.controller.dispose();
});
it('cancels guides and animations on reload or shutdown and validates saved preferences', () => {
  const test = setup();
  test.controller.start({ x: 160, y: 64, width: 100, height: 44 }, { x: 940, y: 998 });
  test.controller.cancel(); expect(test.controller.state.dragging).toBe(false); expect(test.save).not.toHaveBeenCalled();
  test.controller.dispose(); expect(vi.getTimerCount()).toBe(0);
  expect(validDockPreference({ position: 'left', displayId: -22 })).toBe(true);
  for (const invalid of [null, {}, { position: 'top', displayId: 1 }, { position: 'bottom', displayId: '1' }]) expect(validDockPreference(invalid)).toBe(false);
});
