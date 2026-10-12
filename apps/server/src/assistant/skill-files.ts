import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { SkillKey } from '@fast-social/contracts';

const memoryDirectories = new WeakMap<DatabaseSync, string>();
const temporaryDirectories = new Set<string>();
process.once('exit', () => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }); });

export function skillDirectory(db: DatabaseSync): string {
  const main = (db.prepare('PRAGMA database_list').all() as { name: string; file: string }[]).find(d => d.name === 'main');
  if (main?.file) return join(dirname(main.file), 'skills');
  // In-memory apps/tests share files only with repositories using the same database.
  let directory = memoryDirectories.get(db);
  if (!directory) {
    directory = mkdtempSync(join(tmpdir(), 'fastsocial-skills-'));
    memoryDirectories.set(db, directory); temporaryDirectories.add(directory);
  }
  return directory;
}

export const documentRevision = (document: string): string => createHash('sha256').update(document).digest('hex');

export class SkillFiles {
  private directory: string;
  constructor(directory: string) { this.directory = directory; }
  path(key: SkillKey): string { return join(this.directory, key, 'SKILL.md'); }
  exists(key: SkillKey): boolean { return existsSync(this.path(key)); }
  read(key: SkillKey): string { return readFileSync(this.path(key), 'utf8'); }
  write(key: SkillKey, document: string): void {
    const destination = this.path(key), temporary = destination + '.' + randomUUID() + '.tmp';
    mkdirSync(dirname(destination), { recursive: true });
    try {
      const descriptor = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(descriptor, document, 'utf8'); fsyncSync(descriptor); }
      finally { closeSync(descriptor); }
      renameSync(temporary, destination);
    } finally { rmSync(temporary, { force: true }); }
  }
  preserveLegacy(key: SkillKey, document: string): void {
    const path = join(dirname(this.path(key)), `SKILL.legacy-${documentRevision(document).slice(0, 16)}.md`);
    if (!existsSync(path)) writeFileSync(path, document, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
}
