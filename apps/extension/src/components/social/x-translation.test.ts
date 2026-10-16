import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { createXTranslator, observeXDom } from './x-translation.ts';
import type { TranslationProvider, TranslationResult } from '../../common/translation.ts';

const wait = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));
const post = (text: string, language = 'en') => `<article role="article"><div data-testid="tweetText" lang="${language}">${text}</div></article>`;
function fixture(t: TestContext, translate: (text: string) => Promise<string | TranslationResult> = async text => `译文：${text}`) {
  const window = new Window({ url: 'https://x.com/home' });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
  Object.defineProperty(globalThis, 'MutationObserver', { value: window.MutationObserver, configurable: true });
  const doc = window.document as unknown as Document;
  const requests: string[] = [], errors: unknown[] = [], displays: string[] = [];
  let visible = '';
  let provider: TranslationProvider | undefined;
  const translator = createXTranslator({ document: doc, targetLanguage: 'zh-CN', retryDelay: 20,
    translate: async text => { requests.push(text); const result = await translate(text);
      return typeof result === 'string' ? { text: result, provider: 'google' } : result; },
    show: (text, _x, _y, source) => { visible = text; provider = source; displays.push(text); },
    hide: () => { visible = ''; provider = undefined; }, onError: e => errors.push(e) });
  const stop = observeXDom(doc.body, translator.scan, 10);
  t.after(() => { stop(); translator.stop(); window.happyDOM.abort();
    if (previous) Object.defineProperty(globalThis, 'MutationObserver', previous); else Reflect.deleteProperty(globalThis, 'MutationObserver'); });
  return { window, doc, requests, errors, displays, translator, visible: () => visible, provider: () => provider,
    hover: (element: Element) => element.dispatchEvent(new window.MouseEvent('mouseenter', { clientX: 30, clientY: 50 }) as unknown as Event),
    leave: (element: Element) => element.dispatchEvent(new window.MouseEvent('mouseleave') as unknown as Event) };
}

test('new tweets translate while unrelated timeline mutations continue, without duplicate requests', async t => {
  const f = fixture(t);
  f.doc.body.innerHTML = `<aside></aside><main>${post('First tweet')}</main>`;
  f.translator.scan(); await wait();
  f.doc.querySelector('main')!.insertAdjacentHTML('beforeend', post('Newly loaded tweet'));
  const ticker = setInterval(() => f.doc.querySelector('aside')!.appendChild(f.doc.createElement('i')), 2);
  t.after(() => clearInterval(ticker));
  await wait(80); // No quiet period longer than the observer delay.
  assert.deepEqual(f.requests, ['First tweet', 'Newly loaded tweet']);
  f.hover(f.doc.querySelectorAll('[data-testid="tweetText"]')[1]!);
  assert.equal(f.visible(), '译文：Newly loaded tweet');
  clearInterval(ticker); await wait(20);
  assert.equal(f.requests.length, 2);
});

test('text hydration, language attributes and nested text/links/emoji are detected after insertion', async t => {
  const f = fixture(t);
  f.doc.body.innerHTML = post('', 'zh'); f.translator.scan();
  const element = f.doc.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
  element.innerHTML = 'Hello <a href="/author">@author</a><br><strong>New idea</strong> <img alt="🚀">';
  await wait(25); assert.equal(f.requests.length, 0);
  element.lang = 'en'; await wait(25);
  assert.deepEqual(f.requests, ['Hello @author\nNew idea 🚀']);
  f.hover(element); assert.equal(f.visible(), '译文：Hello @author\nNew idea 🚀');
  element.firstChild!.nodeValue = 'Welcome '; await wait(25);
  assert.equal(f.requests[f.requests.length - 1], 'Welcome @author\nNew idea 🚀');
  assert.equal(f.visible(), '译文：Welcome @author\nNew idea 🚀');
});

test('recycled tweet nodes invalidate cached and late results; hovering before completion shows the new result immediately', async t => {
  const resolvers: Array<(text: string) => void> = [];
  const f = fixture(t, () => new Promise(resolve => resolvers.push(resolve)));
  f.doc.body.innerHTML = post('Old tweet'); f.translator.scan();
  const element = f.doc.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
  f.hover(element); assert.equal(f.visible(), '正在翻译…');
  element.firstChild!.nodeValue = 'Replacement tweet';
  resolvers[0]!('旧译文'); await wait(25);
  assert.ok(!f.displays.includes('旧译文')); assert.equal(f.requests.length, 2);
  resolvers[1]!('新译文'); await wait();
  assert.equal(f.visible(), '新译文'); assert.equal(element.dataset.hasTranslator, 'true');
  element.textContent = 'Third tweet'; await wait(25);
  assert.notEqual(f.visible(), '新译文');
  resolvers[2]!('第三条译文'); await wait(); assert.equal(f.visible(), '第三条译文');
});

test('a removed node or stopped account cannot display a late result or send a scheduled retry', async t => {
  const pending: Array<(text: string) => void> = [];
  const f = fixture(t, () => new Promise(resolve => pending.push(resolve)));
  f.doc.body.innerHTML = post('Detached'); f.translator.scan();
  const element = f.doc.querySelector('[data-testid="tweetText"]')!;
  f.hover(element); element.closest('article')!.remove(); await wait(25);
  pending[0]!('stale'); await wait(); assert.equal(f.visible(), '');
  f.doc.body.innerHTML = post('Old account'); f.translator.scan();
  f.hover(f.doc.querySelector('[data-testid="tweetText"]')!); f.translator.stop();
  pending[1]!('wrong account'); await wait(); assert.equal(f.visible(), '');
  assert.ok(!f.displays.includes('wrong account')); assert.ok(!f.displays.includes('stale'));
  f.translator.scan(); assert.equal(f.requests.length, 2);
});

test('empty or failed translations retry once, recover on hover, and never loop on page mutations', async t => {
  let attempts = 0;
  const f = fixture(t, async () => ++attempts === 1 ? '' : 'Recovered');
  f.doc.body.innerHTML = post('Retry'); f.translator.scan();
  const element = f.doc.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
  f.hover(element); await wait(10);
  assert.notEqual(element.dataset.hasTranslator, 'true');
  assert.equal(f.visible(), '翻译暂时失败，正在重试…');
  await wait(40); assert.equal(attempts, 2); assert.equal(f.visible(), 'Recovered');
  f.leave(element); assert.equal(f.visible(), '');
  f.hover(element); assert.equal(f.visible(), 'Recovered');
  assert.equal(attempts, 2);
});

test('persistent failures remain visible with a bounded request count, and disabling translation cancels retries', async t => {
  const f = fixture(t, async () => { throw new Error('mock offline'); });
  f.doc.body.innerHTML = post('Failure'); f.translator.scan();
  f.hover(f.doc.querySelector('[data-testid="tweetText"]')!);
  await wait(55); assert.equal(f.requests.length, 2); assert.match(f.visible(), /翻译失败/);
  for (let i = 0; i < 5; i++) { f.translator.scan(); await wait(5); }
  assert.equal(f.requests.length, 2);
  f.doc.body.innerHTML = post('Stop pending retry'); f.translator.scan(); await wait(5);
  f.translator.stop(); await wait(40);
  assert.equal(f.requests.length, 3);
});

test('target-language tweets are skipped, canonical tweet text needs no direct span, nested language nodes translate once', async t => {
  const f = fixture(t);
  f.doc.body.innerHTML = post('中文', 'zh-Hans') + post('Direct text', '') + post('<div lang="en">Nested text</div>');
  f.translator.scan(); await wait(25);
  assert.deepEqual(f.requests, ['Direct text', 'Nested text']);
});

test('dismissing hover while a request is in flight does not reopen the tooltip when it completes', async t => {
  let resolve!: (text: string) => void;
  const f = fixture(t, () => new Promise(done => { resolve = done; }));
  f.doc.body.innerHTML = post('In flight'); f.translator.scan();
  const element = f.doc.querySelector('[data-testid="tweetText"]')!;
  f.hover(element); f.translator.dismiss(); resolve('Done'); await wait();
  assert.equal(f.visible(), '');
  f.hover(element); assert.equal(f.visible(), 'Done');
});

test('each cached tweet keeps its actual provider; reused nodes clear the old label while awaiting a new result', async t => {
  const providers: Record<string, TranslationProvider> = { Google: 'google', DeepL: 'deepl', AI: 'ai' };
  let finish!: (result: TranslationResult) => void;
  const f = fixture(t, async text => providers[text] ? { text: `译文：${text}`, provider: providers[text]! }
    : new Promise<TranslationResult>(resolve => { finish = resolve; }));
  f.doc.body.innerHTML = post('Google') + post('DeepL') + post('AI');
  f.translator.scan(); await wait();
  const elements = f.doc.querySelectorAll<HTMLElement>('[data-testid="tweetText"]');
  for (const [index, provider] of (['google', 'deepl', 'ai'] as const).entries()) {
    f.hover(elements[index]!); assert.equal(f.provider(), provider); f.leave(elements[index]!);
  }
  f.hover(elements[0]!); assert.equal(f.provider(), 'google'); assert.equal(f.requests.length, 3);
  elements[0]!.textContent = 'Recycled'; await wait(25);
  assert.equal(f.provider(), undefined); assert.equal(f.visible(), '正在翻译…');
  finish({ text: '改用 DeepL 的译文', provider: 'deepl' }); await wait();
  assert.equal(f.provider(), 'deepl'); assert.equal(f.visible(), '改用 DeepL 的译文');
  f.hover(elements[2]!); assert.equal(f.provider(), 'ai');
  f.hover(elements[0]!); assert.equal(f.provider(), 'deepl'); assert.equal(f.requests.length, 4);
});

test('loading, retrying and failure do not claim the provider of the previous hovered tweet', async t => {
  const f = fixture(t, async text => {
    if (text === 'Success') return { text: '成功', provider: 'ai' };
    throw new Error('mock unavailable');
  });
  f.doc.body.innerHTML = post('Success'); f.translator.scan(); await wait();
  f.hover(f.doc.querySelector('[data-testid="tweetText"]')!); assert.equal(f.provider(), 'ai');
  f.doc.body.insertAdjacentHTML('beforeend', post('Failure')); f.translator.scan();
  f.hover(f.doc.querySelectorAll('[data-testid="tweetText"]')[1]!);
  assert.equal(f.provider(), undefined);
  await wait(10); assert.match(f.visible(), /正在重试/); assert.equal(f.provider(), undefined);
  await wait(45); assert.match(f.visible(), /翻译失败/); assert.equal(f.provider(), undefined);
});
