import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { SKILL_KEYS, type SkillKey } from '@fast-social/contracts';
import { ValidationError } from '../http/validation.ts';

export function parseSkillDocument(document: string, key: SkillKey): { description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(document);
  if (!match) throw new ValidationError('SKILL.md 需要以包含 name 和 description 的 YAML 元数据开头');
  let metadata: unknown;
  try { metadata = parse(match[1], { maxAliasCount: 0 }); }
  catch { throw new ValidationError('SKILL.md 的 YAML 元数据格式无效'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new ValidationError('Skill 元数据无效');
  const { name, description } = metadata as Record<string, unknown>;
  if (name !== key) throw new ValidationError(`Skill 的 name 必须保持为 ${key}`);
  if (typeof description !== 'string' || !description.trim() || description.length > 1200)
    throw new ValidationError('请在 description 中填写 Skill 的用途与适用场景（最多 1200 字符）');
  if (!match[2].trim()) throw new ValidationError('请填写 Skill 的执行文档');
  return { description: description.trim(), body: match[2].trim() };
}

// build.mjs copies the same skill folders beside the bundled server entry point.
export function loadBuiltinSkills(): Record<SkillKey, string> {
  return Object.fromEntries(SKILL_KEYS.map(key => {
    const document = readFileSync(new URL(`./skills/${key}/SKILL.md`, import.meta.url), 'utf8');
    parseSkillDocument(document, key);
    return [key, document];
  })) as Record<SkillKey, string>;
}
