import assert from "node:assert/strict";
import test from "node:test";
import { ConversationStore, CONVERSATION_PREFIX, conversationTitle, conversationReference, draftContext, newConversation, requestHistory, sameAccount, type ChatMessage } from "./conversations.ts";

function storage() {
  const values: Record<string, unknown> = {};
  return { values, get: async (key: string | null) => structuredClone(key === null ? values : { [key]: values[key] }),
    set: async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)); },
    remove: async (key: string) => { delete values[key]; } };
}
test("conversations and unsent drafts survive reopening without overwriting other sessions or settings", async () => {
  const area = storage(), store = new ConversationStore(area);
  area.values.config = { language: "zh" };
  const first = newConversation(), second = newConversation();
  first.draft = "/post a new idea"; first.title = "First";
  second.messages = [{ id: "m1", role: "user", content: "Hello", createdAt: 1 }, { id: "m2", role: "assistant", skill: "post", content: "One paragraph.\n\nAnother paragraph.", createdAt: 2 }];
  second.updatedAt += 10;
  await Promise.all([store.save(first), new ConversationStore(area).save(second)]);
  await store.activate(first.id);
  const reopened = new ConversationStore(area), all = await reopened.list();
  assert.equal(await reopened.activeId(), first.id);
  assert.deepEqual(all, [second, first]);
  assert.deepEqual(area.values.config, { language: "zh" });
  await reopened.remove(second.id);
  assert.deepEqual(await reopened.list(), [first]);
  await reopened.save(second); // Undo a deletion.
  assert.equal((await reopened.list()).length, 2);
});
test("queued snapshots preserve order and deletion cannot be undone by an earlier delayed save", async () => {
  const area = storage(), store = new ConversationStore(area), conversation = newConversation();
  conversation.draft = "first";
  const first = store.save(conversation);
  conversation.draft = "second";
  await first;
  assert.equal((await store.list())[0].draft, "first");
  const second = store.save(conversation), removed = store.remove(conversation.id);
  await Promise.all([second, removed]);
  assert.deepEqual(await store.list(), []);
});
test("each X tab restores its own active conversation while sharing searchable history", async () => {
  const area = storage(), first = new ConversationStore(area, 10), second = new ConversationStore(area, 20);
  const a = newConversation(), b = newConversation();
  await first.save(a); await second.save(b); await first.activate(a.id); await second.activate(b.id);
  assert.equal(await first.activeId(), a.id); assert.equal(await second.activeId(), b.id);
  assert.equal(await new ConversationStore(area, 30).activeId(), null);
  assert.equal((await second.list()).length, 2);
});
test("a failed save reports the error and subsequent writes still work", async () => {
  const area = storage(); let fail = true;
  const store = new ConversationStore({ ...area, set: async values => { if (fail) throw new Error("quota"); await area.set(values); } });
  const conversation = newConversation(); conversation.draft = "Retain this";
  await assert.rejects(store.save(conversation), /quota/);
  fail = false; await store.save(conversation);
  assert.deepEqual(await store.list(), [conversation]);
});
test("unrelated, malformed and unknown-version records are ignored", async () => {
  const area = storage(), good = newConversation();
  area.values[CONVERSATION_PREFIX + good.id] = good;
  area.values[CONVERSATION_PREFIX + "bad"] = { ...good, id: "bad", messages: [null] };
  area.values[CONVERSATION_PREFIX + "v2"] = { ...good, id: "v2", version: 2 };
  area.values[CONVERSATION_PREFIX + "mismatch"] = good;
  assert.deepEqual(await new ConversationStore(area).list(), [good]);
});
test("model history is bounded while the complete local transcript stays intact", () => {
  const messages: ChatMessage[] = Array.from({ length: 60 }, (_, i) => ({ id: String(i), role: i % 2 ? "assistant" : "user", content: String(i), createdAt: i }));
  const recent = requestHistory(messages);
  assert.equal(recent.length, 24); assert.equal(recent[0].content, "36"); assert.equal(messages.length, 60);
  messages.push({ id: "failed", role: "user", content: "failed prompt", error: "interrupted", createdAt: 100 });
  assert.deepEqual(requestHistory(messages), recent);
  messages.forEach(m => { m.content = "x".repeat(15000); });
  const bounded = requestHistory(messages);
  assert.ok(bounded.length > 0 && bounded.length <= 24);
  assert.ok(bounded.every(m => m.content.length <= 50000));
  assert.ok(bounded.reduce((size, m) => size + m.content.length, 0) <= 60000);
  assert.equal(bounded[0].role, "user"); assert.equal(messages[0].content.length, 15000);
});
test("a long-post revision includes the full previous draft within the history budget", () => {
  const draft = 'x'.repeat(25000);
  const messages: ChatMessage[] = [{ id: 'u', role: 'user', content: '写一篇长文', createdAt: 1 }, { id: 'a', role: 'assistant', content: draft, skill: 'post', createdAt: 2 }];
  assert.equal(requestHistory(messages)[1].content, draft);
});
test("identity follows stable X account IDs while display names can change", () => {
  assert.ok(sameAccount({ actorId: "1", username: "before", displayName: "Old" }, { actorId: "1", username: "after", displayName: "New" }));
  assert.ok(!sameAccount({ actorId: "1", username: "same" }, { actorId: "2", username: "same" }));
  assert.ok(sameAccount({ actorId: "", username: "Case" }, { actorId: "", username: "case" }));
  assert.ok(sameAccount({ actorId: "", username: "" }, { actorId: "", username: "" }));
  assert.ok(!sameAccount({ actorId: "", username: "" }, { actorId: "1", username: "new" }));
  assert.ok(!sameAccount(null, { actorId: '1', username: 'new' }));
  assert.ok(!sameAccount({ actorId: '1', username: 'new' }, null));
});
test('history, active conversation and unsent drafts are isolated by account in the same tab', async () => {
  const area = storage(), store = new ConversationStore(area, 10);
  const firstAccount = { actorId: '1', username: 'english' }, secondAccount = { actorId: '2', username: 'chinese' };
  const first = newConversation(firstAccount), second = newConversation(secondAccount), unknown = newConversation();
  first.draft = '/post English draft'; second.draft = '/reply 中文草稿'; unknown.draft = 'Unattributed draft';
  await store.save(first); await store.save(second); await store.save(unknown);
  await store.activate(first.id, firstAccount); await store.activate(second.id, secondAccount);
  const reopened = new ConversationStore(area, 10);
  assert.deepEqual(await reopened.list(firstAccount), [first]); assert.deepEqual(await reopened.list(secondAccount), [second]);
  assert.deepEqual(await reopened.list(null), [unknown]);
  assert.equal(await reopened.activeId(firstAccount), first.id); assert.equal(await reopened.activeId(secondAccount), second.id);
  assert.equal(await reopened.activeId({ ...firstAccount, username: 'renamed' }), first.id);
  await reopened.remove(second.id);
  assert.deepEqual(await reopened.list(firstAccount), [first]); assert.deepEqual(await reopened.list(secondAccount), []);
  await reopened.save(second); assert.deepEqual(await reopened.list(secondAccount), [second]);
});
test('legacy active records and message contexts are recovered only for their original account', async () => {
  const area = storage(), store = new ConversationStore(area, 10);
  const account = { actorId: '1', username: 'english' }, other = { actorId: '2', username: 'chinese' };
  const legacy = newConversation();
  legacy.messages = [{ id: 'a', role: 'assistant', content: 'Saved reply', createdAt: 1, context: { documentId: 'doc', url: 'https://x.com/home', title: '', account, selection: '', posts: [], target: null, composer: null } }];
  await store.save(legacy); await store.activate(legacy.id);
  assert.equal((await store.list(account))[0].id, legacy.id);
  assert.deepEqual(await store.list(other), []); assert.deepEqual(await store.list(null), []);
  assert.equal(await store.activeId(account), legacy.id); assert.equal(await store.activeId(other), null);
  assert.equal((await store.list(account))[0].messages[0].content, 'Saved reply');
});
test('username fallback is case insensitive and does not merge distinct stable account IDs', async () => {
  const area = storage(), store = new ConversationStore(area);
  const c = newConversation({ actorId: '1', username: 'Example' }); await store.save(c);
  assert.equal((await store.list({ actorId: '', username: 'example' })).length, 1);
  assert.equal((await store.list({ actorId: '2', username: 'example' })).length, 0);
});
test("draft snapshots retain fill guards without duplicating the entire timeline", () => {
  const context = { documentId: "doc", url: "https://x.com/home", title: "Home", account: { actorId: "1", username: "me" }, selection: "selected", posts: [{ id: "1", author: "other", text: "timeline", url: "https://x.com/other/status/1" }], target: null, composer: { id: "editor", scene: "post" as const, text: "original", targetId: null } };
  const saved = draftContext(context);
  assert.deepEqual(saved.posts, []); assert.equal(saved.selection, ""); assert.equal(saved.composer?.text, "original");
  context.composer.text = "changed"; assert.equal(saved.composer?.text, "original");
  assert.equal(conversationTitle("/post   A new\nidea"), "A new idea");
});
test('source snapshots and skill history survive reopening, while duplicate sources do not crowd out the conversation', async () => {
  const source = { documentId: 'doc', url: 'https://x.com/home', title: 'Home', account: { actorId: '1', username: 'me' }, selection: '', posts: [{ id: '1', author: 'other', text: 'Original material', url: 'https://x.com/other/status/1' }], target: null, composer: null };
  const reference = conversationReference(source, 'summary');
  source.posts[0].text = 'Different page';
  assert.match(reference!, /Original material/); assert.doesNotMatch(reference!, /Different page/);
  const area = storage(), store = new ConversationStore(area), conversation = newConversation(source.account);
  conversation.messages = [
    { id: '1', role: 'user', content: '总结一下', skill: 'summary', reference, createdAt: 1 },
    { id: '2', role: 'assistant', content: '要点 A', skill: 'summary', createdAt: 2 },
    { id: '3', role: 'user', content: '我认为应该关注隐私', reference, createdAt: 3 },
    { id: '4', role: 'assistant', content: '可以从隐私的角度讨论', createdAt: 4 },
  ];
  await store.save(conversation);
  const restored = (await new ConversationStore(area).list(source.account))[0];
  const history = requestHistory(restored.messages);
  assert.equal(history[0].reference, reference); assert.equal(history[2].reference, undefined);
  assert.equal(history[1].skill, 'summary'); assert.equal(history[3].skill, undefined);
  assert.deepEqual(await store.list({ actorId: '2', username: 'other' }), []);
  assert.deepEqual(requestHistory(newConversation(source.account).messages), []);
});
test('large sources are bounded and explicitly marked; transcript and full drafts take priority over references', () => {
  const source = { documentId: 'doc', url: 'https://x.com/home', title: 'Home', account: { actorId: '1', username: 'me' }, selection: 's'.repeat(8000), posts: [], target: null, composer: { id: 'editor', scene: 'post' as const, text: 'd'.repeat(50000), targetId: null } };
  const reference = conversationReference(source, 'post')!;
  assert.ok(reference.length <= 16000); assert.equal(JSON.parse(reference).truncated, true);
  assert.equal(source.composer.text.length, 50000);
  const messages: ChatMessage[] = [
    { id: '1', role: 'user', content: 'x'.repeat(8000), reference, createdAt: 1 },
    { id: '2', role: 'assistant', content: 'y'.repeat(50000), skill: 'post', createdAt: 2 },
  ];
  const history = requestHistory(messages);
  assert.equal(history[1].content.length, 50000); assert.equal(history[0].reference, undefined);
  assert.equal(messages[0].reference, reference);
});
