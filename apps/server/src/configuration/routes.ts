import type { FastifyInstance } from "fastify";
import type { AccountInput, PromptInput, AccountHomeTestResult, SocialPost } from "@fast-social/contracts";
import { ValidationError } from "../http/validation.ts";
import type { ConfigurationRepository } from "./repository.ts";
import { validateDailyLimits } from './request-limits.ts';

export const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new ValidationError("请求格式无效");
  return v as Record<string, unknown>;
};
export const string = (v: unknown, label: string): string => {
  if (typeof v !== "string" || !v.trim())
    throw new ValidationError(`请填写${label}`);
  return v.trim();
};
export const ids = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.some((id) => typeof id !== "string" || !id))
    throw new ValidationError("关联列表无效");
  return [...new Set(v)] as string[];
};
export function accountInput(v: unknown): AccountInput {
  const r = record(v),
    username = string(r.username, "用户名").replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username))
    throw new ValidationError("X 用户名格式无效");
  if (r.cookie !== undefined && typeof r.cookie !== "string")
    throw new ValidationError("Cookie 格式无效");
  const preferences = r.assistant === undefined ? undefined : record(r.assistant);
  if (preferences && (typeof preferences.language !== "string" || preferences.language.length > 80
    || typeof preferences.voice !== "string" || preferences.voice.length > 4000))
    throw new ValidationError("写作语言或风格格式无效（风格最多 4000 字）");
  const profile = r.profile === undefined ? undefined : record(r.profile);
  if (profile && (typeof profile.primaryLanguage !== 'string' || !profile.primaryLanguage.trim() || profile.primaryLanguage.length > 80
    || typeof profile.description !== 'string' || profile.description.length > 12000))
    throw new ValidationError('请填写账号主语言，Profile 最多 12000 字');
  if (r.autoTranslate !== undefined && typeof r.autoTranslate !== 'boolean') throw new ValidationError('自动翻译开关无效');
  return {
    name: string(r.name, "账号名称"),
    username,
    ...(r.configIds === undefined ? {} : { configIds: ids(r.configIds) }),
    ...(r.autoTranslate === undefined ? {} : { autoTranslate: r.autoTranslate as boolean }),
    ...(r.dailyLimits === undefined ? {} : { dailyLimits: validateDailyLimits(r.dailyLimits) }),
    ...(profile ? { profile: { primaryLanguage: (profile.primaryLanguage as string).trim(), description: (profile.description as string).trim() } } : {}),
    ...(preferences ? { assistant: { language: (preferences.language as string).trim(), voice: (preferences.voice as string).trim() } } : {}),
    ...(r.cookie !== undefined ? { cookie: r.cookie as string } : {}),
  };
}
export function promptInput(v: unknown): PromptInput {
  const r = record(v);
  if (r.scene !== "post" && r.scene !== "reply")
    throw new ValidationError("Prompt 场景无效");
  return {
    name: string(r.name, "模板名称"),
    scene: r.scene,
    prompt: string(r.prompt, "Prompt 内容"),
    accountIds: ids(r.accountIds),
  };
}
export function registerConfigurationRoutes(
  app: FastifyInstance,
  repo: ConfigurationRepository,
  fetchHomePosts: (accountId: string) => Promise<SocialPost[]>,
): void {
  app.get("/api/accounts", async () => ({ ok: true, data: repo.accounts() }));
  app.get<{ Params: { id: string } }>('/api/accounts/:id/usage', async (req, reply) => {
    if (!repo.accounts().some(a => a.id === req.params.id)) return reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: '账号不存在' } });
    return { ok: true, data: repo.requestLimits.view(req.params.id) };
  });
  app.put<{ Params: { id: string } }>('/api/accounts/:id/translation', async (req, reply) => {
    if (!repo.accounts().some(a => a.id === req.params.id)) return reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: '账号不存在' } });
    const body = record(req.body);
    if (typeof body.enabled !== 'boolean') throw new ValidationError('自动翻译开关无效');
    return { ok: true, data: repo.setAutoTranslate(req.params.id, body.enabled) };
  });
  app.post<{ Params: { id: string } }>("/api/accounts/:id/test", async (req, reply) => {
    const account = repo.accounts().find(a => a.id === req.params.id);
    if (!account) return reply.code(404).send({
      ok: false, error: { code: "NOT_FOUND", message: "账号不存在" },
    });
    const data: AccountHomeTestResult = { accountId: account.id, posts: await fetchHomePosts(account.id) };
    return { ok: true, data };
  });
  app.post("/api/accounts", async (req) => ({
    ok: true,
    data: repo.saveAccount(accountInput(req.body)),
  }));
  app.put<{ Params: { id: string } }>(
    "/api/accounts/:id",
    async (req, reply) => {
      if (!repo.accounts().some((a) => a.id === req.params.id))
        return reply.code(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "账号不存在" },
        });
      return {
        ok: true,
        data: repo.saveAccount(accountInput(req.body), req.params.id),
      };
    }
  );
  app.delete<{ Params: { id: string } }>("/api/accounts/:id", async (req) => {
    repo.deleteAccount(req.params.id);
    return { ok: true, data: null };
  });
  app.post("/api/prompts", async (req) => ({
    ok: true,
    data: repo.savePrompt(promptInput(req.body)),
  }));
  app.put<{ Params: { id: string } }>(
    "/api/prompts/:id",
    async (req, reply) => {
      if (!repo.prompts().some((p) => p.id === req.params.id))
        return reply.code(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "模板不存在" },
        });
      return {
        ok: true,
        data: repo.savePrompt(promptInput(req.body), req.params.id),
      };
    }
  );
  app.delete<{ Params: { id: string } }>("/api/prompts/:id", async (req) => {
    repo.deletePrompt(req.params.id);
    return { ok: true, data: null };
  });
  app.get<{ Querystring: { actorId?: string; username?: string } }>(
    "/api/account-config",
    async (req) => ({
      ok: true,
      data: repo.resolve(req.query.actorId ?? "", req.query.username ?? ""),
    })
  );
}
