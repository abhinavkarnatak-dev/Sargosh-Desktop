import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { CLEAN_CALLBACK_SCRIPT, COMPLETION_CSP, googleCompletionPage } from '../src/main/google-completion-page';
import { GoogleCallback } from '../src/main/google-callback';
it('accepts one matching loopback callback and rejects a wrong path or missing code',async()=>{
  const callback=new GoogleCallback(0);const code=vi.fn(async (_code:string)=>{});
  try {
    const url=await callback.listen(code,vi.fn());
    expect((await fetch(new URL('/auth/callback/wrong?code=code',url))).status).toBe(400);
    expect((await fetch(url)).status).toBe(400);expect(code).not.toHaveBeenCalled();
    const response=await fetch(url+'?code=authorized-code');expect(response.status).toBe(200);expect(code).toHaveBeenCalledExactlyOnceWith('authorized-code');expect(await response.text()).toContain('You are signed in.');expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  }finally{callback.close();}
});

it('cleans the current address without another request and permits only that script', () => {
  const replaceState = vi.fn();
  runInNewContext(CLEAN_CALLBACK_SCRIPT, { history: { replaceState } });
  expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/auth/complete');
  const hash = createHash('sha256').update(CLEAN_CALLBACK_SCRIPT).digest('base64');
  expect(COMPLETION_CSP).toContain(`script-src 'sha256-${hash}'`);
  expect(COMPLETION_CSP).not.toContain("script-src 'unsafe-inline'");
});
it('uses self-contained themed pages for success and provider failures', async () => {
  const success = googleCompletionPage(true);
  expect(success).toContain('data:image/png;base64,');
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
