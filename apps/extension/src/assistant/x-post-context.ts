import type { PagePost } from '@fast-social/contracts';

export const POST = '[data-testid="tweet"], article[role="article"]';
const TEXT = '[data-testid="tweetText"]';
const QUOTE_CARD = '[role="link"]:not(a[href])';
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const postText = (el?: HTMLElement) => el?.textContent?.includes('\n') ? el.textContent : el?.innerText ?? el?.textContent ?? '';
export const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

function permalink(link: Element): Omit<PagePost, 'text'> | null {
  try {
    const url = new URL(link.getAttribute('href') ?? '', 'https://x.com');
    if (!/^(www\.|mobile\.)?(x|twitter)\.com$/.test(url.hostname)) return null;
    const match = /^\/([\w]+)\/status\/(\d+)(?:\/|$)/.exec(url.pathname);
    return match ? { id: match[2], author: '@' + match[1], url: `https://x.com/${match[1]}/status/${match[2]}` } : null;
  } catch { return null; }
}

function inQuote(root: Element, el: Element): boolean {
  // Quote cards have their own header/time. Ordinary author and timestamp
  // anchors also use role="link" and must remain part of the original post.
  for (let card = el.closest(QUOTE_CARD); card && card !== root && root.contains(card); card = card.parentElement?.closest(QUOTE_CARD) ?? null) {
    if (card.querySelector('[data-testid="User-Name"], time')) return true;
  }
  return false;
}

function contentRoot(root: Element): Element {
  if (!root.matches('article[role="article"]:not([data-testid="tweet"])')) return root;
  const nested = [...root.querySelectorAll('[data-testid="tweet"]')].filter(el => el.parentElement?.closest(POST) === root);
  if (nested.length !== 1 || inQuote(root, nested[0])) return root;
  // Only unwrap a layout shell. An original with its own header/text must not
  // become its nested quoted post, including originals with no text.
  const content = [...root.querySelectorAll(`${TEXT}, [data-testid="User-Name"], time`)];
  return content.every(el => nested[0].contains(el)) ? nested[0] : root;
}

// Compact originals in X's reply dialog are not always article elements.
export function postElements(root: ParentNode): Element[] {
  const elements = [...root.querySelectorAll(POST)].filter(el => !el.parentElement?.closest(POST));
  for (const text of root.querySelectorAll(TEXT)) {
    if (text.closest(POST)) continue;
    let candidate = text.parentElement;
    while (candidate && candidate !== root && !candidate.matches('[role="dialog"]')) {
      if (candidate.querySelector('[contenteditable="true"]') || candidate.querySelectorAll(TEXT).length !== 1) break;
      if (candidate.querySelector('[data-testid="User-Name"]')) { elements.push(candidate); break; }
      candidate = candidate.parentElement;
    }
  }
  return [...new Set(elements)].filter(visible);
}

function own(root: Element, selector: string): Element[] {
  return [...root.querySelectorAll(selector)].filter(el => {
    const post = el.closest(POST);
    return (!post || post === root) && !inQuote(root, el);
  });
}

export function postFrom(root: Element): PagePost | null {
  root = contentRoot(root);
  const times = own(root, 'time').map(time => time.closest('a[href*="/status/"]')).filter((el): el is Element => !!el);
  const links = times.length ? times : own(root, '[data-testid="User-Name"] a[href*="/status/"], a[href*="/status/"]').filter(link => !link.closest(TEXT));
  const identities = [...new Map(links.map(permalink).filter((p): p is Omit<PagePost, 'text'> => !!p).map(p => [p.id, p])).values()];
  if (identities.length !== 1) return null;
  const text = own(root, TEXT)[0] as HTMLElement | undefined;
  return { ...identities[0], text: postText(text).trim().slice(0, 6000) };
}

/** Match an ID-less compact original only with both its author and full visible text. */
export function showsPost(root: Element, post: PagePost): boolean {
  root = contentRoot(root);
  const identified = postFrom(root);
  if (identified) return identified.id === post.id;
  const text = own(root, TEXT)[0] as HTMLElement | undefined;
  if (!post.text || normalize(postText(text).slice(0, 6000)) !== normalize(post.text)) return false;
  return own(root, '[data-testid="User-Name"]').some(name => {
    for (const link of name.querySelectorAll('a[href]')) {
      try {
        const url = new URL(link.getAttribute('href')!, 'https://x.com');
        if (/^(www\.|mobile\.)?(x|twitter)\.com$/.test(url.hostname) && url.pathname.replace(/\/$/, '').toLowerCase() === '/' + post.author.slice(1).toLowerCase()) return true;
      } catch { /* Ignore malformed profile links. */ }
    }
    const handles = name.textContent?.match(/@[A-Za-z0-9_]+/g) ?? [];
    return handles.some(handle => handle.toLowerCase() === post.author.toLowerCase());
  });
}
