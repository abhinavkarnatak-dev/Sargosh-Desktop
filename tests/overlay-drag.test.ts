import { afterEach, expect, it, vi } from 'vitest';
import { OverlayDrag } from '../src/main/overlay-drag';

afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  let bounds = { x: 500, y: 800, width: 420, height: 120 };
  let cursor = { x: 680, y: 885 }, held = true;
  const move = vi.fn((x: number, y: number) => { bounds = { ...bounds, x, y }; });
  const drag = new OverlayDrag({ bounds: () => bounds, cursor: () => cursor,
    area: point => point.x < 0 ? { x: -1920, y: 0, width: 1920, height: 1080 } : { x: 0, y: 0, width: 1920, height: 1080 },
    pressed: () => held, move });
  return { drag, move, bounds: () => bounds, cursor: (x: number, y: number) => { cursor = { x, y }; },
    release: () => { held = false; }, resize: () => { bounds = { ...bounds, y: bounds.y - 200, height: 320 }; } };
}
const pill = { x: 167.5, y: 68, width: 85, height: 40 };
it('tracks a fixed cursor anchor without accumulating movement or drifting at rest', () => {
  const test = setup(); test.drag.start(pill);
  test.cursor(780, 785); vi.advanceTimersByTime(16);
  expect(test.bounds()).toMatchObject({ x: 600, y: 700 });
  vi.advanceTimersByTime(160); expect(test.move).toHaveBeenCalledTimes(1);
  test.cursor(680, 885); vi.advanceTimersByTime(16);
  expect(test.bounds()).toMatchObject({ x: 500, y: 800 }); test.drag.stop();
});
it('allows the visible pill to reach both screen edges rather than clamping transparent padding', () => {
  const test = setup(); test.drag.start(pill);
  test.cursor(0, 0); vi.advanceTimersByTime(16);
  expect(test.bounds()).toMatchObject({ x: -167, y: -68 });
  test.cursor(1920, 1080); vi.advanceTimersByTime(16);
  expect(test.bounds()).toMatchObject({ x: 1668, y: 972 }); test.drag.stop();
});
it('crosses to a negative-coordinate monitor and keeps its grab point during notice resize', () => {
  const test = setup(); test.drag.start(pill);
  test.cursor(-300, 500); vi.advanceTimersByTime(16);
  expect(test.bounds()).toMatchObject({ x: -480, y: 415 });
  test.resize(); vi.advanceTimersByTime(16);
  expect(test.bounds()).toMatchObject({ x: -480, y: 215, height: 320 }); test.drag.stop();
});
it('stops when the native mouse is released even if pointerup is lost', () => {
  const test = setup(); test.drag.start(pill); test.release();
  test.cursor(800, 500); vi.advanceTimersByTime(160);
  expect(test.move).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('cleans up on stop and ignores invalid geometry', () => {
  const test = setup(); test.drag.start(pill); test.drag.stop();
  test.cursor(900, 400); vi.advanceTimersByTime(100); expect(test.move).not.toHaveBeenCalled();
  test.drag.start({ ...pill, width: NaN }); expect(vi.getTimerCount()).toBe(0);
});

it('does not chase Windows DPI rounding or one-pixel cursor jitter while held still', () => {
  vi.useFakeTimers();
  let bounds = { x: 500, y: 800, width: 420, height: 120 };
  let cursor = { x: 680, y: 885 };
  const move = vi.fn((x: number, y: number) => { bounds = { ...bounds, x: x + 1, y: y - 1 }; });
  const drag = new OverlayDrag({ bounds: () => bounds, cursor: () => cursor,
    area: () => ({ x: 0, y: 0, width: 1920, height: 1080 }), pressed: () => true, move });
  drag.start(pill);
  cursor = { x: 780, y: 785 }; vi.advanceTimersByTime(16);
  expect(move).toHaveBeenCalledExactlyOnceWith(600, 700);
  vi.advanceTimersByTime(320); expect(move).toHaveBeenCalledTimes(1);
  cursor = { x: 781, y: 784 }; vi.advanceTimersByTime(32);
  cursor = { x: 780, y: 785 }; vi.advanceTimersByTime(32);
  expect(move).toHaveBeenCalledTimes(1);
  cursor = { x: 784, y: 785 }; vi.advanceTimersByTime(16);
  expect(move).toHaveBeenLastCalledWith(604, 700);
  drag.stop();
});

it('keeps a side-docked grip anchor and emits a single docking completion', () => {
  vi.useFakeTimers();
  let bounds = { x: 8, y: 400, width: 500, height: 180 }, cursor = { x: 20, y: 480 };
  const started = vi.fn(), moved = vi.fn(), ended = vi.fn();
  const drag = new OverlayDrag({ bounds: () => bounds, cursor: () => cursor, pressed: () => true,
    area: () => ({ x: 0, y: 0, width: 1920, height: 1080 }), move: (x, y) => { bounds = { ...bounds, x, y }; }, started, moved, ended });
  drag.start({ x: 0, y: 46, width: 44, height: 88 });
  cursor = { x: 220, y: 480 }; vi.advanceTimersByTime(16);
  expect(bounds.x).toBe(208); expect(started).toHaveBeenCalledOnce(); expect(moved).toHaveBeenCalledWith(cursor);
  drag.stop(); drag.stop(); expect(ended).toHaveBeenCalledExactlyOnceWith(cursor);
});
