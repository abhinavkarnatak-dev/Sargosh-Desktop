import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { COMPLETION_CSP, googleCompletionPage } from './google-completion-page';
export const GOOGLE_CALLBACK_ORIGIN = 'http://127.0.0.1:48123';
export class GoogleCallback {
  constructor(private port = 48123) {}
  private server?: Server; private timer?: ReturnType<typeof setTimeout>;
  async listen(onCode: (code: string) => Promise<void>, onTimeout: () => void) {
    this.close(); let port = this.port; const callbackPath = '/auth/callback/' + randomBytes(24).toString('hex'); let claimed = false;
    const server = createServer((request, reply) => {
      reply.setHeader('Cache-Control', 'no-store'); reply.setHeader('Content-Type', 'text/html; charset=utf-8');
      reply.setHeader('Content-Security-Policy', COMPLETION_CSP); reply.setHeader('Referrer-Policy', 'no-referrer');
      if (request.method !== 'GET' || request.headers.host !== '127.0.0.1:' + port || !request.url || request.url.length > 12000) { reply.writeHead(400); reply.end('Invalid sign-in callback.'); return; }
      const url = new URL(request.url, 'http://127.0.0.1:' + port); const code = url.searchParams.get('code');
      if (!claimed && url.pathname === callbackPath && url.searchParams.has('error')) { claimed = true; reply.end(googleCompletionPage(false)); this.close(); onTimeout(); return; }
      if (claimed || url.pathname !== callbackPath || !code || code.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(code)) { reply.writeHead(400); reply.end('Sign-in did not finish. Return to Sargosh and try again.'); return; }
      claimed = true;
      void onCode(code).then(() => reply.end(googleCompletionPage(true)), () => { reply.writeHead(400); reply.end(googleCompletionPage(false)); }).finally(() => this.close());
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.port, '127.0.0.1', () => { port = (server.address() as import('node:net').AddressInfo).port; server.removeListener('error', reject); resolve(); }); });
    this.timer = setTimeout(() => { this.close(); onTimeout(); }, 5 * 60_000); this.timer.unref();
    return 'http://127.0.0.1:' + port + callbackPath;
  }
  close() { clearTimeout(this.timer); this.timer = undefined; this.server?.close(); this.server?.closeIdleConnections(); this.server = undefined; }
}
