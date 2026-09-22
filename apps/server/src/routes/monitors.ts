import type { FastifyInstance } from "fastify";
import type { ApiSuccess, Monitor } from "@fast-social/contracts";
import {
  validateCreateMonitor,
  validateUpdateMonitor,
} from "../http/validation.ts";
import type { MonitorRepository } from "../repositories/monitor-repository.ts";
import type { MonitorRunner } from "../monitor/monitor-runner.ts";

export function registerMonitorRoutes(
  app: FastifyInstance,
  repository: MonitorRepository,
  runner?: MonitorRunner,
): void {
  app.get("/api/monitors", async (): Promise<ApiSuccess<Monitor[]>> => ({
    ok: true,
    data: repository.list(),
  }));

  app.post("/api/monitors", async (request, reply) => {
    const monitor = repository.create(validateCreateMonitor(request.body));
    reply.code(201);
    return { ok: true, data: monitor } satisfies ApiSuccess<Monitor>;
  });

  app.put<{ Params: { id: string } }>("/api/monitors/:id", async (request, reply) => {
    const monitor = repository.update(
      request.params.id,
      validateUpdateMonitor(request.body),
    );
    if (!monitor) {
      reply.code(404);
      return { ok: false, error: { code: "NOT_FOUND", message: "监控规则不存在" } };
    }
    return { ok: true, data: monitor } satisfies ApiSuccess<Monitor>;
  });

  app.delete<{ Params: { id: string } }>("/api/monitors/:id", async (request, reply) => {
    if (!repository.delete(request.params.id)) {
      reply.code(404);
      return { ok: false, error: { code: "NOT_FOUND", message: "监控规则不存在" } };
    }
    return { ok: true, data: { deleted: true } };
  });

  app.post<{ Params: { id: string } }>("/api/monitors/:id/run", async (request, reply) => {
    if (!repository.get(request.params.id)) {
      reply.code(404);
      return { ok: false, error: { code: "NOT_FOUND", message: "监控规则不存在" } };
    }
    if (!runner) throw new Error("监控执行器未初始化");
    return { ok: true, data: await runner.test(request.params.id) };
  });
}
