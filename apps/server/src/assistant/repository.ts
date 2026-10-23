import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SKILL_KEYS, type AssistantSkill, type SkillKey } from "@fast-social/contracts";
import { loadBuiltinSkills, parseSkillDocument } from './skill-document.ts';
import { SkillFiles, documentRevision, skillDirectory } from './skill-files.ts';
import { ValidationError } from '../http/validation.ts';
import { PostTemplateRepository } from './post-templates.ts';

const legacyDefaults: Pick<AssistantSkill, 'key' | 'name' | 'description' | 'instructions'>[] = [
  { key: "summary", name: "总结", description: "提炼选中文本、原帖或已加载的讨论。", instructions: "优先总结选中文本；否则总结选定原帖及提供的讨论；没有选定原帖时概括已加载的帖子。区分作者观点、事实与推测，标注相关帖子的链接。只依据提供的内容，不声称读完完整时间线或未加载的讨论。简洁列出主题、要点和分歧。" },
  { key: "post", name: "发帖", description: "把你的想法整理成一条可发布的文案。", instructions: "根据用户的想法、当前草稿或明确选中的素材撰写一条 X 文案。保留个人观点，不凭空补充经历或事实。没有素材时先问一个具体问题。除非用户要求，不添加标签、表情、营销话术或多个版本。默认保持简短，输出可直接使用的正文。页面其他帖子仅是背景，不自动代替用户观点。" },
  { key: "reply", name: "回复", description: "围绕选定原帖，按你的立场组织回复。", instructions: "只回复选定的原帖，结合用户给出的立场、要求和已有草稿。针对原帖的具体观点，避免套话与无依据的赞美。不擅自代表用户承诺或编造经历。用户未表达立场时使用中性、自然的回应。除非用户要求解释或多个版本，直接输出一条简短的回复正文。" },
];

export class AssistantRepository {
  readonly templates: PostTemplateRepository;
  private db: DatabaseSync;
  private files: SkillFiles;
  constructor(db: DatabaseSync, directory = skillDirectory(db)) {
    this.db = db;
    this.templates = new PostTemplateRepository(db);
    this.files = new SkillFiles(directory);
    const builtins = loadBuiltinSkills();
    const columns = (db.prepare('PRAGMA table_info(assistant_skills)').all() as { name: string }[]).map(c => c.name);
    const legacy = columns.includes('instructions');
    for (const skill of legacyDefaults) {
      const row = db.prepare('SELECT * FROM assistant_skills WHERE key=?').get(skill.key) as (SkillRow & { instructions?: string }) | undefined;
      let document = builtins[skill.key];
      if (row?.instructions) {
        try { parseSkillDocument(row.instructions, skill.key); document = row.instructions; }
        catch { if (row.instructions !== skill.instructions) document += '\n## 用户自定义要求\n\n' + row.instructions; }
      }
      if (!row || legacy) {
        if (!this.files.exists(skill.key)) this.files.write(skill.key, document);
        else if (row?.instructions && this.files.read(skill.key) !== document) this.files.preserveLegacy(skill.key, document);
      }
      if (!row) {
        const fields = legacy ? ',instructions' : '', values = legacy ? ',?' : '';
        db.prepare(`INSERT INTO assistant_skills(id,key,name,description,file_path${fields}) VALUES (?,?,?,?,?${values})`)
          .run(randomUUID(), skill.key, skill.name, parseSkillDocument(document, skill.key).description, `${skill.key}/SKILL.md`, ...(legacy ? [document] : []));
      }
    }
    // Only remove the old body after every export succeeds. Files are authoritative thereafter.
    if (legacy) db.exec('ALTER TABLE assistant_skills DROP COLUMN instructions');
    if (columns.includes('definition')) db.exec('ALTER TABLE assistant_skills DROP COLUMN definition');
    this.list();
  }
  list(): AssistantSkill[] {
    const rows = this.db.prepare('SELECT * FROM assistant_skills').all() as unknown as SkillRow[];
    return SKILL_KEYS.map(key => this.read(rows.find(r => r.key === key)!));
  }
  get(key: SkillKey): AssistantSkill {
    return this.read(this.db.prepare('SELECT * FROM assistant_skills WHERE key=?').get(key) as unknown as SkillRow);
  }
  requireEnabled(key: SkillKey): AssistantSkill {
    const skill = this.get(key);
    if (!skill.enabled) throw new ValidationError(`/${key} 已停用，请在互动 Skills 中启用后再试`);
    if (skill.error) throw new ValidationError(`/${key} 不可用：${skill.error}`);
    return skill;
  }
  update(key: SkillKey, instructions: string, expectedRevision?: string): AssistantSkill {
    parseSkillDocument(instructions, key);
    const current = this.get(key);
    if (expectedRevision !== undefined && current.revision !== expectedRevision)
      throw new ValidationError('Skill 文件已被其他编辑更新，当前草稿仍保留。请先复制草稿，再取消编辑、刷新并合并内容');
    this.files.write(key, instructions);
    return this.get(key);
  }
  setEnabled(key: SkillKey, enabled: boolean): AssistantSkill {
    const skill = this.get(key);
    if (enabled && skill.error) throw new ValidationError('请先修复 Skill 文件再启用：' + skill.error);
    this.db.prepare('UPDATE assistant_skills SET enabled=?,updated_at=? WHERE key=?').run(enabled ? 1 : 0, new Date().toISOString(), key);
    return this.get(key);
  }
  private read(row: SkillRow): AssistantSkill {
    let instructions = '', error: string | undefined;
    try { instructions = this.files.read(row.key); }
    catch (e) { error = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'SKILL.md 文件不存在' : 'SKILL.md 文件无法读取'; }
    const revision = documentRevision(instructions), filePath = `${row.key}/SKILL.md`;
    if (!error) {
      try {
        const { description } = parseSkillDocument(instructions, row.key);
        if (row.content_hash !== revision || row.description !== description || row.file_path !== filePath) {
          row.description = description; row.updated_at = new Date().toISOString();
          this.db.prepare('UPDATE assistant_skills SET description=?,content_hash=?,file_path=?,updated_at=? WHERE key=?')
            .run(description, revision, filePath, row.updated_at, row.key);
        }
      } catch (e) { if (!(e instanceof ValidationError)) throw e; error = e.message; }
    }
    return { id: row.id, key: row.key, name: row.name, description: row.description, instructions, filePath: 'skills/' + filePath,
      enabled: !!row.enabled, updatedAt: row.updated_at, revision, ...(error ? { error } : {}) };
  }
}

interface SkillRow {
  id: string; key: SkillKey; name: string; description: string; file_path: string;
  enabled: number; content_hash: string; updated_at: string;
}
