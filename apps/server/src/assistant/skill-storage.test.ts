import { XRequestQueue } from '../adapters/x/request-queue.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db/database.ts';
import { initializeSchema } from '../db/schema.ts';
import { AssistantRepository } from './repository.ts';
import { loadBuiltinSkills } from './skill-document.ts';
import { skillDirectory } from './skill-files.ts';
import { createApp } from '../app.ts';
import { AssistantService } from './service.ts';
import { SettingsRepository } from '../repositories/settings-repository.ts';
import { generateWorkflowReply } from '../workflows/reply.ts';
import type { AssistantChatRequest } from '@fast-social/contracts';

const request = (): AssistantChatRequest => ({ skill: 'post', input: '写一条简短观点', history: [], targetLanguage: 'zh', context: {
  documentId: 'doc', url: 'https://x.com/home', title: '', account: { actorId: '1', username: 'me' }, selection: '', posts: [], target: null, composer: null,
} });

test('file bodies and database metadata persist independently across database restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'fastsocial-skill-storage-test-')), path = join(root, 'fastsocial.db');
  let db = openDatabase(path);
  try {
    const repo = new AssistantRepository(db), initial = repo.get('post');
    const document = initial.instructions + '\n## Custom guidance\nKeep it personal.\n';
    repo.update('post', document, initial.revision); repo.setEnabled('post', false);
    assert.equal(readFileSync(join(root, 'skills/post/SKILL.md'), 'utf8'), document);
    assert.deepEqual(readdirSync(join(root, 'skills/post')), ['SKILL.md']);
    const columns = (db.prepare('PRAGMA table_info(assistant_skills)').all() as { name: string }[]).map(c => c.name);
    assert.ok(!columns.includes('instructions') && !columns.includes('definition'));
    assert.equal(db.prepare('SELECT file_path,enabled FROM assistant_skills WHERE key=?').get('post')?.file_path, 'post/SKILL.md');
    db.close(); db = openDatabase(path);
    const restored = new AssistantRepository(db).get('post');
    assert.equal(restored.id, initial.id); assert.equal(restored.instructions, document); assert.equal(restored.enabled, false);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('legacy export preserves whole documents and custom short instructions before removing the database body', () => {
  const db = openDatabase(':memory:');
  try {
    db.exec('DROP TABLE assistant_skills; CREATE TABLE assistant_skills (id TEXT PRIMARY KEY,key TEXT UNIQUE,name TEXT,description TEXT,instructions TEXT NOT NULL) STRICT;');
    const document = loadBuiltinSkills().post + '\nMy existing content.\n';
    const insert = db.prepare('INSERT INTO assistant_skills VALUES (?,?,?,?,?)');
    insert.run('post-id', 'post', '发帖', 'Old', document); insert.run('reply-id', 'reply', '回复', 'Old', 'My short reply instructions.');
    initializeSchema(db);
    const repo = new AssistantRepository(db);
    assert.equal(repo.get('post').instructions, document); assert.equal(repo.get('post').id, 'post-id');
    assert.match(repo.get('reply').instructions, /## 用户自定义要求\n\nMy short reply instructions/);
    assert.throws(() => db.prepare('SELECT instructions FROM assistant_skills'));
    assert.equal(new AssistantRepository(db).get('post').instructions, document);
  } finally { db.close(); }
});

test('migration failure retains the original database body; existing disk edits take precedence with legacy backup', () => {
  const root = mkdtempSync(join(tmpdir(), 'fastsocial-skill-export-test-')), db = openDatabase(':memory:');
  try {
    db.exec("ALTER TABLE assistant_skills ADD COLUMN instructions TEXT NOT NULL DEFAULT ''");
    db.prepare('INSERT INTO assistant_skills(id,key,name,description,instructions) VALUES (?,?,?,?,?)').run('id', 'post', '发帖', 'Old', 'Preserve this');
    const blocked = join(root, 'not-a-directory'); writeFileSync(blocked, 'test');
    assert.throws(() => new AssistantRepository(db, blocked));
    assert.equal(db.prepare('SELECT instructions FROM assistant_skills WHERE key=?').get('post')?.instructions, 'Preserve this');
    const initial = new AssistantRepository(db, join(root, 'skills'));
    const fileDocument = initial.get('post').instructions + '\nDisk edit\n';
    writeFileSync(join(root, 'skills/post/SKILL.md'), fileDocument);
    db.exec("ALTER TABLE assistant_skills ADD COLUMN instructions TEXT NOT NULL DEFAULT ''");
    db.prepare('UPDATE assistant_skills SET instructions=? WHERE key=?').run('Another legacy edit', 'post');
    const migrated = new AssistantRepository(db, join(root, 'skills'));
    assert.equal(migrated.get('post').instructions, fileDocument);
    const backup = readdirSync(join(root, 'skills/post')).find(p => p.startsWith('SKILL.legacy-'))!;
    assert.match(readFileSync(join(root, 'skills/post', backup), 'utf8'), /Another legacy edit/);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('external edits update metadata and reject stale saves; missing or invalid files are visible and are never silently replaced', () => {
  const db = openDatabase(':memory:');
  try {
    const repo = new AssistantRepository(db), old = repo.get('post'), path = join(skillDirectory(db), 'post/SKILL.md');
    const document = old.instructions.replace(/^description:.*$/m, 'description: External description.');
    writeFileSync(path, document);
    assert.equal(repo.get('post').description, 'External description.');
    assert.throws(() => repo.update('post', old.instructions, old.revision), /文件已被其他编辑更新/);
    assert.equal(readFileSync(path, 'utf8'), document);
    writeFileSync(path, 'Broken YAML');
    assert.equal(repo.get('post').instructions, 'Broken YAML'); assert.ok(repo.get('post').error);
    assert.throws(() => repo.requireEnabled('post'), /不可用/);
    assert.equal(new AssistantRepository(db).get('post').instructions, 'Broken YAML');
    rmSync(path);
    assert.match(new AssistantRepository(db).get('post').error!, /文件不存在/);
    assert.equal(repo.list().length, 3);
    const missing = repo.get('post'); repo.update('post', document, missing.revision);
    assert.equal(repo.get('post').error, undefined);
  } finally { db.close(); }
});

test('admin API exposes raw files and switches; disabled skills stay out of discovery and explicit generation', async () => {
  let networkCalls = 0;
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }), fetchImpl: async () => { networkCalls++; throw new Error('No network'); } });
  try {
    const all = (await app.inject('/api/assistant/skills')).json().data;
    const before = all.find((s: { key: string }) => s.key === 'post');
    assert.match(before.instructions, /^---\nname: post/);
    const update = await app.inject({ method: 'PUT', url: '/api/assistant/skills/post', payload: { instructions: before.instructions + '\nA saved note.\n', revision: before.revision } });
    assert.equal(update.statusCode, 200);
    const conflict = await app.inject({ method: 'PUT', url: '/api/assistant/skills/post', payload: { instructions: before.instructions, revision: before.revision } });
    assert.equal(conflict.statusCode, 400);
    const disabled = await app.inject({ method: 'PATCH', url: '/api/assistant/skills/post', payload: { enabled: false } });
    assert.equal(disabled.json().data.enabled, false);
    assert.equal(disabled.json().data.instructions, update.json().data.instructions);
    assert.equal((await app.inject('/api/assistant/skills')).json().data.length, 3);
    assert.deepEqual((await app.inject('/api/assistant/catalog')).json().data.skills.map((s: { key: string }) => s.key), ['summary', 'reply']);
    const rejected = await app.inject({ method: 'POST', url: '/api/assistant/chat', payload: request() });
    assert.equal(rejected.statusCode, 400); assert.match(rejected.json().error.message, /已停用/); assert.equal(networkCalls, 0);
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/assistant/skills/post', payload: { enabled: 'yes' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/assistant/skills/post', payload: { enabled: true } })).statusCode, 200);
    assert.equal((await app.inject('/api/assistant/catalog')).json().data.skills.length, 3);
  } finally { await app.close(); }
});

test('automatic selection and workflow replies cannot invoke a disabled skill; ordinary chat still works', async () => {
  const db = openDatabase(':memory:');
  try {
    const repo = new AssistantRepository(db), accounts = new SettingsRepository(db).configuration;
    repo.setEnabled('post', false);
    let calls = 0;
    const service = new AssistantService(repo, accounts, { complete: async (_, messages) => {
      if (!messages[0].content.includes('将用户意图分类')) {
        calls++; assert.doesNotMatch(messages[0].content, /已加载 Skill/); return '可以先聊聊你的想法。';
      }
      calls++; assert.deepEqual(JSON.parse(messages[1].content).availableSkills.map((s: { name: string }) => s.name), ['summary', 'reply']); return 'post';
    } });
    const input = request(); delete input.skill;
    await assert.rejects(service.chat(input), /已停用/); assert.equal(calls, 1);
    const account = accounts.saveAccount({ name: 'Test', username: 'me', cookie: 'auth_token=fixture; ct0=fixture; twid=u%3D1', configIds: [], profile: { primaryLanguage: 'en', description: '' } });
    repo.setEnabled('reply', false);
    await assert.rejects(generateWorkflowReply(service, accounts, account.id, { id: '1', platform: 'x', type: 'post', author: 'a', text: 'A post', createdAt: new Date().toISOString(), url: 'https://x.com/a/status/1' }, { type: 'reply', mode: 'skill', elements: '' }), /已停用/);
    assert.equal(calls, 1);
    repo.setEnabled('summary', false);
    input.input = '我们先聊聊选题';
    const chat = await service.chat(input);
    assert.equal(chat.skill, undefined); assert.equal(chat.draft, undefined); assert.equal(calls, 2);
  } finally { db.close(); }
});

test('disabling a skill during generation prevents returning its draft', async () => {
  const db = openDatabase(':memory:');
  try {
    const repo = new AssistantRepository(db);
    const service = new AssistantService(repo, new SettingsRepository(db).configuration, { complete: async () => { repo.setEnabled('post', false); return 'A draft'; } });
    await assert.rejects(service.chat(request()), /已停用/);
  } finally { db.close(); }
});
