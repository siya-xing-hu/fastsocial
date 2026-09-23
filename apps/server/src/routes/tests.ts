import type { FastifyInstance } from "fastify";
import type { AIGateway } from "../ai/ai-gateway.ts";
import type { SocialAdapter } from "../adapters/social-adapter.ts";
import { ValidationError } from "../http/validation.ts";
import type { TelegramNotifier } from "../telegram/telegram-notifier.ts";

export function registerTestRoutes(
  app: FastifyInstance,
  dependencies: {
    social: SocialAdapter;
    ai: AIGateway;
    telegram: TelegramNotifier;
  },
): void {
  app.post("/api/test/x", async (request) => {
    const body = asObject(request.body);
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    if (!username) throw new ValidationError("请填写 X 用户名");
    const cookieId = typeof body?.cookieId === "string" ? body.cookieId.trim() : "";
    const posts = await dependencies.social.fetchRecentPosts(
      username,
      cookieId || undefined,
    );
    return { ok: true, data: { username: username.replace(/^@/, ""), posts: posts.slice(0, 3) } };
  });

  app.post("/api/test/ai", async (request) => {
    const body = asObject(request.body);
    const content = await dependencies.ai.complete(
      typeof body?.provider === "string" ? body.provider : undefined,
      [{ role: "user", content: "只回复 OK" }],
    );
    return { ok: true, data: { content } };
  });

  app.post("/api/test/telegram", async () => {
    await dependencies.telegram.send("Fast Social 测试消息：本地监控服务已连接。 ");
    return { ok: true, data: { sent: true } };
  });
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
