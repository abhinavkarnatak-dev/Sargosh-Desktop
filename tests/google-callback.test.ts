import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { CLEAN_CALLBACK_SCRIPT, LOGO_ANIMATION_SCRIPT, COMPLETION_CSP, googleCompletionPage } from '../src/main/google-completion-page';
import { GoogleCallback, GOOGLE_COMPLETION_URL } from '../src/main/google-callback';
it('accepts one matching loopback callback and rejects a wrong path or missing code',async()=>{
  const callback=new GoogleCallback(0);const code=vi.fn(async (_code:string)=>{});
  try {
    const url=await callback.listen(code,vi.fn());
    expect((await fetch(new URL('/auth/callback/wrong?code=code',url))).status).toBe(400);
    expect((await fetch(url)).status).toBe(400);expect(code).not.toHaveBeenCalled();
    const response=await fetch(url+'?code=authorized-code',{redirect:'manual'});expect(response.status).toBe(303);expect(code).toHaveBeenCalledExactlyOnceWith('authorized-code');expect(response.headers.get('location')).toBe(GOOGLE_COMPLETION_URL);expect(await response.text()).toBe('');expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  }finally{callback.close();}
});

it('cleans the current address and permits only the exact cleanup and logo scripts', () => {
  const replaceState = vi.fn();
  runInNewContext(CLEAN_CALLBACK_SCRIPT, { history: { replaceState } });
  expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/auth/complete');
  const hash = createHash('sha256').update(CLEAN_CALLBACK_SCRIPT).digest('base64');
  expect(COMPLETION_CSP).toContain(`script-src 'sha256-${hash}'`);
  expect(COMPLETION_CSP).toContain("'sha256-"+createHash('sha256').update(LOGO_ANIMATION_SCRIPT).digest('base64')+"'");expect(COMPLETION_CSP).not.toContain("script-src 'unsafe-inline'");
});
it('uses self-contained themed pages for success and provider failures', async () => {
  const success = googleCompletionPage(true);
  expect(success).toContain('class="animated-logo"');expect(success).toContain('data-moving-wave');expect(success).toContain(LOGO_ANIMATION_SCRIPT);
  expect(success).toContain('prefers-color-scheme:dark');
  expect(success).not.toMatch(/https?:\/\//);
  for (const query of ['error=access_denied&error_description=private-provider-message', 'code=valid-test-code']) {
    const callback = new GoogleCallback(0);
    const onCode = vi.fn(async () => { throw new Error('private-exchange-error'); });
    const timeout = vi.fn();
    try {
      const url = await callback.listen(onCode, timeout);
      const response = await fetch(url + '?' + query);
      const html = await response.text();
      expect(html).toContain('Sign-in did not complete.');
      expect(html).toContain(CLEAN_CALLBACK_SCRIPT);
      expect(html).not.toContain('private-');
      expect(html).not.toContain('valid-test-code');
      expect(response.headers.get('content-security-policy')).toBe(COMPLETION_CSP);
      expect(response.headers.get('cache-control')).toBe('no-store');
      if (query.startsWith('error=')) { expect(onCode).not.toHaveBeenCalled(); expect(timeout).toHaveBeenCalledOnce(); }
      else { expect(onCode).toHaveBeenCalledOnce(); expect(response.status).toBe(400); }
    } finally { callback.close(); }
  }
});

it('animates the same SVG paths without network access and respects reduced motion',()=>{
 const nodes=[{setAttribute:vi.fn()},{setAttribute:vi.fn()}];let frame:((time:number)=>void)|undefined;
 const reduced={matches:false,addEventListener:vi.fn()};
 runInNewContext(LOGO_ANIMATION_SCRIPT,{document:{querySelectorAll:()=>nodes,hidden:false,addEventListener:vi.fn()},matchMedia:()=>reduced,cancelAnimationFrame:vi.fn(),requestAnimationFrame:(next:(time:number)=>void)=>{frame=next;return 1;}});
 expect(frame).toBeTypeOf('function');frame!(0);const first=nodes[0].setAttribute.mock.calls.at(-1)![1];frame!(600);expect(nodes[0].setAttribute.mock.calls.at(-1)![1]).not.toBe(first);
 reduced.matches=true;frame=undefined;const configure=reduced.addEventListener.mock.calls[0][1];configure();expect(frame).toBeUndefined();
});
