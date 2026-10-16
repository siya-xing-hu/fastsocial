import type { TranslationProvider, TranslationResult } from '../../common/translation';

/** Batch DOM changes without waiting for the whole timeline to become idle. */
export function observeXDom(root: HTMLElement, callback: () => void, delay = 150): () => void {
  const view = root.ownerDocument.defaultView!;
  let timer: number | undefined;
  const observer = new MutationObserver(() => {
    if (timer !== undefined) return;
    timer = view.setTimeout(() => { timer = undefined; callback(); }, delay);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['lang', 'data-testid', 'href'] });
  return () => { observer.disconnect(); view.clearTimeout(timer); };
}

function tweetText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1) return '';
  const element = node as HTMLElement;
  if (element.tagName === 'BR') return '\n';
  if (element.tagName === 'IMG') return element.getAttribute('alt') ?? '';
  return [...element.childNodes].map(tweetText).join('') + (/^(DIV|P)$/.test(element.tagName) ? '\n' : '');
}

interface Source { text: string; language: string }
interface Binding {
  source: Source;
  status: 'loading' | 'ready' | 'retrying' | 'failed';
  result?: TranslationResult;
  attempts: number;
  retryTimer?: number;
  point?: { x: number; y: number };
  enter: (event: Event) => void;
  leave: () => void;
}
interface Options {
  document: Document;
  targetLanguage: string;
  translate: (text: string) => Promise<TranslationResult>;
  show: (text: string, x: number, y: number, provider?: TranslationProvider) => void;
  hide: () => void;
  onError: (error: unknown) => void;
  retryDelay?: number;
}

/** Own requests and hover handlers per live text node, not per recycled DOM marker. */
export function createXTranslator(options: Options) {
  const { document, targetLanguage, translate, show, hide, onError } = options;
  const view = document.defaultView!;
  const target = targetLanguage.toLowerCase().split('-')[0];
  const bindings = new Map<HTMLElement, Binding>();
  let stopped = false;
  let shown: Binding | undefined;
  function source(element: HTMLElement): Source | undefined {
    const language = element.lang.toLowerCase();
    if (!element.isConnected || (language && language.split('-')[0] === target)) return;
    const text = tweetText(element).trim();
    return text ? { text, language } : undefined;
  }
  function valid(element: HTMLElement, binding: Binding): boolean {
    const current = source(element);
    return !stopped && bindings.get(element) === binding
      && current?.text === binding.source.text && current?.language === binding.source.language;
  }
  function display(binding: Binding) {
    if (!binding.point) return;
    shown = binding;
    const text = binding.status === 'ready' ? binding.result!.text
      : binding.status === 'failed' ? '翻译失败，请刷新页面后重试。'
      : binding.status === 'retrying' ? '翻译暂时失败，正在重试…' : '正在翻译…';
    show(text, binding.point.x + 10, binding.point.y + 10,
      binding.status === 'ready' ? binding.result?.provider : undefined);
  }
  function remove(element: HTMLElement, binding: Binding) {
    view.clearTimeout(binding.retryTimer);
    element.removeEventListener('mouseenter', binding.enter);
    element.removeEventListener('mousemove', binding.enter);
    element.removeEventListener('mouseleave', binding.leave);
    element.removeAttribute('data-has-translator');
    bindings.delete(element);
    if (shown === binding) { hide(); shown = undefined; }
  }
  async function request(element: HTMLElement, binding: Binding) {
    if (!valid(element, binding)) return;
    binding.attempts++;
    try {
      const result = await translate(binding.source.text);
      if (!valid(element, binding)) return;
      if (!result.text.trim()) throw new Error('翻译服务未返回译文');
      binding.result = result;
      binding.status = 'ready';
      element.setAttribute('data-has-translator', 'true');
      display(binding);
    } catch (error) {
      if (!valid(element, binding)) return;
      onError(error);
      binding.status = binding.attempts < 2 ? 'retrying' : 'failed';
      display(binding);
      // One bounded retry for a read-only translation; mutations must not cause request loops.
      if (binding.status === 'retrying') binding.retryTimer = view.setTimeout(() => {
        binding.retryTimer = undefined;
        void request(element, binding);
      }, options.retryDelay ?? 3000);
    }
  }
  function scan() {
    if (stopped) return;
    const hovering = new Map<HTMLElement, Binding['point']>();
    for (const [element, binding] of bindings) if (!valid(element, binding)) {
      hovering.set(element, binding.point); remove(element, binding);
    }
    const elements = document.querySelectorAll<HTMLElement>('[data-testid="tweetText"], article[role="article"] div[lang]');
    for (const element of elements) {
      if (bindings.has(element)) continue;
      const canonical = element.closest('[data-testid="tweetText"]');
      if ((canonical && canonical !== element) || element.querySelector('[data-testid="tweetText"]')) continue;
      const current = source(element);
      if (!current) continue;
      const binding: Binding = { source: current, status: 'loading', attempts: 0, point: hovering.get(element),
        enter: event => {
          if (!valid(element, binding)) { scan(); return; }
          const mouse = event as MouseEvent;
          binding.point = { x: mouse.clientX, y: mouse.clientY }; display(binding);
        },
        leave: () => { binding.point = undefined; if (shown === binding) { hide(); shown = undefined; } },
      };
      bindings.set(element, binding);
      element.removeAttribute('data-has-translator');
      element.addEventListener('mouseenter', binding.enter);
      element.addEventListener('mousemove', binding.enter);
      element.addEventListener('mouseleave', binding.leave);
      display(binding);
      void request(element, binding);
    }
  }
  return { scan,
    dismiss() { for (const binding of bindings.values()) binding.point = undefined; hide(); shown = undefined; },
    stop() { stopped = true; for (const [element, binding] of bindings) remove(element, binding); },
  };
}
