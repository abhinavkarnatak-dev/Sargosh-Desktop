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
export function splashMarkup(logoBase64: string, theme: 'dark' | 'light') {
  if (!/^[A-Za-z0-9+/=]+$/.test(logoBase64)) throw new Error('Invalid splash logo.');
  const dark = theme === 'dark';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Sargosh</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:"Segoe UI Variable","Segoe UI",sans-serif;background:${dark ? '#191b18' : '#ffffff'};color:${dark ? '#eeeee8' : '#232622'};color-scheme:${theme};display:grid;place-items:center;border:1px solid ${dark ? '#30352e' : '#e8e7e0'};-webkit-app-region:drag}main{text-align:center}img{display:block;width:108px;height:108px;object-fit:contain;margin:0 auto 14px}h1{font-size:23px;font-weight:500;letter-spacing:.1px;margin:0 0 10px}p{font-size:12px;color:${dark ? '#9b9f94' : '#777c70'};margin:0}.loader{height:3px;width:96px;border-radius:4px;overflow:hidden;background:${dark ? '#30352e' : '#eeede7'};margin:28px auto 0}.loader span{display:block;width:38%;height:100%;border-radius:4px;background:${dark ? '#8ec2b4' : '#397b6a'};animation:loading 1.2s ease-in-out infinite}@keyframes loading{0%{transform:translateX(-110%)}100%{transform:translateX(370%)}}@media(prefers-reduced-motion:reduce){.loader span{animation:none;transform:translateX(80%)}}
</style></head><body><main><img src="data:image/png;base64,${logoBase64}" alt=""><h1>Sargosh</h1><p role="status">Opening Sargosh...</p><div class="loader" aria-hidden="true"><span></span></div></main></body></html>`;
}
