import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const CLEAN_CALLBACK_SCRIPT = "history.replaceState(null, '', '/auth/complete');";
export const COMPLETION_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-" + createHash('sha256').update(CLEAN_CALLBACK_SCRIPT).digest('base64') + "'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function logo(theme: 'light' | 'dark'): string {
  const root = path.resolve(__dirname, '../..');
  for (const directory of ['dist/renderer/brand', 'src/renderer/public/brand']) {
    try { return 'data:image/png;base64,' + readFileSync(path.join(root, directory, `logo-${theme}.png`)).toString('base64'); } catch { /* The source asset is available before the first build. */ }
  }
  return '';
}

export function googleCompletionPage(success: boolean): string {
  const heading = success ? 'You are signed in.' : 'Sign-in did not complete.';
  const description = success ? 'Your voice has a place to land. Return to Sargosh and make room for your thoughts.' : 'Return to Sargosh and try signing in again.';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${success ? 'Signed in' : 'Sign-in'} | Sargosh</title>
<script>${CLEAN_CALLBACK_SCRIPT}</script>
<style>
:root{color-scheme:light dark;--bg:#f4f3ef;--card:#fff;--text:#232622;--muted:#6b7169;--border:#e4e5df;--accent:#216a60;--tint:#e7f0ec}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:'Segoe UI',Arial,sans-serif;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:28px}
main{width:100%;max-width:460px;text-align:center}.brand{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:34px;font-size:23px;font-weight:600;letter-spacing:-.6px}.brand img{width:48px;height:48px;object-fit:contain}.dark-logo{display:none}
.card{background:var(--card);border:1px solid var(--border);border-radius:22px;padding:42px 32px;box-shadow:0 12px 48px #00000006}.status{width:54px;height:54px;display:grid;place-items:center;border-radius:50%;margin:0 auto 24px;background:var(--tint);color:var(--accent);font-size:27px}h1{font-size:28px;font-weight:600;letter-spacing:-.8px;margin:0 0 16px;line-height:1.25}p{font-size:15px;line-height:1.7;color:var(--muted);margin:0}.hint{border-top:1px solid var(--border);padding-top:24px;margin-top:28px;font-size:13px}footer{color:var(--muted);font-size:12px;margin-top:28px;letter-spacing:.2px}
@media(prefers-color-scheme:dark){:root{--bg:#20211f;--card:#191b19;--text:#eeeee8;--muted:#a1a79e;--border:#32372f;--accent:#a5d1c5;--tint:#253c34}.light-logo{display:none}.dark-logo{display:block}}
@media(max-width:400px){body{padding:20px}.card{padding:32px 22px}h1{font-size:25px}}
</style></head><body><main><div class="brand"><img class="light-logo" src="${logo('light')}" alt=""><img class="dark-logo" src="${logo('dark')}" alt=""><span>Sargosh</span></div><section class="card" aria-labelledby="heading"><div class="status" aria-hidden="true">${success ? '&#10003;' : '!'}</div><h1 id="heading">${heading}</h1><p>${description}</p><p class="hint">You can close this tab.</p></section><footer>Speak freely. Stay in your flow.</footer></main></body></html>`;
}
