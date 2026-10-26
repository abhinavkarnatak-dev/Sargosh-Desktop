import { expect, it, vi } from 'vitest';
import { StartupGate, splashMarkup } from '../src/main/startup';
it.each(['paint-first', 'screen-first'])('reveals the app immediately and once when both startup signals arrive: %s', order => {
  const reveal = vi.fn(), gate = new StartupGate(reveal);
  if (order === 'paint-first') gate.painted(); else gate.rendered();
  expect(reveal).not.toHaveBeenCalled();
  if (order === 'paint-first') gate.rendered(); else gate.painted();
  expect(reveal).toHaveBeenCalledOnce(); expect(gate.complete).toBe(true);
  gate.painted(); gate.rendered(); expect(reveal).toHaveBeenCalledOnce();
});
it('does not reveal a window after startup was cancelled', () => {
  const reveal = vi.fn(), gate = new StartupGate(reveal);
  gate.painted(); gate.cancel(); gate.rendered(); expect(reveal).not.toHaveBeenCalled();
});
it('uses themed colors, an embedded logo, restricted content, and reduced-motion support', () => {
  for (const theme of ['light', 'dark'] as const) {
    const html = splashMarkup('aGVsbG8=', theme);
    expect(html).toContain('data:image/png;base64,aGVsbG8=');
    expect(html).toContain(theme === 'dark' ? '#191b18' : '#ffffff');
    expect(html).toContain('prefers-reduced-motion:reduce');
    expect(html).toContain("default-src 'none'"); expect(html).not.toContain('<script');
    expect(html).toContain('Opening Sargosh...');
  }
  expect(() => splashMarkup('" onerror="bad', 'dark')).toThrow();
});
