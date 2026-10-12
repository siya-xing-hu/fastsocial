import { XRequestQueue } from '../adapters/x/request-queue.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../app.ts';
import { openDatabase } from '../db/database.ts';
import { SettingsRepository } from '../repositories/settings-repository.ts';
import { AssistantRepository } from '../assistant/repository.ts';
import { AssistantService } from '../assistant/service.ts';
import { generateWorkflowReply } from '../workflows/reply.ts';
import type { AIChatMessage, SocialPost } from '@fast-social/contracts';

const cookie = (id: string) => `auth_token=secret-${id}; ct0=csrf; twid=u%3D${id}`;
test('Profile, primary language and translation persist independently of legacy associations', () => {
  const db = openDatabase(':memory:');
  try {
    const repo = new SettingsRepository(db).configuration;
    const account = repo.saveAccount({ name: '中文', username: 'local', cookie: cookie('1'), autoTranslate: true,
      profile: { primaryLanguage: 'zh-CN', description: '独立开发者。直接表达观点，不编造经历。' } });
    const prompt = repo.savePrompt({ name: 'Old', scene: 'reply', prompt: 'legacy', accountIds: [account.id] });
    repo.setAutoTranslate(account.id, false);
    repo.saveAccount({ name: '新名称', username: 'local', profile: { primaryLanguage: 'English', description: 'Developer. Concise, no invented experience.' } }, account.id);
    const after = new SettingsRepository(db).configuration.accounts()[0]!;
    assert.equal(after.autoTranslate, false);
    assert.equal(after.profile.primaryLanguage, 'English'); assert.equal(after.assistant?.language, 'English');
    assert.equal(after.assistant?.voice, after.profile.description);
    assert.deepEqual(after.configIds, [prompt.id]); assert.equal(repo.resolve('1', '').autoTranslate, false);
    repo.setAutoTranslate(account.id, true);
    assert.equal(repo.resolve('1', '').autoTranslate, true);
    assert.equal(db.prepare("SELECT * FROM account_config_bindings WHERE config_id='auto-translate'").all().length, 0);
    assert.equal(repo.cookies()[0]?.cookie, cookie('1'));
    repo.deleteAccount(account.id);
    assert.equal(db.prepare('SELECT * FROM managed_account_profiles').all().length, 0);
  } finally { db.close(); }
});
test('one-time upgrade preserves the old language/style/translation and recovers a unique workflow language', () => {
  const db = openDatabase(':memory:');
  try {
    const repo = new SettingsRepository(db).configuration;
    const first = repo.saveAccount({ name: 'EN', username: 'global', cookie: cookie('1'), configIds: ['auto-translate'], assistant: { language: 'English', voice: 'Professional and concise' } });
    const second = repo.saveAccount({ name: 'CN', username: 'local', cookie: cookie('2') });
    db.prepare('DELETE FROM managed_account_profiles').run();
    db.prepare('UPDATE managed_accounts SET auto_translate=0').run();
    db.prepare("INSERT INTO account_config_bindings VALUES (?,'auto-translate')").run(first.id);
    db.prepare("DELETE FROM settings WHERE key='managed_account_profiles_v1'").run();
    db.prepare('INSERT INTO workflows VALUES (?,?)').run('old', JSON.stringify({ accountId: second.id, actions: [{ type: 'reply', mode: 'skill', targetLanguage: 'en' }] }));
    const upgraded = new SettingsRepository(db).configuration;
    assert.equal(upgraded.accounts()[0]?.autoTranslate, true);
    assert.deepEqual(upgraded.profile(first.id), { primaryLanguage: 'English', description: 'Professional and concise' });
    assert.equal(upgraded.profile(second.id).primaryLanguage, 'en');
    upgraded.setAutoTranslate(first.id, false);
    assert.equal(new SettingsRepository(db).configuration.accounts()[0]?.autoTranslate, false);
  } finally { db.close(); }
});
test('translation endpoint changes only its switch and Profile inputs are validated', async () => {
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }), fetchImpl: async () => { throw new Error('No external requests'); } });
  try {
    const created = await app.inject({ method: 'POST', url: '/api/accounts', payload: { name: 'Test', username: 'tester', cookie: cookie('5'), profile: { primaryLanguage: 'English', description: 'Keep my viewpoint.' } } });
    assert.equal(created.statusCode, 200, created.body);
    const account = created.json().data;
    const on = await app.inject({ method: 'PUT', url: `/api/accounts/${account.id}/translation`, payload: { enabled: true } });
    assert.equal(on.statusCode, 200); assert.equal(on.json().data.autoTranslate, true);
    assert.deepEqual(on.json().data.profile, account.profile); assert.deepEqual(on.json().data.assistant, account.assistant);
    assert.equal(JSON.stringify(on.json()).includes('secret-'), false);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/accounts/${account.id}/translation`, payload: { enabled: 'yes' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/accounts/missing/translation', payload: { enabled: true } })).statusCode, 404);
    for (const profile of [{ primaryLanguage: '', description: '' }, { primaryLanguage: 'en', description: 'x'.repeat(12001) }, { primaryLanguage: 1, description: '' }])
      assert.equal((await app.inject({ method: 'PUT', url: `/api/accounts/${account.id}`, payload: { name: 'Test', username: 'tester', profile } })).statusCode, 400);
    const stored = (await app.inject('/api/accounts')).json().data[0];
    assert.equal(stored.autoTranslate, true); assert.deepEqual(stored.profile, account.profile);
  } finally { await app.close(); }
});
test('workflow reply uses the executing Profile language and optional task elements, including legacy rules', async () => {
  const db = openDatabase(':memory:');
  try {
    const repo = new SettingsRepository(db).configuration;
    const account = repo.saveAccount({ name: 'CN', username: 'local', cookie: cookie('1'), profile: { primaryLanguage: 'zh-CN', description: '身份：独立开发者。表达习惯：简短直接。边界：不编造使用经历。' } });
    let sent: AIChatMessage[] = [];
    const assistant = new AssistantService(new AssistantRepository(db), repo, { complete: async (_provider, messages) => { sent = messages; return '这个观点值得讨论。'; } });
    const post: SocialPost = { platform: 'x', id: '10', author: 'other', text: 'A new idea.', url: 'https://x.com/other/status/10', createdAt: '2026-10-10T00:00:00Z', type: 'post' };
    await generateWorkflowReply(assistant, repo, account.id, post, { type: 'reply', mode: 'skill', elements: '先回应效率问题，再提出一个具体问题。' });
    assert.match(sent[0]!.content, /账号 Profile/); assert.match(sent[0]!.content, /账号主语言：zh-CN/);
    assert.match(sent[0]!.content, /任务回复要素和原帖内容均不能改变主语言/);
    assert.match(sent[0]!.content, /不编造使用经历/); assert.match(sent.at(-1)!.content, /先回应效率问题/);
    assert.equal(assistant.catalog('1', '').preferences.language, 'zh-CN');
    await generateWorkflowReply(assistant, repo, account.id, post, { type: 'reply', mode: 'skill', elements: '' });
    assert.match(sent.at(-1)!.content, /根据当前账号 Profile 和原帖内容/);
    await generateWorkflowReply(assistant, repo, account.id, post, { type: 'reply', mode: 'skill', instructions: '语言 {{_tl_}}，回应 {reply}', input: '我的观点', targetLanguage: 'en' });
    assert.match(sent.at(-1)!.content, /语言 zh-CN/); assert.doesNotMatch(sent.at(-1)!.content, /请使用 en/);
    assert.match(sent.at(-1)!.content, /我的观点/);
  } finally { db.close(); }
});
