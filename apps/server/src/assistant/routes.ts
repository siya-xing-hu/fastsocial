import type { FastifyInstance } from "fastify";
import { SKILL_KEYS, type AssistantChatRequest, type AssistantContext, type PagePost, type SkillKey } from "@fast-social/contracts";
import { record } from "../configuration/routes.ts";
import { ValidationError } from "../http/validation.ts";
import type { AssistantRepository } from "./repository.ts";
import type { AssistantService } from "./service.ts";

function text(v: unknown, max: number, required = false): string {
  if (typeof v !== "string" || v.length > max || (required && !v.trim())) throw new ValidationError("助手请求包含无效或过长的文本");
  return v;
}
function skillKey(v: unknown): SkillKey {
  if (!SKILL_KEYS.includes(v as SkillKey)) throw new ValidationError("Skill 不存在");
  return v as SkillKey;
}
function identity(v: unknown): AssistantContext['account'] {
  const a = record(v);
  if (a.blueVerified !== undefined && typeof a.blueVerified !== 'boolean') throw new ValidationError('账号认证信息无效');
  return { actorId: text(a.actorId, 40), username: text(a.username, 30), ...(a.displayName === undefined ? {} : { displayName: text(a.displayName, 120) }), ...(a.blueVerified === undefined ? {} : { blueVerified: a.blueVerified }) };
}
function xUrl(v: unknown): string {
  const value = text(v, 2000, true);
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && (url.hostname === "x.com" || url.hostname.endsWith(".x.com"))) return value;
  } catch { /* Report a validation error below. */ }
  throw new ValidationError("目前仅支持 X / Twitter 页面");
}
function post(v: unknown): PagePost {
  const p = record(v);
  const id = text(p.id, 40, true), url = xUrl(p.url);
  if (!/^\d+$/.test(id) || !/^\/[A-Za-z0-9_]+\/status\/\d+(?:\/|$)/.test(new URL(url).pathname) || new URL(url).pathname.split("/")[3] !== id) throw new ValidationError("原帖标识无效");
  return { id, url, author: text(p.author, 200), text: text(p.text, 6000) };
}
export function chatInput(v: unknown): AssistantChatRequest {
  const r = record(v), c = record(r.context), a = record(c.account);
  if (!Array.isArray(c.posts) || c.posts.length > 20 || !Array.isArray(r.history) || r.history.length > 24)
    throw new ValidationError("引用内容或对话过长，请开始新对话");
  const editor = c.composer == null ? null : record(c.composer);
  if (editor && editor.scene !== "post" && editor.scene !== "reply") throw new ValidationError("编辑器场景无效");
  const context: AssistantContext = {
    documentId: text(c.documentId, 100, true), url: xUrl(c.url), title: text(c.title, 500),
    account: identity(a),
    selection: text(c.selection, 8000), posts: c.posts.map(post), target: c.target == null ? null : post(c.target),
    composer: editor ? { id: text(editor.id, 100, true), scene: editor.scene as "post" | "reply", text: text(editor.text, 50000), targetId: editor.targetId == null ? null : text(editor.targetId, 40, true) } : null,
  };
  const history = r.history.map(item => {
    const m = record(item);
    if (m.role !== "user" && m.role !== "assistant") throw new ValidationError("对话角色无效");
    if (m.reference !== undefined && m.role !== 'user') throw new ValidationError('页面引用只能附在用户消息上');
    return { role: m.role, content: text(m.content, 50000, true),
      ...(m.skill === undefined ? {} : { skill: skillKey(m.skill) }),
      ...(m.reference === undefined ? {} : { reference: text(m.reference, 16000, true) }) } as const;
  });
  if (history.reduce((n, m) => n + m.content.length + (m.reference?.length ?? 0), 0) > 60000) throw new ValidationError("对话过长，请开始新对话");
  return { skill: r.skill === undefined ? undefined : skillKey(r.skill), ...(r.previousSkill === undefined ? {} : { previousSkill: skillKey(r.previousSkill) }), input: text(r.input, 8000, true), targetLanguage: text(r.targetLanguage, 80), history, context };
}
export function registerAssistantRoutes(app: FastifyInstance, repo: AssistantRepository, service: AssistantService): void {
  app.get<{ Querystring: { actorId?: string; username?: string } }>("/api/assistant/catalog", async req => ({ ok: true, data: service.catalog(req.query.actorId ?? "", req.query.username ?? "") }));
  app.get('/api/assistant/skills', async () => ({ ok: true, data: repo.list() }));
  app.put<{ Params: { key: string } }>("/api/assistant/skills/:key", async req => {
    const r = record(req.body), key = skillKey(req.params.key);
    return { ok: true, data: repo.update(key, text(r.instructions, 32000, true), text(r.revision, 64, true)) };
  });
  app.patch<{ Params: { key: string } }>('/api/assistant/skills/:key', async req => {
    const r = record(req.body);
    if (typeof r.enabled !== 'boolean') throw new ValidationError('Skill 启用状态无效');
    return { ok: true, data: repo.setEnabled(skillKey(req.params.key), r.enabled) };
  });
  app.post('/api/assistant/posting-policy', async req => ({ ok: true, data: await service.postingPolicy(identity(req.body)) }));
  app.post("/api/assistant/chat", async req => ({ ok: true, data: await service.chat(chatInput(req.body)) }));
}
