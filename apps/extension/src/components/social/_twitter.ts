import { log_error } from "../../common/logging";
import { config } from "../../common/storage-config";
import { translateContentResult } from "../translate/text-translator";
import type { TranslationProvider } from '../../common/translation';
import type { AccountConfiguration } from "@fast-social/contracts";
import { resolveAccountPolicy, xAccountIdentity } from "../../common/account-policy";
import { requestLocalService } from "../../common/local-service";
import { LocalServiceError } from "../../common/local-service-error";
import { createXTranslator, observeXDom } from "./x-translation";
import { h, render } from 'vue';
import { Sparkles } from 'lucide-vue-next';

// Brand marks from Simple Icons (CC0): https://github.com/simple-icons/simple-icons
const providerIcons = {
  google: { label: 'Google 翻译', color: '#4285f4', path: 'M22.401 4.818h-9.927L10.927 0H1.599C.72 0 .002.719.002 1.599v16.275c0 .878.72 1.597 1.597 1.597h10L13.072 24H22.4c.878 0 1.597-.707 1.597-1.572V6.39c0-.865-.72-1.572-1.597-1.572zm-15.66 8.68c-2.07 0-3.75-1.68-3.75-3.75 0-2.07 1.68-3.75 3.75-3.75 1.012 0 1.86.375 2.512.976l-.99.952a2.194 2.194 0 0 0-1.522-.584c-1.305 0-2.363 1.08-2.363 2.409S5.436 12.16 6.74 12.16c1.507 0 2.13-1.08 2.19-1.808l-2.188-.002V9.066h3.51c.05.23.09.457.09.764 0 2.147-1.434 3.669-3.602 3.669zm16.757 8.93c0 .59-.492 1.072-1.097 1.072h-8.875l3.649-4.03h.005l-.74-2.302.006-.005s.568-.488 1.277-1.24c.712.771 1.63 1.699 2.818 2.805l.771-.772c-1.272-1.154-2.204-2.07-2.89-2.805.919-1.087 1.852-2.455 2.049-3.707h2.034v.002h.002v-.94h-4.532v-1.52h-1.471v1.52H14.3l-1.672-5.21.006.022h9.767c.605 0 1.097.48 1.097 1.072v16.038zm-6.484-7.311c-.536.548-.943.873-.943.873l-.008.004-1.46-4.548h4.764c-.307 1.084-.988 2.108-1.651 2.904-1.176-1.392-1.18-1.844-1.18-1.844h-1.222s.05.678 1.7 2.61z' },
  deepl: { label: 'DeepL 翻译', color: '#0f2b46', path: 'M20.907 4.93953 12.68543.18573a1.3577 1.3577 0 0 0-1.3709 0L3.09298 4.9565a1.3766 1.3766 0 0 0-.68639 1.18233v9.52646a1.3766 1.3766 0 0 0 .68639 1.19363l8.22157 4.75946.06223.03583 4.04856 2.3458-.01131-2.06106.0075-1.1446.0038.01885v-.38467c0-.23006.1188-.43371.29605-.56005l.264-.15086.12633-.06977h-.0075l4.80283-2.7795a1.3803 1.3803 0 0 0 .68639-1.19551V6.13505a1.3803 1.3803 0 0 0-.68642-1.19552m-9.85269 9.68863a1.4275 1.4275 0 0 1-.39976 1.3841 1.4086 1.4086 0 0 1-1.97054 0 1.4199 1.4199 0 0 1 0-2.06294 1.4086 1.4086 0 0 1 2.0422.07543l3.32822-1.91585.6864.38656zm5.77019-2.41367a1.4086 1.4086 0 0 1-1.97054 0 1.4256 1.4256 0 0 1-.3696-1.47837l-.0132.0075-3.7525-2.1723-.05657.05656a1.4086 1.4086 0 0 1-1.97053 0 1.4199 1.4199 0 0 1 0-2.06293 1.4086 1.4086 0 0 1 1.97242 0c.3941.37713.52422.91832.39033 1.40672l3.7808 2.20059.01886-.01886a1.4086 1.4086 0 0 1 1.97242 0 1.42746 1.42746 0 0 1 0 2.06105z' },
  ai: { label: 'AI 翻译', color: '#475569' },
};

// 扩展 HTMLElement 接口以支持定时器属性
interface ExtendedHTMLElement extends HTMLElement {
  _hideTimer?: NodeJS.Timeout | null;
  _leaveTimer?: number;
}

let translator: ReturnType<typeof createXTranslator> | undefined;
let twitterGeneration = 0;
let runtimeTimer: number | undefined;
let activeAutoTranslate = false;
let stopTranslateObserver: (() => void) | null = null;
let translateTooltip: ExtendedHTMLElement | null = null;
let areTranslateTooltipListenersInstalled = false;

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
      <span class="translate-provider" role="img" style="display: none; align-items: center; justify-content: center; width: 18px; height: 18px; margin-bottom: 0.5rem;"></span>
      <span style="display: block; white-space: pre-wrap; line-height: 1.5; font-size: 0.875rem; color: #333;" class="translate-content"></span>
    </div>
  `;

  // Allow the pointer to cross the gap and hover over the provider's title.
  tooltip.addEventListener('mouseenter', () => window.clearTimeout(tooltip._leaveTimer));
  tooltip.addEventListener('mouseleave', () => hideTranslateTooltip(tooltip));
  translateTooltip = tooltip;
  if (!areTranslateTooltipListenersInstalled) {
    const hideCurrentTooltip = () => {
      translator?.dismiss();
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
  provider?: TranslationProvider,
) {
  window.clearTimeout(tooltip._leaveTimer);
  // 直接更新内容
  const contentElement = tooltip.querySelector(".translate-content");
  if (contentElement) {
    contentElement.textContent = text;
  }
  const badge = tooltip.querySelector<HTMLElement>('.translate-provider');
  if (badge) {
    const icon = provider ? providerIcons[provider] : undefined;
    badge.title = icon?.label ?? '';
    badge.setAttribute('aria-label', icon?.label ?? '');
    badge.style.display = icon ? 'flex' : 'none';
    badge.style.color = icon?.color ?? '';
    if (badge.dataset.provider !== (provider ?? '')) {
      const attrs = { width: 18, height: 18, 'aria-hidden': true, focusable: 'false', style: 'display: block' };
      render(provider === 'ai' ? h(Sparkles, attrs)
        : provider ? h('svg', { ...attrs, viewBox: '0 0 24 24', fill: 'currentColor' },
          [h('path', { d: providerIcons[provider].path })]) : null, badge);
      badge.dataset.provider = provider ?? '';
    }
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
  window.clearTimeout(tooltip._leaveTimer);
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
    activeAutoTranslate = policy.autoTranslate;
    resetTwitterTranslations();
    if (activeAutoTranslate) ttTwitterTranslate(generation);
  };
  stopTranslateObserver = observeXDom(document.body, () => {
    if (generation !== twitterGeneration) return;
    if (JSON.stringify(currentAccount()) !== identity) { void ttTwitterInit(window.location.href); return; }
    if (activeAutoTranslate) ttTwitterTranslate(generation);
  });
  await refresh();
  if (generation === twitterGeneration) runtimeTimer = window.setInterval(() => { void refresh(); }, 15_000);
}

function resetTwitterTranslations(): void {
  translator?.stop(); translator = undefined;
  if (translateTooltip) hideTranslateTooltip(translateTooltip);
}

function ttTwitterTranslate(generation: number): void {
  if (generation !== twitterGeneration || !activeAutoTranslate) return;
  if (!translator) {
    const tooltip = createTranslateTooltip();
    translator = createXTranslator({
      document, targetLanguage: config.value.basic.targetLang,
      translate: text => translateContentResult(config.value.basic.translateProvider, text, false),
      show: (text, x, y, provider) => showTranslateTooltip(tooltip, text, x, y, provider),
      hide: () => {
        window.clearTimeout(tooltip._leaveTimer);
        tooltip._leaveTimer = window.setTimeout(() => hideTranslateTooltip(tooltip), 150);
      },
      onError: error => log_error('Translate tweet failed', error),
    });
  }
  translator.scan();
}
