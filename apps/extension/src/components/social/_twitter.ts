import { log_error } from "../../common/logging";
import { config } from "../../common/storage-config";
import { translateContent } from "../translate/text-translator";
import type { AccountConfiguration } from "@fast-social/contracts";
import { resolveAccountPolicy, xAccountIdentity } from "../../common/account-policy";
import { requestLocalService } from "../../common/local-service";
import { LocalServiceError } from "../../common/local-service-error";

// 扩展 HTMLElement 接口以支持定时器属性
interface ExtendedHTMLElement extends HTMLElement {
  _hideTimer?: NodeJS.Timeout | null;
}

// 定义翻译缓存接口
interface TranslateCache {
  id: string;
  originalText: string;
  translatedText: string;
  element: HTMLElement;
}

// 存储翻译缓存
const translateCache: Map<string, TranslateCache> = new Map();
let twitterGeneration = 0;
let runtimeTimer: number | undefined;
let activeAutoTranslate = false;
let policyVersion = 0;
let stopTranslateObserver: (() => void) | null = null;
let translateTooltip: ExtendedHTMLElement | null = null;
let areTranslateTooltipListenersInstalled = false;

interface TranslationBinding {
  tweetId: string;
  mouseEnterHandler: (event: Event) => void;
  mouseLeaveHandler: () => void;
  mouseMoveHandler: (event: Event) => void;
}

const translationBindings = new Map<HTMLElement, TranslationBinding>();

// 创建翻译提示框
function createTranslateTooltip(): ExtendedHTMLElement {
  if (translateTooltip?.isConnected) return translateTooltip;

  const tooltip = document.createElement("div") as ExtendedHTMLElement;
  tooltip.className = "translate-tooltip fixed z-50";
  tooltip.style.cssText = `
    display: none;
    left: 0;
    top: 0;
  `;
  document.body.appendChild(tooltip);

  // 创建一个简单的DOM结构，使用固定的白底黑字样式，不受页面主题影响
  tooltip.innerHTML = `
    <div style="background-color: white; color: #333; border-radius: 0.5rem; padding: 0.75rem; margin: 0.5rem 0; border: 1px solid #e5e7eb; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
      <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
        <svg xmlns="http://www.w3.org/2000/svg" style="height: 1rem; width: 1rem; color: #666;" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M7 2a1 1 0 011 1v1h3a1 1 0 110 2H9.578a18.87 18.87 0 01-1.724 4.78c.29.354.596.696.914 1.026a1 1 0 11-1.44 1.389 21.034 21.034 0 01-.554-.6 19.098 19.098 0 01-3.107 3.567 1 1 0 01-1.334-1.49 17.087 17.087 0 003.13-3.733 18.992 18.992 0 01-1.487-2.494 1 1 0 111.79-.89c.234.47.489.928.764 1.372.417-.934.752-1.913.997-2.927H3a1 1 0 110-2h3V3a1 1 0 011-1zm6 6a1 1 0 01.894.553l2.991 5.982a.869.869 0 01.02.037l.99 1.98a1 1 0 11-1.79.895L15.383 16h-4.764l-.724 1.447a1 1 0 11-1.788-.894l.99-1.98.019-.038 2.99-5.982A1 1 0 0113 8zm-1.382 6h2.764L13 11.236 11.618 14z" clip-rule="evenodd" />
        </svg>
      </div>
      <span style="display: block; white-space: pre-wrap; line-height: 1.5; font-size: 0.875rem; color: #333;" class="translate-content"></span>
    </div>
  `;

  translateTooltip = tooltip;
  if (!areTranslateTooltipListenersInstalled) {
    const hideCurrentTooltip = () => {
      if (translateTooltip) hideTranslateTooltip(translateTooltip);
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) hideCurrentTooltip();
    });
    window.addEventListener("beforeunload", hideCurrentTooltip);
    window.addEventListener("blur", hideCurrentTooltip);
    document.addEventListener("click", (event) => {
      if (translateTooltip && !translateTooltip.contains(event.target as Node)) {
        hideCurrentTooltip();
      }
    });
    areTranslateTooltipListenersInstalled = true;
  }
  return tooltip;
}

// 显示翻译提示框
function showTranslateTooltip(
  tooltip: ExtendedHTMLElement,
  text: string,
  x: number,
  y: number,
) {
  console.log("显示翻译提示框:", text);

  // 直接更新内容
  const contentElement = tooltip.querySelector(".translate-content");
  if (contentElement) {
    contentElement.textContent = text;
  }

  tooltip.style.display = "block";
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;

  // 清除之前的定时器
  if (tooltip._hideTimer) {
    clearTimeout(tooltip._hideTimer);
  }

  // 设置自动隐藏定时器（30秒后自动隐藏）
  tooltip._hideTimer = setTimeout(() => {
    hideTranslateTooltip(tooltip);
  }, 30000);
}

// 隐藏翻译提示框
function hideTranslateTooltip(tooltip: ExtendedHTMLElement) {
  tooltip.style.display = "none";
  
  // 清除定时器
  if (tooltip._hideTimer) {
    clearTimeout(tooltip._hideTimer);
    tooltip._hideTimer = null;
  }
}

function currentAccount() {
  return xAccountIdentity(document.cookie,
    document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')?.textContent ?? '',
    document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') ?? '');
}

export async function ttTwitterInit(url: string): Promise<void> {
  const generation = ++twitterGeneration;
  window.clearInterval(runtimeTimer);
  stopTranslateObserver?.(); stopTranslateObserver = null;
  resetTwitterTranslations(); activeAutoTranslate = false;
  const identity = JSON.stringify(currentAccount());
  let refreshing = false;
  let signature = '';
  const refresh = async () => {
    if (generation !== twitterGeneration || refreshing) return;
    if (JSON.stringify(currentAccount()) !== identity) { void ttTwitterInit(window.location.href); return; }
    refreshing = true;
    const account = currentAccount();
    const [remote] = await Promise.allSettled([
      requestLocalService<AccountConfiguration>('/api/account-config?' + new URLSearchParams(account)),
    ]);
    refreshing = false;
    if (generation !== twitterGeneration) return;
    if (JSON.stringify(currentAccount()) !== identity) { void ttTwitterInit(window.location.href); return; }
    const serviceUnavailable = remote.status === 'rejected'
      && remote.reason instanceof LocalServiceError
      && remote.reason.code === 'LOCAL_SERVICE_UNAVAILABLE';
    const policy = resolveAccountPolicy(config.value.basic.autoTranslate,
      remote.status === 'fulfilled' ? remote.value : null, serviceUnavailable);
    const nextSignature = JSON.stringify({ autoTranslate: policy.autoTranslate });
    if (nextSignature === signature) return;
    signature = nextSignature;
    policyVersion++;
    activeAutoTranslate = policy.autoTranslate;
    resetTwitterTranslations();
    if (activeAutoTranslate) ttTwitterTranslate(generation);
  };
  stopTranslateObserver = observeXDom(generation, () => {
    if (JSON.stringify(currentAccount()) !== identity) { void ttTwitterInit(window.location.href); return; }
    cleanupDisconnectedTranslations();
    if (activeAutoTranslate) ttTwitterTranslate(generation);
  });
  await refresh();
  if (generation === twitterGeneration) runtimeTimer = window.setInterval(() => { void refresh(); }, 15_000);
}

function observeXDom(
  generation: number,
  callback: () => void,
  debounceMs = 150,
): () => void {
  let timeoutId: number | undefined;
  const observer = new MutationObserver(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      timeoutId = undefined;
      if (generation === twitterGeneration) callback();
    }, debounceMs);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  };
}

function cleanupTranslationBinding(tweetWrapper: HTMLElement): void {
  const binding = translationBindings.get(tweetWrapper);
  if (!binding) return;

  tweetWrapper.removeEventListener("mouseenter", binding.mouseEnterHandler);
  tweetWrapper.removeEventListener("mouseleave", binding.mouseLeaveHandler);
  tweetWrapper.removeEventListener("mousemove", binding.mouseMoveHandler);
  tweetWrapper.removeAttribute("data-has-translator");
  translateCache.delete(binding.tweetId);
  translationBindings.delete(tweetWrapper);
}

function cleanupDisconnectedTranslations(): void {
  for (const tweetWrapper of translationBindings.keys()) {
    if (!tweetWrapper.isConnected) cleanupTranslationBinding(tweetWrapper);
  }
}

function resetTwitterTranslations(): void {
  for (const tweetWrapper of [...translationBindings.keys()]) {
    cleanupTranslationBinding(tweetWrapper);
  }
  document
    .querySelectorAll('[data-has-translator="true"]')
    .forEach((element) => element.removeAttribute("data-has-translator"));
  translateCache.clear();
  if (translateTooltip) hideTranslateTooltip(translateTooltip);
}

function ttTwitterTranslate(generation: number): void {
  if (generation !== twitterGeneration) return;

  const version = policyVersion;
  const target = config.value.basic.targetLang.toLowerCase().split('-')[0];
  const tweetWrapperList = [...document.querySelectorAll<HTMLElement>(
    'main[role="main"] article[role="article"] div[lang]:not([data-has-translator="true"])',
  )].filter(el => !el.lang.toLowerCase().startsWith(target));
  if (tweetWrapperList.length === 0) return;

  const tooltip = createTranslateTooltip();
  for (const tweetWrapper of tweetWrapperList) {
    if (generation !== twitterGeneration) return;
    if (translationBindings.has(tweetWrapper)) continue;

    const textContents = [...tweetWrapper.children]
      .filter((child) => child.tagName === "SPAN")
      .map((span) => span.textContent?.trim() ?? "")
      .filter(Boolean);
    if (textContents.length === 0) continue;

    const originalText = textContents.join(" ");
    const tweetId = tweetWrapper.getAttribute("id")
      || `fast-social-${Math.random().toString(36).slice(2, 11)}`;

    const mouseEnterHandler = (event: Event) => {
      const cache = translateCache.get(tweetId);
      if (!cache) return;
      const mouseEvent = event as MouseEvent;
      showTranslateTooltip(
        tooltip,
        cache.translatedText,
        mouseEvent.clientX + 10,
        mouseEvent.clientY + 10,
      );
    };
    const mouseLeaveHandler = () => hideTranslateTooltip(tooltip);
    const mouseMoveHandler = (event: Event) => {
      const cache = translateCache.get(tweetId);
      if (!cache || tooltip.style.display !== "block") return;
      const mouseEvent = event as MouseEvent;
      showTranslateTooltip(
        tooltip,
        cache.translatedText,
        mouseEvent.clientX + 10,
        mouseEvent.clientY + 10,
      );
    };

    tweetWrapper.setAttribute("data-has-translator", "true");
    tweetWrapper.addEventListener("mouseenter", mouseEnterHandler);
    tweetWrapper.addEventListener("mouseleave", mouseLeaveHandler);
    tweetWrapper.addEventListener("mousemove", mouseMoveHandler);
    translationBindings.set(tweetWrapper, {
      tweetId,
      mouseEnterHandler,
      mouseLeaveHandler,
      mouseMoveHandler,
    });

    void translateContent(config.value.basic.translateProvider, originalText, false)
      .then((translatedText) => {
        if (
          generation !== twitterGeneration
          || version !== policyVersion
          || !activeAutoTranslate
          || !translatedText
          || !tweetWrapper.isConnected
          || !translationBindings.has(tweetWrapper)
        ) return;
        translateCache.set(tweetId, {
          id: tweetId,
          originalText,
          translatedText,
          element: tweetWrapper,
        });
      })
      .catch((error) => log_error("Translate tweet failed", error));
  }
}
