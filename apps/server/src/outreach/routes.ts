import type { FastifyInstance } from 'fastify';
import type { OutreachService } from './service.ts';

export function registerOutreachRoutes(app: FastifyInstance, service: OutreachService) {
  app.get('/api/outreach', async () => ({ ok: true, data: service.list() }));
  app.post('/api/outreach/accounts', async (request, reply) => {
    const data = service.create(request.body);
    reply.code(201);
    return { ok: true, data };
  });
  app.register(async scoped => {
    scoped.addHook('preHandler', async (request, reply) => {
      if (!service.has((request.params as { id: string }).id)) reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: '互关账户不存在' } });
    });
    scoped.get<{ Params: { id: string } }>('/api/outreach/accounts/:id', async request => ({ ok: true, data: service.view(request.params.id) }));
    scoped.put<{ Params: { id: string } }>('/api/outreach/accounts/:id', async request => ({ ok: true, data: service.update(request.params.id, request.body) }));
    scoped.put<{ Params: { id: string }; Body: { enabled?: unknown } }>('/api/outreach/accounts/:id/enabled', async request => ({ ok: true, data: service.toggle(request.params.id, request.body?.enabled) }));
    scoped.delete<{ Params: { id: string } }>('/api/outreach/accounts/:id', async request => {
      service.remove(request.params.id);
      return { ok: true, data: { deleted: true } };
    });
    for (const [path, action] of [['check', 'startChecks'], ['check/stop', 'stopChecks'], ['resume', 'resume']] as const) {
      scoped.post<{ Params: { id: string } }>(`/api/outreach/accounts/:id/${path}`, async request => ({ ok: true, data: service[action](request.params.id) }));
    }
  });
}
