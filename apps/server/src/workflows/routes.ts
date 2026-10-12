import type { FastifyInstance } from "fastify";
import type { WorkflowAction, WorkflowInput } from "@fast-social/contracts";
import { RANDOM_WORKFLOW_ACCOUNT, replyElements } from "@fast-social/contracts";
import { record, string } from "../configuration/routes.ts";
import type { SettingsRepository } from "../repositories/settings-repository.ts";
import { ValidationError } from "../http/validation.ts";
import type { WorkflowRepository } from "./repository.ts";
import type { WorkflowService } from "./service.ts";
export function validateWorkflow(
  value: unknown,
  settings: SettingsRepository
): WorkflowInput {
  const r = record(value),
    accountId = r.accountId === undefined ? RANDOM_WORKFLOW_ACCOUNT : string(r.accountId, "执行账号");
  if (accountId !== RANDOM_WORKFLOW_ACCOUNT && !settings.configuration.accounts().some((a) => a.id === accountId))
    throw new ValidationError("执行账号不存在");
  if (!["user", "home"].includes(String(r.source)))
    throw new ValidationError("监听来源无效");
  if (r.source === 'home' && accountId === RANDOM_WORKFLOW_ACCOUNT) throw new ValidationError('账号首页监听需要指定账号');
  if (
    !Array.isArray(r.usernames) ||
    r.usernames.some(
      (u) => typeof u !== "string" || !/^@?[A-Za-z0-9_]{1,15}$/.test(u)
    )
  )
    throw new ValidationError("用户名列表无效");
  const usernames = [
    ...new Set(
      (r.usernames as string[]).map((u) => u.replace(/^@/, "").toLowerCase())
    ),
  ];
  if (
    r.source === "user" && usernames.length !== 1
  )
    throw new ValidationError("请选择有效的监听用户");
  if (
    !Number.isInteger(r.intervalMinutes) ||
    Number(r.intervalMinutes) < 1 ||
    Number(r.intervalMinutes) > 1440
  )
    throw new ValidationError("监听间隔需为 1–1440 分钟");
  if (
    typeof r.enabled !== "boolean" ||
    !Array.isArray(r.actions) ||
    (r.enabled && r.actions.length < 1) ||
    r.actions.length > 10
  )
    throw new ValidationError("最多配置 10 个动作，启用前至少添加一个动作");
  const actions: WorkflowAction[] = r.actions.map((v) => {
    const a = record(v);
    if (a.type === "follow") return { type: "follow" };
    if (a.type === "notify")
      return {
        type: "notify",
        content: typeof a.content === "string" ? a.content.trim() : "",
      };
    if (a.type === "reply") {
      if (a.mode === "text")
        return {
          type: "reply",
          mode: "text",
          text: string(a.text, "回复内容"),
        };
      if (a.mode === "prompt") {
        const promptId = string(a.promptId, "回复模板");
        if (!settings.getInteractionPrompts().some((p) => p.id === promptId))
          throw new ValidationError("回复模板不存在");
        if (
          typeof a.input !== "string" ||
          !["zh-CN", "en"].includes(String(a.targetLanguage))
        )
          throw new ValidationError("回复参数无效");
        return {
          type: "reply",
          mode: "prompt",
          promptId,
          input: a.input,
          targetLanguage: a.targetLanguage as string,
        };
      }
      if (a.mode === "skill") {
        for (const key of ['elements', 'instructions', 'input']) if (a[key] !== undefined && (typeof a[key] !== 'string' || (a[key] as string).length > 10000)) throw new ValidationError('回复要素格式无效，最多 10000 字');
        const elements = replyElements(a as Extract<WorkflowAction, { mode: 'skill' }>).trim();
        if (elements.length > 10000) throw new ValidationError('回复要素最多 10000 字');
        return { type: 'reply', mode: 'skill', elements };
      }
    }
    throw new ValidationError("动作类型无效");
  });
  return {
    name: string(r.name, "编排名称"),
    accountId,
    source: r.source as WorkflowInput["source"],
    usernames: r.source === "home" ? [] : usernames,
    condition: string(r.condition, "判断条件"),
    intervalMinutes: Number(r.intervalMinutes),
    enabled: r.enabled,
    actions,
  };
}
export function registerWorkflowRoutes(
  app: FastifyInstance,
  repo: WorkflowRepository,
  service: WorkflowService,
  settings: SettingsRepository
): void {
  app.get("/api/workflows", async () => ({ ok: true, data: repo.list() }));
  app.get("/api/workflows/runs", async () => ({ ok: true, data: service.runs() }));
  app.get<{ Params: { id: string } }>('/api/workflows/:id/profile', async req => ({ ok: true, data: service.profile(req.params.id) }));
  app.put<{ Params: { id: string }; Body: { text?: unknown } }>('/api/workflows/:id/profile', async req => {
    if (typeof req.body?.text !== 'string') throw new ValidationError('画像必须是文本');
    return { ok: true, data: await service.editProfile(req.params.id, req.body.text) };
  });
  app.post<{ Params: { id: string } }>('/api/workflows/:id/profile/refresh', async (req, reply) => {
    const w = repo.get(req.params.id);
    if (!w) return reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: '编排不存在' } });
    if (w.source !== 'user') throw new ValidationError('仅指定用户监听支持更新画像');
    return { ok: true, data: await service.rebuildProfile(w.id) };
  });
  app.post<{ Params: { id: string } }>("/api/workflows/:id/run", async (req, reply) => {
    const w = repo.get(req.params.id);
    if (!w) return reply.code(404).send({
      ok: false, error: { code: "NOT_FOUND", message: "编排不存在" },
    });
    validateWorkflow(w, settings);
    if (!w.actions.length) throw new ValidationError('请先添加执行动作');
    const run = service.runOnce(w.id);
    if (!run) return reply.code(503).send({
      ok: false, error: { code: "SERVICE_STOPPING", message: "服务正在停止，请稍后重试" },
    });
    return reply.code(202).send({ ok: true, data: run });
  });
  app.post("/api/workflows", async (req) => ({
    ok: true,
    data: repo.save(validateWorkflow(req.body, settings)),
  }));
  app.put<{ Params: { id: string } }>(
    "/api/workflows/:id",
    async (req, reply) => {
      if (!repo.get(req.params.id))
        return reply.code(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "编排不存在" },
        });
      return {
        ok: true,
        data: repo.save(validateWorkflow(req.body, settings), req.params.id),
      };
    }
  );
  app.delete<{ Params: { id: string } }>("/api/workflows/:id", async (req) => {
    repo.remove(req.params.id);
    return { ok: true, data: null };
  });
  app.get<{ Params: { id: string } }>(
    "/api/workflows/:id/records",
    async (req) => ({ ok: true, data: repo.records(req.params.id) })
  );
  app.post<{ Params: { id: string } }>(
    "/api/workflows/:id/preview",
    async (req, reply) => {
      const w = repo.get(req.params.id);
      if (!w)
        return reply.code(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "编排不存在" },
        });
      return {
        ok: true,
        data: await service.preview(
          req.body ? { ...w, ...validateWorkflow(req.body, settings) } : w
        ),
      };
    }
  );
}
