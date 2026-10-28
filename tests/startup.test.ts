import { createHash } from 'node:crypto';
import { LOGO_ANIMATION_SCRIPT } from '../src/main/animated-logo';
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
    const html = splashMarkup(theme);
    expect(html).toContain('class="animated-logo"');expect(html).toContain('width:72px;height:72px');expect(html).toContain('data-moving-wave');expect(html).not.toContain('<img');
    expect(html).toContain(theme === 'dark' ? '#111813' : '#eeeee6');
    expect(html).toContain('<h1>sargosh<span class="brand-period">.</span></h1>');
    expect(html).toContain('prefers-reduced-motion:reduce');
    expect(html).toContain("default-src 'none'"); expect(html).toContain("script-src 'sha256-"+createHash('sha256').update(LOGO_ANIMATION_SCRIPT).digest('base64')+"'");expect(html).toContain('<script>'+LOGO_ANIMATION_SCRIPT+'</script>');expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).toContain('Opening Sargosh...');
  }
});
