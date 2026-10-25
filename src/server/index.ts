import { createServer } from './app';
const server = createServer();
server.listen({ host: '127.0.0.1', port: 4318 }).then(() => console.log('Sargosh API: http://127.0.0.1:4318')).catch(error => { console.error(error); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void server.close().then(() => process.exit(0)); });
