import { createHash } from 'node:crypto';
import { animatedLogo, LOGO_ANIMATION_SCRIPT } from './animated-logo';
// A window being paintable and its React screen being ready are separate events.
export class StartupGate {
  private paint = false;
  private screen = false;
  private stopped = false;
  complete = false;
  constructor(private reveal: () => void) {}
  painted() { this.paint = true; this.check(); }
  rendered() { this.screen = true; this.check(); }
  cancel() { this.stopped = true; }
  private check() {
    if (this.stopped || this.complete || !this.paint || !this.screen) return;
    this.complete = true; this.reveal();
  }
}
export function splashMarkup(theme: 'dark' | 'light') {
  const dark = theme === 'dark';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash('sha256').update(LOGO_ANIMATION_SCRIPT).digest('base64')}'; base-uri 'none'; form-action 'none'"><title>Sargosh</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:"Segoe UI Variable","Segoe UI",sans-serif;background:${dark ? '#111813' : '#eeeee6'};color:${dark ? '#edf0e8' : '#233327'};color-scheme:${theme};display:grid;place-items:center;border:1px solid ${dark ? '#2b392d' : '#d6dccd'};-webkit-app-region:drag}main{text-align:center}.animated-logo{display:block;width:72px;height:72px;color:${dark ? '#edf0e8' : '#233327'};margin:0 auto 14px}h1{font-size:27px;font-weight:700;letter-spacing:-1.4px;line-height:1;margin:0 0 10px}.brand-period{color:${dark ? '#bbd5a5' : '#375b3b'}}p{font-size:12px;color:${dark ? '#a5afa3' : '#687461'};margin:0}.loader{height:3px;width:96px;border-radius:4px;overflow:hidden;background:${dark ? '#2b392d' : '#d6dccd'};margin:28px auto 0}.loader span{display:block;width:38%;height:100%;border-radius:4px;background:${dark ? '#bbd5a5' : '#375b3b'};animation:loading 1.2s ease-in-out infinite}@keyframes loading{0%{transform:translateX(-110%)}100%{transform:translateX(370%)}}@media(prefers-reduced-motion:reduce){.loader span{animation:none;transform:translateX(80%)}}
</style></head><body><main>${animatedLogo()}<h1>sargosh<span class="brand-period">.</span></h1><p role="status">Opening Sargosh...</p><div class="loader" aria-hidden="true"><span></span></div></main><script>${LOGO_ANIMATION_SCRIPT}</script></body></html>`;
}
