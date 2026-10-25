import Fastify from 'fastify';
export function createServer() {
  const server = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  server.get('/health', async () => ({ status: 'ok', service: 'sargosh-api', version: '0.1.0' }));
  server.get('/v1/readiness', async () => ({ auth: false, stt: false, cleanup: false }));
  // Fail closed until authentication, allowances, and providers are connected together.
  server.post('/v1/transcriptions', async (_request, reply) => reply.code(503).send({ code: 'NOT_CONFIGURED', message: 'Cloud dictation is not connected in this development build.' }));
  return server;
}
