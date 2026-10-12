import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfirmationGate } from './confirmation-gate.ts';

test('cancelling or dismissing a confirmation sends no request and preserves the draft', async () => {
  let finish!: (approved: boolean) => void, requests = 0, cleaned = 0;
  let draft = '/reply 保留我的草稿';
  const confirm = createConfirmationGate((_details, resolve) => { finish = resolve; return () => cleaned++; });
  const send = async () => { if (!await confirm({title: '确认生成', message: draft})) return; requests++; draft = ''; };
  const pending = send();
  assert.equal(requests, 0);
  finish(false); await pending;
  assert.equal(requests, 0); assert.equal(draft, '/reply 保留我的草稿'); assert.equal(cleaned, 1);
});

test('one approval cannot authorize repeated clicks or a different action', async () => {
  let finish!: (approved: boolean) => void, prompts = 0, requests = 0;
  const confirm = createConfirmationGate((_details, resolve) => { prompts++; finish = resolve; return () => {}; });
  const run = async (title: string) => { if (await confirm({title, message: '执行操作'})) requests++; };
  const first = run('更新画像');
  await run('更新画像'); await run('立即执行');
  assert.equal(prompts, 1); assert.equal(requests, 0);
  finish(true); finish(true); await first;
  assert.equal(requests, 1);
  const next = run('更新画像');
  assert.equal(prompts, 2); assert.equal(requests, 1);
  finish(false); await next;
  assert.equal(requests, 1);
});

test('unavailable confirmation UI fails closed and allows the next request', async () => {
  let shows = 0;
  const confirm = createConfirmationGate((_details, finish) => {
    if (++shows === 1) throw new Error('Cannot show confirmation');
    finish(false); return () => {};
  });
  assert.equal(await confirm({title: '更新画像', message: ''}), false);
  assert.equal(await confirm({title: '更新画像', message: ''}), false);
  assert.equal(shows, 2);
});
