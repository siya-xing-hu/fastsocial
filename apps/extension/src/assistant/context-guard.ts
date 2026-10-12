import type { AssistantContext, SkillKey } from "@fast-social/contracts";
import { sameAccount } from "./conversations.ts";

export function draftError(frozen: AssistantContext, current: AssistantContext, skill: SkillKey): string | null {
  if (skill === "summary") return "总结结果请使用复制。";
  if (frozen.documentId !== current.documentId || frozen.url !== current.url)
    return "页面已变化，请在当前页面重新生成，或复制这条文案。";
  if (!sameAccount(frozen.account, current.account) || (!current.account.actorId && !current.account.username))
    return "账号已切换或无法识别，请在当前账号重新生成文案。";
  if (!current.composer) return "请先打开 X 的发帖或回复输入框，再点击填入。";
  if (current.composer.scene !== skill) return "当前输入框与任务类型不符，请打开对应的发帖或回复框。";
  if (skill === "reply" && (!frozen.target || current.composer.targetId !== frozen.target.id))
    return "回复对象已变化或无法确认，请打开选定原帖的回复框。";
  if (frozen.composer && frozen.composer.id !== current.composer.id) return "原输入框已关闭，请重新生成文案，或复制这条结果。";
  if (current.composer.text !== (frozen.composer?.text ?? "")) return "X 草稿已被修改，未覆盖内容。请复制结果或重新生成。";
  return null;
}

export function parseSkillCommand(text: string): { skill?: SkillKey; input: string; error?: string } {
  const match = /^\/(\S+)(?:\s+|$)/.exec(text.trim());
  if (!match) return text.trim().startsWith("/") ? { input: text, error: "请选择 /summary、/post 或 /reply" } : { input: text.trim() };
  if (!["summary", "post", "reply"].includes(match[1])) return { input: text, error: "可用命令：/summary、/post、/reply" };
  return { skill: match[1] as SkillKey, input: text.trim().slice(match[0].length).trim() };
}
