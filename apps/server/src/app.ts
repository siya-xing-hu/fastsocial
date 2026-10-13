import { WorkflowRepository } from "./workflows/repository.ts";
import { WorkflowService } from "./workflows/service.ts";
import { generateWorkflowReply } from "./workflows/reply.ts";
import { registerWorkflowRoutes } from "./workflows/routes.ts";
import { WorkflowMatcher } from "./workflows/matcher.ts";
import { FollowingRepository } from './following/repository.ts';
import { FollowingService } from './following/service.ts';
import { registerFollowingRoutes } from './following/routes.ts';
import { memoryText } from './ai/batch-matcher.ts';
import { portraitInput } from './ai/portrait.ts';
import { AccountRequestLimitError } from './configuration/request-limits.ts';
import { registerConfigurationRoutes } from "./configuration/routes.ts";
import Fastify from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { LOCAL_SERVICE_API_VERSION, type HealthResponse } from "@fast-social/contracts";
import type { SocialAdapter } from "./adapters/social-adapter.ts";
import { XAdapter } from "./adapters/x/x-adapter.ts";
import { XClient, type FetchLike } from "./adapters/x/x-client.ts";
import { XRequestQueue } from './adapters/x/request-queue.ts';
import { AIGateway } from "./ai/ai-gateway.ts";
import { BatchMatcher } from "./ai/batch-matcher.ts";
import { AccountRepository } from "./repositories/account-repository.ts";
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
import { OutreachRepository } from "./outreach/repository.ts";
import { OutreachService } from "./outreach/service.ts";
import { OutreachXClient } from "./outreach/x-client.ts";
import { MutualFollowClassifier } from "./outreach/classifier.ts";
import { registerOutreachRoutes } from "./outreach/routes.ts";
import { AssistantRepository } from "./assistant/repository.ts";
import { AssistantService } from "./assistant/service.ts";
import { registerAssistantRoutes } from "./assistant/routes.ts";
import { ExecutionLogger, trace, errorDetails, type TraceSink } from './observability/trace.ts';

export interface AppOptions {
  version?: string;
  startedAt?: number;
  database?: DatabaseSync;
  databasePath?: string;
  fetchImpl?: FetchLike;
  socialAdapter?: SocialAdapter;
  startScheduler?: boolean;
  xRequestQueue?: XRequestQueue;
  traceSink?: TraceSink;
}

export function createApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false });
  const logger = new ExecutionLogger(options.traceSink);
  app.addHook('onRequest', (request, _reply, done) => {
    logger.run({ traceId: request.id, route: request.url, method: request.method }, done);
  });
  const version = options.version ?? "1.0.0";
  const startedAt = options.startedAt ?? Date.now();
  const database =
    options.database ?? openDatabase(options.databasePath ?? ":memory:");
  const settingsRepository = new SettingsRepository(database);
  const monitorRepository = new MonitorRepository(database);
  const fetchImpl = options.fetchImpl ?? fetch;
  const xRequests = options.xRequestQueue ?? new XRequestQueue();
  const xFetch = logger.fetch('X', fetchImpl);
  const xClient = new XClient(settingsRepository, xRequests, xFetch);
  const social =
    options.socialAdapter ??
    new XAdapter(xClient);
  const ai = new AIGateway(
    settingsRepository,
    new OpenAICompatibleClient(logger.fetch('AI', fetchImpl))
  );
  const telegram = new TelegramNotifier(settingsRepository, logger.fetch('Telegram', fetchImpl));
  const matcher = new BatchMatcher(ai);
  const accounts = new AccountRepository(database);
  const runner = new MonitorRunner({
    monitors: monitorRepository,
    social,
    matcher,
    telegram,
    accounts,
  });
  const scheduler = new MonitorScheduler(monitorRepository, runner);
  const workflowRepository = new WorkflowRepository(database);
  const assistantRepository = new AssistantRepository(database);
  const socialActions = new OutreachXClient(settingsRepository, xRequests, xFetch);
  const followingService = new FollowingService(new FollowingRepository(database), settingsRepository, socialActions, async (accountId, profile) => {
    const page = await xClient.fetchTimelinePage(profile.account, undefined, 'posts', accountId);
    const input = portraitInput(profile.account, page.posts);
    const result = await matcher.analyze(input);
    const evidenceIds = new Set(Object.values(result.memory ?? {}).flatMap(fact => fact.evidenceIds));
    return { summary: result.memory ? memoryText(result.memory) : '', summaryEvidence: input.posts.filter(post => evidenceIds.has(post.id)) };
  });
  const trackedActions = {
    identity: socialActions.identity.bind(socialActions), home: socialActions.home.bind(socialActions),
    follow: followingService.follow.bind(followingService), reply: socialActions.reply.bind(socialActions), relationship: socialActions.relationship.bind(socialActions),
    followSkipReason: followingService.followSkipReason.bind(followingService),
  };
  const outreach = new OutreachService(new OutreachRepository(database), trackedActions, new MutualFollowClassifier(ai));
  const assistantService = new AssistantService(assistantRepository, settingsRepository.configuration, ai, xClient);
  const workflowMatcher = new WorkflowMatcher(ai);
  const workflowService = new WorkflowService({
    logger,
    deferPortraits: followingService.deferPortraits.bind(followingService),
    userListener: runner,
    repository: workflowRepository,
    settings: settingsRepository,
    x: trackedActions,
    timeline: (username, accountId) =>
      social.fetchRecentPosts(username, accountId),
    userId: async (username, accountId) =>
      (await xClient.fetchAccount(username, accountId)).id,
    evaluateBatch: (condition, posts, ensureCurrent, report) => workflowMatcher.evaluate(condition, posts, ensureCurrent, report),
    generate: (prompt) =>
      ai.complete(undefined, [{ role: "user", content: prompt }]),
    generateReply: (accountId, post, action, profile) => generateWorkflowReply(assistantService, settingsRepository.configuration, accountId, post, action, profile ?? accounts.profileByUsername(post.author.replace(/^@/, ''))),
    notify: (content, post) => telegram.send(content, post),
  });

  app.setErrorHandler((error, _request, reply) => {
    trace('operation.error', '接口操作失败', { error: errorDetails(error) });
    const validationError = error instanceof ValidationError;
    reply.code(validationError ? 400 : error instanceof AccountRequestLimitError ? 429 : 500).send({
      ok: false,
      error: {
        code: validationError || error instanceof AccountRequestLimitError ? error.code : "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "服务执行失败",
      },
    });
  });

  app.get(
    "/health",
    async (): Promise<HealthResponse> => ({
      ok: true,
      apiVersion: LOCAL_SERVICE_API_VERSION,
      version,
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
      database: "ok",
    })
  );

  registerSettingsRoutes(app, settingsRepository);
  registerAssistantRoutes(app, assistantRepository, assistantService);
  registerConfigurationRoutes(app, settingsRepository.configuration, accountId => xClient.fetchHomePosts(accountId));
  registerFollowingRoutes(app, followingService);
  registerWorkflowRoutes(
    app,
    workflowRepository,
    workflowService,
    settingsRepository
  );
  registerMonitorRoutes(app, monitorRepository, runner, accounts);
  registerAIRoutes(app, ai, settingsRepository);
  registerTestRoutes(app, { social, ai, telegram });
  registerOutreachRoutes(app, outreach);

  app.addHook('preClose', async () => { xRequests.stop(); });
  app.addHook("onClose", async () => {
    scheduler.stop();
    await outreach.stop();
    await workflowService.stop();
    await followingService.stop();
    database.close();
  });

  if (options.startScheduler) logger.run({ component: 'startup' }, () => { followingService.start(); workflowService.start(); });

  return app;
}
