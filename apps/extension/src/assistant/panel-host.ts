/** An isolated extension frame keeps the chat UI separate from X's post/reply DOM. */
export function installAssistantPanel(): void {
  let host: HTMLElement | undefined, frame: HTMLIFrameElement | undefined;
  let previousFocus: HTMLElement | null = null;
  let open = false;
  const focusChat = () => {
    frame?.focus(); frame?.contentWindow?.focus();
    frame?.contentWindow?.postMessage({ type: 'fast-social-assistant-shown' }, '*');
  };
  function show(visible: boolean) {
    if (!host && visible) {
      host = document.createElement('fast-social-assistant');
      host.style.cssText = 'all:initial!important;position:fixed!important;inset:0 0 0 auto!important;width:min(420px,100vw)!important;height:100dvh!important;z-index:2147483647!important;';
      const shadow = host.attachShadow({ mode: 'closed' });
      frame = document.createElement('iframe');
      frame.title = '聊天助手';
      frame.src = chrome.runtime.getURL('src/pages/assistant/assistant.html');
      frame.allow = 'clipboard-write';
      frame.style.cssText = 'display:block;box-sizing:border-box;width:100%;height:100%;border:0;border-left:1px solid #e5e5e5;background:#fff;box-shadow:-8px 0 28px #0000000a;color-scheme:light;';
      frame.addEventListener('load', () => { if (open) focusChat(); });
      shadow.append(frame); document.documentElement.append(host);
    }
    if (!host) return;
    if (visible && !open) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    open = visible;
    host.style.setProperty('display', visible ? 'block' : 'none', 'important');
    // Hiding keeps the frame alive: an in-flight response can finish and save normally.
    if (visible) focusChat();
    else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message.type !== 'assistant-panel') return false;
    show(message.mode === 'open' || !open);
    respond({ ok: true, open });
    return false;
  });
}
