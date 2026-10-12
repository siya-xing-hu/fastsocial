export async function openAssistantPanel(mode: 'open' | 'toggle', tab?: Pick<chrome.tabs.Tab, 'id' | 'url'>): Promise<void> {
  const target = tab?.id === undefined ? (await chrome.tabs.query({ active: true, currentWindow: true }))[0] : tab;
  if (!target?.id || !/^https:\/\/([^.\/]+\.)?x\.com\//.test(target.url ?? '')) throw new Error('请先打开 X 页面。');
  let result;
  try { result = await chrome.tabs.sendMessage(target.id, { type: 'assistant-panel', mode }); }
  catch { throw new Error('请刷新 X 页面后，再打开聊天助手。'); }
  if (!result?.ok) throw new Error('请刷新 X 页面后，再打开聊天助手。');
}
