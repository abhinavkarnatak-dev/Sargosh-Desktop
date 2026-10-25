import { randomBytes } from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => {
  const nonce = randomBytes(18).toString('base64');
  return {
    root: 'src/renderer', base: './',
    html: command === 'serve' ? { cspNonce: nonce } : undefined,
    plugins: [react(), {
      name: 'sargosh-development-csp', apply: 'serve',
      transformIndexHtml: { order: 'post', handler: html => html.replace("script-src 'self'", "script-src 'self' 'nonce-" + nonce + "'") }
    }],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:4318', rewrite: requestPath => requestPath.replace(/^\/api/, '') } } },
    build: { outDir: '../../dist/renderer', emptyOutDir: true }
  };
});
