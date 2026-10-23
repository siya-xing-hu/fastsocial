import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { POST_TEMPLATE_CONTENT_MAX, POST_TEMPLATE_NAME_MAX, type PostTemplate, type PostTemplateInput, type PostTemplateSelection, type PostTemplateSummary } from '@fast-social/contracts';
import { ValidationError } from '../http/validation.ts';

const SETTINGS_KEY = 'post_templates';

export function postTemplateInput(value: unknown): PostTemplateInput {
  if (!isObject(value)) throw new ValidationError('文案模板内容无效');
  return { name: templateText(value.name, POST_TEMPLATE_NAME_MAX, '名称'), content: templateText(value.content, POST_TEMPLATE_CONTENT_MAX, '内容') };
}

export function postTemplateSelection(value: unknown): PostTemplateSelection {
  if (!isObject(value) || typeof value.id !== 'string' || !/^[\w-]{1,100}$/.test(value.id)
    || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision)) throw new ValidationError('文案模板选择或版本无效，请重新选择模板');
  return { id: value.id, revision: value.revision };
}

export function postTemplateSummary(template: PostTemplate): PostTemplateSummary {
  return { id: template.id, name: template.name, revision: template.revision, updatedAt: template.updatedAt };
}

export class PostTemplateRepository {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  list(): PostTemplate[] {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(SETTINGS_KEY) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as PostTemplate[] : [];
  }

  summaries(): PostTemplateSummary[] { return this.list().map(postTemplateSummary); }

  create(input: PostTemplateInput): PostTemplate {
    const content = postTemplateInput(input);
    return this.change(templates => {
      const template = { id: randomUUID(), ...content, revision: revision(content), updatedAt: new Date().toISOString() };
      templates.push(template);
      return template;
    });
  }

  update(selection: PostTemplateSelection, input: PostTemplateInput): PostTemplate {
    const selected = postTemplateSelection(selection), content = postTemplateInput(input);
    return this.change(templates => {
      const current = this.current(templates, selected);
      const saved = { ...current, ...content, revision: revision(content), updatedAt: new Date().toISOString() };
      templates[templates.indexOf(current)] = saved;
      return saved;
    });
  }

  delete(selection: PostTemplateSelection): void {
    const selected = postTemplateSelection(selection);
    this.change(templates => {
      const current = this.current(templates, selected);
      templates.splice(templates.indexOf(current), 1);
    });
  }

  require(selection: PostTemplateSelection): PostTemplate {
    return this.current(this.list(), postTemplateSelection(selection), true);
  }

  private current(templates: PostTemplate[], selection: PostTemplateSelection, generating = false): PostTemplate {
    const template = templates.find(item => item.id === selection.id);
    if (!template) throw new ValidationError(generating ? '文案模板已删除或不存在，请重新选择后发送。' : '文案模板已删除或不存在，请刷新列表后重新选择。');
    if (template.revision !== selection.revision) throw new ValidationError(generating ? '文案模板已更新，请重新选择后发送。' : '文案模板已被其他编辑更新，请保留草稿，重新打开后合并。');
    return template;
  }

  private change<T>(work: (templates: PostTemplate[]) => T): T {
    // The whole list is one settings value; lock the read/write pair so concurrent edits cannot erase each other.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const templates = this.list(), result = work(templates);
      this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(SETTINGS_KEY, JSON.stringify(templates));
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

function revision(input: PostTemplateInput): string {
  return createHash('sha256').update(JSON.stringify([input.name, input.content])).digest('hex');
}

function templateText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`请填写文案模板${field}`);
  const text = value.trim();
  if (text.length > max) throw new ValidationError(`文案模板${field}不能超过 ${max} 个字符`);
  return text;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
