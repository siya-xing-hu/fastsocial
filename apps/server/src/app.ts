import Fastify from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { HealthResponse } from "@fast-social/contracts";
import type { SocialAdapter } from "./adapters/social-adapter.ts";
import { XAdapter } from "./adapters/x/x-adapter.ts";
import { XClient, type FetchLike } from "./adapters/x/x-client.ts";
import { AIGateway } from "./ai/ai-gateway.ts";
import { AIMatcher } from "./ai/ai-matcher.ts";
import { OpenAICompatibleClient } from "./ai/openai-compatible-client.ts";
import { openDatabase } from "./db/database.ts";
import { ValidationError } from "./http/validation.ts";
import { MonitorRepository } from "./repositories/monitor-repository.ts";
import { MonitorRunner } from "./monitor/monitor-runner.ts";
import { MonitorScheduler } from "./monitor/scheduler.ts";
import { SettingsRepository } from "./repositories/settings-repository.ts";
import { registerMonitorRoutes } from "./routes/monitors.ts";
import { registerAIRoutes } from "./routes/ai.ts";
import { registerSettingsRoutes } from "./routes/settings.ts";
import { registerTestRoutes } from "./routes/tests.ts";
import { TelegramNotifier } from "./telegram/telegram-notifier.ts";

export interface AppOptions {
  version?: string;
  startedAt?: number;
  database?: DatabaseSync;
  databasePath?: string;
  fetchImpl?: FetchLike;
  socialAdapter?: SocialAdapter;
  startScheduler?: boolean;
}

export function createApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false });
  const version = options.version ?? "1.0.0";
  const startedAt = options.startedAt ?? Date.now();
  const database = options.database ?? openDatabase(options.databasePath ?? ":memory:");
  const settingsRepository = new SettingsRepository(database);
  const monitorRepository = new MonitorRepository(database);
  const fetchImpl = options.fetchImpl ?? fetch;
  const social = options.socialAdapter ?? new XAdapter(new XClient(settingsRepository, fetchImpl));
  const ai = new AIGateway(
    settingsRepository,
    new OpenAICompatibleClient(fetchImpl),
  );
  const telegram = new TelegramNotifier(settingsRepository, fetchImpl);
  const matcher = new AIMatcher(ai);
  const runner = new MonitorRunner({ monitors: monitorRepository, social, matcher, telegram });
  const scheduler = new MonitorScheduler(monitorRepository, runner);

  app.setErrorHandler((error, _request, reply) => {
    const validationError = error instanceof ValidationError;
    reply.code(validationError ? 400 : 500).send({
      ok: false,
      error: {
        code: validationError ? error.code : "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "服务执行失败",
      },
    });
  });

  app.get("/health", async (): Promise<HealthResponse> => ({
    ok: true,
    version,
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    database: "ok",
  }));

  registerSettingsRoutes(app, settingsRepository);
  registerMonitorRoutes(app, monitorRepository, runner);
  registerAIRoutes(app, ai, settingsRepository);
  registerTestRoutes(app, { social, ai, telegram });

  app.addHook("onClose", async () => {
    scheduler.stop();
    database.close();
  });

  if (options.startScheduler) scheduler.start();

  return app;
}
