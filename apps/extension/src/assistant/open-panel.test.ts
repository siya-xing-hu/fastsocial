import assert from 'node:assert/strict';
import test from 'node:test';
import { openAssistantPanel } from './open-panel.ts';

test('the shortcut toggles the requested X tab while the popup opens the active X tab', async () => {
  const messages: unknown[] = [];
  const previous = globalThis.chrome;
  globalThis.chrome = { tabs: {
    query: async () => [{ id: 2, url: 'https://x.com/home' }],
    sendMessage: async (id: number, message: unknown) => { messages.push({ id, message }); return { ok: true }; },
  } } as unknown as typeof chrome;
  try {
    await openAssistantPanel('toggle', { id: 1, url: 'https://x.com/user/status/123' });
    await openAssistantPanel('open');
    assert.deepEqual(messages, [
      { id: 1, message: { type: 'assistant-panel', mode: 'toggle' } },
      { id: 2, message: { type: 'assistant-panel', mode: 'open' } },
    ]);
    await assert.rejects(openAssistantPanel('open', { id: 3, url: 'https://example.com' }), /打开 X 页面/);
    assert.equal(messages.length, 2);
    chrome.tabs.sendMessage = (async () => { throw new Error('no content script'); }) as typeof chrome.tabs.sendMessage;
    await assert.rejects(openAssistantPanel('open'), /刷新 X 页面/);
  } finally { globalThis.chrome = previous; }
});
