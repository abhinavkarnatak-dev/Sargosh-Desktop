import { createServer } from './app';
import { loadServerConfig } from './config';
const settings=loadServerConfig();
const server = createServer(settings);
const port=settings.hostedMode?Number(process.env.PORT||10000):4318;
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid API port.');
server.listen({ host: settings.hostedMode?'0.0.0.0':'127.0.0.1', port }).then(() => console.log('Sargosh API is ready.')).catch(() => { console.error('Sargosh API could not start.'); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void server.close().then(() => process.exit(0)); });
