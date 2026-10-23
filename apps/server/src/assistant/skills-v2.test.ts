import assert from 'node:assert/strict';
import test from 'node:test';
import { measurePost, postingPolicy, type AssistantChatRequest, type SocialAccount } from '@fast-social/contracts';
import { openDatabase } from '../db/database.ts';
import { initializeSchema } from '../db/schema.ts';
import { SettingsRepository } from '../repositories/settings-repository.ts';
import { AssistantRepository } from './repository.ts';
import { AssistantService } from './service.ts';
import { PostingPolicyResolver } from './posting-policy.ts';
import { loadBuiltinSkills, parseSkillDocument } from './skill-document.ts';
import { chatInput } from './routes.ts';
import { accountInput } from '../configuration/routes.ts';
import { parseXAccount } from '../adapters/x/x-parser.ts';
import { AccountRequestLimitError } from '../configuration/request-limits.ts';

const request = (): AssistantChatRequest => ({ skill: 'post', input: '写一条原创观点', targetLanguage: 'zh', history: [],
  context: { documentId: 'doc', url: 'https://x.com/home', title: '', selection: '', posts: [], target: null, composer: null, account: { actorId: '1', username: 'me' } } });
const profile = (): SocialAccount => ({ id: '1', username: 'me', name: 'Me', bio: '', fetchedAt: new Date().toISOString(), blueVerified: true });
const account = { name: 'Me', username: 'me', cookie: 'auth_token=secret; ct0=csrf; twid=u%3D1', configIds: [], assistant: { language: 'zh', voice: '' } };

test('posting permission lookup surfaces quota exhaustion and does not cache the quota error', async () => {
  const db = openDatabase(':memory:'), settings = new SettingsRepository(db);
  settings.configuration.saveAccount(account);
  let calls = 0;
  const resolver = new PostingPolicyResolver(settings.configuration, { async fetchAccount() {
    if (++calls === 1) throw new AccountRequestLimitError('Me', 'profile', 1, 1, '2026-10-13T00:00:00+08:00');
    return profile();
  } });
  try {
    await assert.rejects(resolver.resolve({ actorId: '1', username: 'me' }), AccountRequestLimitError);
    assert.equal((await resolver.resolve({ actorId: '1', username: 'me' })).maxWeightedLength, 25000);
    assert.equal(calls, 2);
  } finally { db.close(); }
});

test('post counting follows X weights for CJK, emoji, URLs and NFC normalization', () => {
  assert.deepEqual(measurePost('a'.repeat(280)), { weightedLength: 280, valid: true });
  assert.equal(measurePost('中'.repeat(140)).valid, true);
  assert.equal(measurePost('中'.repeat(141)).valid, false);
  assert.equal(measurePost('👨‍👩‍👧‍👦').weightedLength, 2);
  assert.equal(measurePost('https://example.com/a-very-long-path').weightedLength, 23);
  assert.equal(measurePost('cafe\u0301').weightedLength, 4);
  assert.equal(measurePost('中'.repeat(1000), 25000).valid, true);
  assert.equal(measurePost('\ufffe').valid, false);
});
test('posting limits follow automatic verification and use ordinary limits when unconfirmed', () => {
  assert.equal(postingPolicy(true).maxWeightedLength, 25000);
  assert.equal(postingPolicy(false).source, 'unconfirmed');
  assert.equal(postingPolicy(false).maxWeightedLength, 280);
  assert.equal(postingPolicy().maxWeightedLength, 280);
});
test('current-account verification is scoped to its cookie and identity, and concurrent reads share a bounded cache', async () => {
  const db = openDatabase(':memory:');
  try {
    const accounts = new SettingsRepository(db).configuration, saved = accounts.saveAccount(account);
    let calls = 0;
    const resolver = new PostingPolicyResolver(accounts, { fetchAccount: async (username, id) => { calls++; assert.equal(username, 'me'); assert.equal(id, saved.id); return profile(); } });
    const [a, b] = await Promise.all([resolver.resolve(request().context.account), resolver.resolve(request().context.account)]);
    assert.equal(a.maxWeightedLength, 25000); assert.deepEqual(a, b); assert.equal(calls, 1);
    assert.equal((await resolver.resolve({ actorId: 'other', username: 'me' })).maxWeightedLength, 280);
    assert.equal(calls, 1);
    const wrong = new PostingPolicyResolver(accounts, { fetchAccount: async () => ({ ...profile(), id: 'other' }) });
    assert.equal((await wrong.resolve(request().context.account)).maxWeightedLength, 280);
    const offline = new PostingPolicyResolver(accounts, { fetchAccount: async () => { throw new Error('offline'); } });
    assert.equal((await offline.resolve(request().context.account)).source, 'unconfirmed');
  } finally { db.close(); }
});
test('legacy manual permissions are ignored in inputs, account responses and automatic verification', async () => {
  const db = openDatabase(':memory:');
  try {
    const repo = new SettingsRepository(db).configuration;
    const saved = repo.saveAccount(account);
    for (const mode of ['long', 'standard']) {
      db.prepare('UPDATE account_writing_preferences SET posting_mode=? WHERE account_id=?').run(mode, saved.id);
      const parsed = accountInput({ ...account, postingMode: mode, assistant: { ...account.assistant, postingMode: mode } });
      assert.equal('postingMode' in parsed, false);
      assert.equal('postingMode' in parsed.assistant!, false);
      repo.saveAccount(parsed, saved.id);
      assert.equal('postingMode' in repo.accounts()[0].assistant!, false);
      const offline = new PostingPolicyResolver(repo, { fetchAccount: async () => { throw new Error('offline'); } });
      assert.equal((await offline.resolve(request().context.account)).maxWeightedLength, 280);
      let reads = 0;
      const detected = new PostingPolicyResolver(repo, { fetchAccount: async () => { reads++; return profile(); } });
      assert.equal((await detected.resolve(request().context.account)).maxWeightedLength, 25000);
      assert.equal(reads, 1);
    }
  } finally { db.close(); }
});
test('legacy skills become complete documents without losing IDs or customization; document edits survive restart', () => {
  const db = openDatabase(':memory:');
  try {
    db.exec("ALTER TABLE assistant_skills ADD COLUMN instructions TEXT NOT NULL DEFAULT ''");
    db.prepare('INSERT INTO assistant_skills(id,key,name,description,instructions) VALUES (?,?,?,?,?)').run('legacy-id', 'post', '发帖', 'Post', 'Keep my distinctive voice.');
    initializeSchema(db);
    const repo = new AssistantRepository(db), post = repo.list().find(s => s.key === 'post')!;
    assert.equal(post.id, 'legacy-id'); assert.ok(post.instructions.includes('Keep my distinctive voice.'));
    assert.ok(post.instructions.startsWith(loadBuiltinSkills().post));
    const document = post.instructions.replace(/^description:.*$/m, 'description: |\n  Write personal opinions\n  and revise drafts.') + '\n## Extra guidance\nKeep examples concrete.\n';
    repo.update('post', document);
    const restored = new AssistantRepository(db).list().find(s => s.key === 'post')!;
    assert.equal(restored.instructions, document); assert.equal(restored.description, 'Write personal opinions\nand revise drafts.');
    assert.throws(() => parseSkillDocument('Only a short prompt', 'post'));
    assert.throws(() => parseSkillDocument(document.replace('name: post', 'name: reply'), 'post'));
    assert.throws(() => parseSkillDocument('---\nname: post\ndescription: Write\n---\n', 'post'));
    assert.throws(() => parseSkillDocument('---\nname: [\ndescription: Write\n---\nBody', 'post'));
  } finally { db.close(); }
});
test('post execution loads the complete skill, counts actual output and rewrites excess instead of truncating', async () => {
  const db = openDatabase(':memory:');
  try {
    let calls = 0;
    const service = new AssistantService(new AssistantRepository(db), new SettingsRepository(db).configuration, { complete: async (_, messages) => {
      calls++;
      assert.ok(messages[0].content.includes(parseSkillDocument(loadBuiltinSkills().post, 'post').body));
      assert.match(messages[0].content, /已加载 Skill：post\/SKILL.md/);
      assert.doesNotMatch(messages[0].content, /# 社交内容总结|# X 讨论回复/);
      assert.match(messages[0].content, /最多 280 加权字符/);
      if (calls === 1) return '中'.repeat(141);
      assert.match(messages.at(-1)!.content, /282 加权字符/);
      return '保留完整观点，并用简洁的语言表达。';
    } });
    const result = await service.chat(request());
    assert.equal(calls, 2); assert.equal(result.content, '保留完整观点，并用简洁的语言表达。');
    assert.equal(result.draft?.weightedLength, measurePost(result.content).weightedLength);
    assert.equal(result.draft?.policy.maxWeightedLength, 280);
  } finally { db.close(); }
});
test('routing sees skill discovery metadata and execution loads only the selected saved document', async () => {
  const db = openDatabase(':memory:');
  try {
    const repo = new AssistantRepository(db);
    const saved = repo.update('post', loadBuiltinSkills().post.replace(/^description:.*$/m, 'description: Custom discovery description.') + '\n## Custom workflow\nSAVED_WORKFLOW_BODY\n');
    let calls = 0;
    const service = new AssistantService(repo, new SettingsRepository(db).configuration, { complete: async (_, messages) => {
      calls++;
      if (calls === 1) {
        const input = JSON.parse(messages[1].content);
        assert.equal(input.availableSkills.find((s: { name: string }) => s.name === 'post').description, saved.description);
        assert.doesNotMatch(JSON.stringify(messages), /SAVED_WORKFLOW_BODY/);
        return 'post';
      }
      assert.match(messages[0].content, /SAVED_WORKFLOW_BODY/);
      assert.doesNotMatch(messages[0].content, /# X 讨论回复|# 社交内容总结/);
      return 'A concise complete post.';
    } });
    const input = request(); delete input.skill;
    assert.equal((await service.chat(input)).skill, 'post'); assert.equal(calls, 2);
  } finally { db.close(); }
});
test('routing accepts one known choice with model formatting while preserving plain text output', async t => {
  const formats = [
    { name: 'JSON string', wrap: (choice: string) => JSON.stringify(choice.toUpperCase()) },
    { name: 'inline code', wrap: (choice: string) => '`' + choice + '`' },
    { name: 'text fence', wrap: (choice: string) => '```text\n' + choice + '\n```' },
    { name: 'slash command', wrap: (choice: string) => '/' + choice },
    { name: 'skill object', wrap: (choice: string) => JSON.stringify({ skill: choice }) },
  ];
  for (const choice of ['chat', 'summary', 'post', 'reply'] as const) {
    for (const format of formats) await t.test(`${choice}: ${format.name}`, async () => {
      const db = openDatabase(':memory:');
      try {
        const accounts = new SettingsRepository(db).configuration;
        accounts.saveAccount(account);
        let routed = 0, generated = 0, profileReads = 0;
        const content = '**原样正文**\n\n第二段。';
        const service = new AssistantService(new AssistantRepository(db), accounts, { complete: async (_, messages) => {
          if (messages[0].content.startsWith('将用户意图分类')) { routed++; return format.wrap(choice); }
          generated++;
          if (choice === 'chat') assert.doesNotMatch(messages[0].content, /已加载 Skill|运行时发帖约束/);
          else assert.match(messages[0].content, new RegExp(`已加载 Skill：${choice}/SKILL.md`));
          return content;
        } }, { fetchAccount: async () => { profileReads++; return profile(); } });
        const input = request(); delete input.skill;
        input.context.target = { id: '123', author: '@author', text: '原帖', url: 'https://x.com/author/status/123' };
        const result = await service.chat(input);
        assert.equal(result.skill, choice === 'chat' ? undefined : choice);
        assert.equal(result.content, content);
        assert.equal(routed, 1); assert.equal(generated, 1);
        assert.equal(profileReads, choice === 'post' || choice === 'reply' ? 1 : 0);
      } finally { db.close(); }
    });
  }
});
test('formatted routing still rejects disabled skills before permission lookup or generation', async () => {
  const db = openDatabase(':memory:');
  try {
    const accounts = new SettingsRepository(db).configuration;
    accounts.saveAccount(account);
    const skills = new AssistantRepository(db); skills.setEnabled('post', false);
    let routed = 0, generated = 0, profileReads = 0;
    const service = new AssistantService(skills, accounts, { complete: async (_, messages) => {
      if (messages[0].content.startsWith('将用户意图分类')) {
        routed++;
        assert.ok(!JSON.parse(messages[1].content).availableSkills.some((skill: { name: string }) => skill.name === 'post'));
        return '{"skill":"post"}';
      }
      generated++; return '不应生成';
    } }, { fetchAccount: async () => { profileReads++; return profile(); } });
    const input = request(); delete input.skill;
    await assert.rejects(service.chat(input), /\/post 已停用/);
    assert.equal(routed, 1); assert.equal(generated, 0); assert.equal(profileReads, 0);
  } finally { db.close(); }
});
test('ambiguous or unknown routing never guesses a skill or reaches permission lookup or generation', async t => {
  for (const raw of ['post or reply', '我选择 post，因为用户想发帖', '["post","reply"]', '{"skill":["post","reply"]}', '{"skill":"publish"}', '{"skill":"post"}\n{"skill":"reply"}', '```text\npost\n```\n```text\nreply\n```']) {
    await t.test(raw, async () => {
      const db = openDatabase(':memory:');
      try {
        const accounts = new SettingsRepository(db).configuration;
        accounts.saveAccount(account);
        let routed = 0, generated = 0, profileReads = 0;
        const service = new AssistantService(new AssistantRepository(db), accounts, { complete: async (_, messages) => {
          if (messages[0].content.startsWith('将用户意图分类')) { routed++; return raw; }
          generated++; return '不应生成';
        } }, { fetchAccount: async () => { profileReads++; return profile(); } });
        const input = request(); delete input.skill;
        input.context.target = { id: '123', author: '@author', text: '原帖', url: 'https://x.com/author/status/123' };
        await assert.rejects(service.chat(input), /未能识别任务/);
        assert.equal(routed, 1); assert.equal(generated, 0); assert.equal(profileReads, 0);
      } finally { db.close(); }
    });
  }
});
test('repeated excess is rejected, blue-account long text is retained, and summaries have no posting limit', async () => {
  const db = openDatabase(':memory:');
  try {
    let calls = 0;
    const service = new AssistantService(new AssistantRepository(db), new SettingsRepository(db).configuration, { complete: async () => { calls++; return '中'.repeat(300); } });
    await assert.rejects(service.chat(request()), /600\/280/); assert.equal(calls, 2);
    const long = request(); long.context.account.blueVerified = true;
    const result = await service.chat(long); assert.equal(result.content.length, 300); assert.equal(result.draft?.policy.maxWeightedLength, 25000);
    const summary = request(); summary.skill = 'summary'; summary.context.selection = 'Source material';
    const read = await service.chat(summary); assert.equal(read.content.length, 300); assert.equal(read.draft, undefined);
  } finally { db.close(); }
});
test('long drafts and history are accepted for revisions; invalid badge payloads and legacy verification are rejected', () => {
  const input = request(); input.history = [{ role: 'assistant', content: 'x'.repeat(25000) }];
  input.context.composer = { id: 'editor', scene: 'post', text: 'x'.repeat(25000), targetId: null };
  assert.equal(chatInput(input).history[0].content.length, 25000);
  assert.throws(() => chatInput({ ...input, context: { ...input.context, account: { ...input.context.account, blueVerified: 'yes' } } }));
  assert.equal(parseXAccount({ data: { user: { result: { rest_id: '1', legacy: { verified: true, screen_name: 'me' } } } } }, 'me').blueVerified, undefined);
  assert.equal(parseXAccount({ data: { user: { result: { rest_id: '1', is_blue_verified: false } } } }, 'me').blueVerified, false);
});
