import { measurePost, type AssistantContext, type PagePost, type SkillKey } from "@fast-social/contracts";
import { xAccountIdentity } from "../common/account-policy.ts";
import { draftError } from "./context-guard.ts";
import { ownBlueBadge } from './x-account-badge.ts';
import { POST, postElements, postFrom, showsPost, visible } from './x-post-context.ts';

const EDITOR = '[data-testid="tweetTextarea_0"][contenteditable="true"]';
const clip = (v: string, limit: number) => v.slice(0, limit);

/** Observe native controls without inserting anything into the page layout. */
export function installAssistantContext(): void {
  const documentId = crypto.randomUUID();
  const editorIds = new WeakMap<HTMLElement, string>();
  let lastEditor: HTMLElement | null = null;
  let clickedPost: string | null = null;
  let observedScope = "";
  let observedAccount = "";
  let replyIntent: { post: PagePost; at: number; dialog: HTMLElement | null } | null = null;
  const account = () => {
    const switcher = document.querySelector<HTMLElement>('[data-testid="SideNav_AccountSwitcher_Button"]');
    const text = switcher?.innerText ?? switcher?.textContent ?? "";
    const identity = xAccountIdentity(document.cookie, text,
      document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href") ?? "");
    const handleAt = identity.username ? text.toLowerCase().lastIndexOf('@' + identity.username) : -1;
    const displayName = handleAt > 0 ? text.slice(0, handleAt).trim().slice(0, 120) : "";
    const blueVerified = ownBlueBadge(document, identity.username, location.pathname);
    return { ...identity, ...(displayName ? { displayName } : {}), ...(blueVerified ? { blueVerified } : {}) };
  };
  function syncScope() {
    const { actorId, username } = account();
    const identity = JSON.stringify({ actorId, username });
    const scope = location.href + identity;
    if (identity !== observedAccount || (scope !== observedScope && !/^\/compose\/(post|tweet)\/?$/.test(location.pathname))) replyIntent = null;
    if (replyIntent && (replyIntent.dialog ? !replyIntent.dialog.isConnected : Date.now() - replyIntent.at > 10000)) replyIntent = null;
    observedAccount = identity;
    if (scope !== observedScope) { lastEditor = null; clickedPost = null; observedScope = scope; }
  }
  document.addEventListener("focusin", event => {
    syncScope();
    const target = event.target as Element;
    const editor = target.closest<HTMLElement>(EDITOR);
    if (editor) {
      lastEditor = editor;
      const dialog = editor.closest<HTMLElement>('[role="dialog"]');
      if (dialog && replyIntent && !replyIntent.dialog && postElements(dialog).some(el => showsPost(el, replyIntent!.post))) replyIntent.dialog = dialog;
    }
  }, true);
  document.addEventListener("click", event => {
    syncScope();
    const element = event.target as Element;
    const article = element.closest(POST);
    if (article) {
      const post = postFrom(article);
      clickedPost = post?.id ?? null;
      if (element.closest('[data-testid="reply"]')) replyIntent = post ? { post, at: Date.now(), dialog: null } : null;
    }
  }, true);

  function capture(): { context: AssistantContext; editor: HTMLElement | null } {
    syncScope();
    const allPosts = postElements(document)
      .map(postFrom).filter((p): p is PagePost => p !== null);
    const posts = [...new Map(allPosts.map(p => [p.id, p])).values()].slice(0, 20);
    const editors = [...document.querySelectorAll<HTMLElement>(EDITOR)].filter(visible);
    const modalEditors = editors.filter(e => e.closest('[role="dialog"]'));
    const editor = modalEditors.length === 1 ? modalEditors[0]
      : lastEditor?.isConnected && editors.includes(lastEditor) ? lastEditor
      : editors.length === 1 ? editors[0] : null;
    let targetId = /^\/[^/]+\/status\/(\d+)/.exec(location.pathname)?.[1] ?? clickedPost;
    const selection = document.getSelection();
    const anchor = selection?.anchorNode?.parentElement?.closest(POST);
    if (selection?.toString().trim() && anchor) targetId = postFrom(anchor)?.id ?? targetId;
    let composer: AssistantContext["composer"] = null;
    let replyPost: PagePost | null = null;
    if (editor) {
      if (!editorIds.has(editor)) editorIds.set(editor, crypto.randomUUID());
      const dialog = editor.closest<HTMLElement>('[role="dialog"]');
      let root: HTMLElement | null = editor.parentElement;
      while (root && root !== document.body && !root.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')) root = root.parentElement;
      const action = root?.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
      const label = `${action?.textContent ?? ""} ${action?.getAttribute("aria-label") ?? ""}`;
      const dialogElements = dialog ? postElements(dialog) : [];
      const dialogPosts = [...new Map(dialogElements.map(postFrom).filter((p): p is PagePost => p !== null).map(p => [p.id, p])).values()];
      const scene = /\breply\b|回复|回覆/i.test(label) ? "reply"
        : /\bpost\b|发布|發佈|发帖|發帖/i.test(label) ? "post"
        : dialogPosts.length || (!dialog && /\/status\/\d+/.test(location.pathname)) ? "reply" : "post";
      if (scene === 'reply' && dialog) {
        const intended = replyIntent && (!replyIntent.dialog || replyIntent.dialog === dialog) && dialogElements.some(el => showsPost(el, replyIntent!.post)) ? replyIntent.post : null;
        const matches = [...new Map(allPosts.filter(p => dialogElements.some(el => showsPost(el, p))).map(p => [p.id, p])).values()];
        replyPost = intended ?? (matches.length === 1 ? matches[0] : null);
        if (intended) replyIntent!.dialog = dialog;
        else replyIntent = null;
      } else if (scene === 'reply') {
        const parent = editor.closest(POST);
        const id = parent ? postFrom(parent)?.id : /^\/[^/]+\/status\/(\d+)/.exec(location.pathname)?.[1];
        replyPost = allPosts.find(p => p.id === id) ?? null;
      }
      // An ambiguous open reply must not silently fall back to a background feed post.
      if (scene === 'reply') targetId = replyPost?.id ?? null;
      composer = { id: editorIds.get(editor)!, scene, text: editor.innerText, targetId: replyPost?.id ?? null };
    }
    const target = replyPost ?? allPosts.find(p => p.id === targetId) ?? null;
    if (target && !posts.some(p => p.id === target.id)) { if (posts.length === 20) posts.pop(); posts.unshift(target); }
    return { editor, context: {
      documentId, url: location.href, title: clip(document.title, 500), account: account(),
      selection: clip(selection?.toString().trim() ?? "", 8000), posts, target, composer,
    } };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.type === "assistant-context") {
      respond({ ok: true, context: capture().context }); return false;
    }
    if (message.type !== "assistant-fill") return false;
    try {
      const current = capture();
      const frozen = message.context as AssistantContext;
      const error = draftError(frozen, current.context, message.skill as SkillKey);
      if (error) throw new Error(error);
      if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 50000) throw new Error("草稿内容无效。");
      const limit = message.maxWeightedLength === 25000 ? 25000 : 280;
      if (!measurePost(message.text, limit).valid) throw new Error(`文案不符合当前账号的 ${limit} 加权字符限制，请重新生成。`);
      const editor = current.editor!;
      editor.focus();
      const range = document.createRange(); range.selectNodeContents(editor);
      const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      const data = new DataTransfer(); data.setData("text/plain", message.text);
      // X's native Draft.js paste handler updates its state as well as the DOM.
      const unhandled = editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      if (unhandled) document.execCommand("insertText", false, message.text);
      window.setTimeout(() => {
        const normalize = (v: string) => v.replace(/\r\n/g, "\n").trim();
        if (normalize(editor.innerText) !== normalize(message.text)) {
          respond({ ok: false, error: "未能确认草稿已完整填入，请检查 X 输入框，或复制结果。" }); return;
        }
        respond({ ok: true, composer: { ...current.context.composer!, text: editor.innerText } });
      }, 100);
      return true;
    } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : "填入失败" }); return false; }
  });
}
