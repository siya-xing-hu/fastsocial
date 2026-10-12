import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Window, type HTMLElement as TestElement } from 'happy-dom';
import type { AssistantContext } from '@fast-social/contracts';
import { installAssistantContext } from './x-context.ts';

function fixture(t: TestContext) {
  const window = new Window({ url: 'https://x.com/home' });
  window.document.body.innerHTML = '<a data-testid="AppTabBar_Profile_Link" href="/me">Me</a><main></main>';
  window.document.cookie = 'twid=u%3D10';
  // happy-dom has no layout engine; retain actual DOM traversal/events and simulate visible boxes.
  window.HTMLElement.prototype.getClientRects = function (this: TestElement) { return this.hidden ? [] : [{}]; } as any;
  let listener: any;
  const globals = { window, document: window.document, location: window.location, getComputedStyle: window.getComputedStyle.bind(window), chrome: { runtime: { id: 'test', onMessage: { addListener(fn: any) { listener = fn; } } } } };
  const originals = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } window.happyDOM.abort(); });
  installAssistantContext();
  return {
    window, doc: window.document,
    capture(): AssistantContext { let result: any; listener({ type: 'assistant-context' }, { id: 'test' }, (value: any) => { result = value; }); return result.context; },
    render(html: string) { window.document.querySelector('main')!.innerHTML = html; },
  };
}
const post = (id = '123', tag = 'article', href = `/author/status/${id}`, timestamp = true) => `<${tag} data-testid="tweet"><div data-testid="User-Name"><a role="link" href="/author">Author @author</a><a role="link" href="${href}">${timestamp ? '<time>20h</time>' : '20h'}</a></div><div data-testid="tweetText">First paragraph.\n\nSecond paragraph.</div><button data-testid="reply">Reply to ${id}</button></${tag}>`;
const compact = (text = 'First paragraph.\n\nSecond paragraph.') => `<div><div data-testid="User-Name"><a href="/author">Author @author</a><span>20h</span></div><div data-testid="tweetText">${text}</div></div>`;
const editor = (label = '回复') => `<section><div data-testid="tweetTextarea_0" contenteditable="true"></div><button data-testid="tweetButton">${label}</button></section>`;
const modal = (original: string, label = '回复') => `<div role="dialog">${original}${editor(label)}</div>`;

test('captures homepage posts whose author and timestamp anchors have the link role', t => {
  const f = fixture(t); f.render(post() + post('456'));
  const context = f.capture();
  assert.deepEqual(context.posts.map(p => p.id), ['123', '456']);
  assert.equal(context.posts[0].author, '@author');
  assert.equal(context.posts[0].url, 'https://x.com/author/status/123');
  assert.equal(context.posts[0].text, 'First paragraph.\n\nSecond paragraph.');
});
test('captures nested article/tweet wrappers once on the homepage and in a reply dialog', t => {
  const f = fixture(t);
  const wrapped = `<article role="article"><div>${post('123', 'div')}</div></article>`;
  f.render(wrapped);
  assert.deepEqual(f.capture().posts.map(p => p.id), ['123']);
  f.doc.querySelector<TestElement>('[data-testid="tweetText"]')!.click();
  assert.equal(f.capture().target?.id, '123');
  f.render(modal(wrapped));
  const context = f.capture();
  assert.deepEqual(context.posts.map(p => p.id), ['123']);
  assert.equal(context.target?.text, 'First paragraph.\n\nSecond paragraph.');
  assert.equal(context.composer?.targetId, '123');
});
test('recognizes a detail post with an article-only root and a link-role timestamp', t => {
  const f = fixture(t);
  f.window.history.pushState({}, '', '/author/status/123');
  f.render(post().replace('data-testid="tweet"', 'role="article"'));
  assert.equal(f.capture().target?.id, '123');
});
test('excludes unmarked quote cards even when their timestamp anchors also have the link role', t => {
  const f = fixture(t);
  const quote = `<div role="link">${post('456', 'div').replace(' data-testid="tweet"', '').replace('First paragraph.', 'Quoted text.')}</div>`;
  f.render(modal(post().replace('<button data-testid="reply">', `${quote}<button data-testid="reply">`)));
  const context = f.capture();
  assert.deepEqual(context.posts.map(p => p.id), ['123']);
  assert.equal(context.target?.id, '123');
  assert.equal(context.target?.text, 'First paragraph.\n\nSecond paragraph.');
});
test('does not unwrap a nested quote into an article-only original or use its text', t => {
  const f = fixture(t);
  const original = post().replace('data-testid="tweet"', 'role="article"')
    .replace('<div data-testid="tweetText">First paragraph.\n\nSecond paragraph.</div>', '')
    .replace('<button data-testid="reply">', `${post('456', 'div')}<button data-testid="reply">`);
  f.render(modal(original));
  const context = f.capture();
  assert.deepEqual(context.posts.map(p => p.id), ['123']);
  assert.equal(context.target?.id, '123');
  assert.equal(context.target?.text, '');
});

test('recognizes an already-open compact reply modal with an absolute status link and no time element', t => {
  const f = fixture(t); f.render(post('456') + modal(post('123', 'div', 'https://x.com/author/status/123', false)));
  const context = f.capture();
  assert.equal(context.composer?.scene, 'reply'); assert.equal(context.composer?.targetId, '123');
  assert.equal(context.target?.id, '123'); assert.equal(context.target?.text, 'First paragraph.\n\nSecond paragraph.');
});
test('recognizes unmarked compact originals and legacy twitter.com permalinks', t => {
  const f = fixture(t); f.render(modal(post('123', 'div', 'https://twitter.com/author/status/123').replace(' data-testid="tweet"', '')));
  assert.equal(f.capture().target?.id, '123');
});
test('keeps an explicit reply target across compose navigation and feed virtualization', t => {
  const f = fixture(t); f.render(post());
  f.doc.querySelector<TestElement>('[data-testid="reply"]')!.click();
  f.window.history.pushState({}, '', '/compose/post'); f.render(modal(compact()));
  const context = f.capture(); assert.equal(context.target?.id, '123'); assert.equal(context.composer?.targetId, '123');
  assert.ok(context.posts.some(p => p.id === '123'));
  f.doc.querySelector<TestElement>('[contenteditable]')!.focus();
  assert.equal(f.capture().composer?.id, context.composer?.id);
});
test('matches an ID-less original in an already-open modal only when author and text uniquely match', t => {
  const f = fixture(t); f.render(post() + modal(compact()));
  assert.equal(f.capture().target?.id, '123');
  f.render(post() + post('456') + modal(compact()));
  assert.equal(f.capture().target, null);
});
test('ignores quoted posts when choosing the original', t => {
  const f = fixture(t);
  const quoted = post().replace('<button data-testid="reply">', `<div role="link">${post('456')}</div><button data-testid="reply">`);
  f.render(modal(quoted)); assert.equal(f.capture().target?.id, '123');
});
test('ambiguous reply ancestors do not fall back to the last generic feed click', t => {
  const f = fixture(t); f.render(post()); f.doc.querySelector<TestElement>('[data-testid="tweetText"]')!.click();
  f.render(modal(post() + post('456')));
  assert.equal(f.capture().target, null); assert.equal(f.capture().composer?.targetId, null);
});
test('explicit reply intent disambiguates ancestors only in its matching dialog', t => {
  const f = fixture(t); f.render(post()); f.doc.querySelector<TestElement>('[data-testid="reply"]')!.click();
  f.render(modal(post('456') + post())); assert.equal(f.capture().target?.id, '123');
  f.render(modal(compact('A different original.'))); assert.equal(f.capture().target, null);
  f.render(modal(compact())); assert.equal(f.capture().target, null);
});
test('reply intent cannot cross account changes or unrelated navigation', t => {
  const f = fixture(t); f.render(post()); f.doc.querySelector<TestElement>('[data-testid="reply"]')!.click();
  f.doc.cookie = 'twid=u%3D99'; f.render(modal(compact())); assert.equal(f.capture().target, null);
  f.render(post()); f.doc.querySelector<TestElement>('[data-testid="reply"]')!.click();
  f.window.history.pushState({}, '', '/explore'); f.render(modal(compact())); assert.equal(f.capture().target, null);
});
test('a new post composer is not turned into a reply by a feed post or quoted card', t => {
  const f = fixture(t); f.render(post() + modal(post('456'), 'Post'));
  assert.equal(f.capture().composer?.scene, 'post'); assert.equal(f.capture().composer?.targetId, null);
});
