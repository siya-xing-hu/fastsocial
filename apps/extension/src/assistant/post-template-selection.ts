import type { PostTemplateSelection, PostTemplateSummary, SkillKey } from '@fast-social/contracts';

export function showPostTemplateSelection(explicitSkill?: SkillKey, previousSkill?: SkillKey): boolean {
  return explicitSkill === 'post' || (!explicitSkill && previousSkill === 'post');
}

export function validatePostTemplateSelection(selection: PostTemplateSelection | undefined, templates: readonly PostTemplateSummary[] | undefined): void {
  if (!selection) return;
  const current = templates?.find(template => template.id === selection.id);
  if (!current) throw new Error('所选发帖模板已失效或无法读取，请重新选择模板后发送。');
  if (!selection.revision || current.revision !== selection.revision)
    throw new Error('所选发帖模板已更新，请重新选择后发送新消息；重试会保留原模板版本。');
}

/** Freeze references before page reads; retries use the original message, including no selection. */
export function freezePostTemplateSelection(
  selected: PostTemplateSelection | undefined,
  templates: readonly PostTemplateSummary[] | undefined,
  skill?: SkillKey,
  retry?: { postTemplate?: PostTemplateSelection },
): PostTemplateSelection | undefined {
  if (skill && skill !== 'post') return undefined;
  const original = retry ? retry.postTemplate : selected;
  if (!original) return undefined;
  if (!original.id || !original.revision) throw new Error('所选发帖模板缺少版本信息，请重新选择模板后发送新消息。');
  const selection = { id: original.id, revision: original.revision };
  // An inferred chat/summary/reply must still reach intent routing. The server
  // validates this exact reference only if it actually chooses the post Skill.
  if (skill === 'post') validatePostTemplateSelection(selection, templates);
  return selection;
}
