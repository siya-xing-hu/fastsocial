/**
 * @fileoverview The **main** content script.
 */

import { log } from "./common/logging";
import { initConfig } from "./common/storage-config";
import { TabMessage, TabMessageTypeEnum } from "./common/tabs-message";
import { RuntimeMessageTypeEnum } from "./common/runtime-message";
import { ttTwitterInit } from "./components/social/_twitter";
import { initEventListeners } from "./components/events/event-listeners";
import "./tailwind.css";
import "./assets/chat.css";
import { handlerCommonUrl } from "./components/translate";

const X_INIT_DEBOUNCE_MS = 150;

let xInitTimeoutId: number | undefined;
let pendingXUrl = "";
let pendingXInitIsForced = false;
let lastInitializedXUrl = "";
let isXNavigationListenerInstalled = false;
let observedLocationUrl = window.location.href;

function isXUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "x.com" || hostname.endsWith(".x.com");
  } catch {
    return false;
  }
}

function scheduleXInit(url = window.location.href, force = false): void {
  if (!isXUrl(url)) return;

  pendingXUrl = url;
  pendingXInitIsForced ||= force;

  if (xInitTimeoutId !== undefined) {
    window.clearTimeout(xInitTimeoutId);
  }

  xInitTimeoutId = window.setTimeout(() => {
    xInitTimeoutId = undefined;
    const nextUrl = pendingXUrl;
    const shouldForce = pendingXInitIsForced;
    pendingXInitIsForced = false;

    if (!shouldForce && nextUrl === lastInitializedXUrl) return;
    lastInitializedXUrl = nextUrl;
    void ttTwitterInit(nextUrl);
  }, X_INIT_DEBOUNCE_MS);
}

function installXNavigationListener(): void {
  if (isXNavigationListenerInstalled) return;
  isXNavigationListenerInstalled = true;

  const scheduleCurrentUrl = () => scheduleXInit(window.location.href);
  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = (...args: Parameters<History["pushState"]>) => {
    const previousUrl = window.location.href;
    originalPushState(...args);
    if (window.location.href !== previousUrl) scheduleCurrentUrl();
  };

  window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    const previousUrl = window.location.href;
    originalReplaceState(...args);
    if (window.location.href !== previousUrl) scheduleCurrentUrl();
  };

  window.addEventListener("popstate", scheduleCurrentUrl);

  // Content scripts run in an isolated world, so page-owned History methods can
  // bypass the wrappers above. X always mutates its DOM during SPA navigation;
  // comparing the URL here provides a reliable, low-cost fallback.
  const locationObserver = new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl === observedLocationUrl) return;
    observedLocationUrl = currentUrl;
    scheduleCurrentUrl();
  });
  locationObserver.observe(document.documentElement, { childList: true, subtree: true });
}

async function init() {
  const now = new Date();
  log("### init ###", now.toISOString());

  // 初始化配置
  await initConfig();

  // 初始化事件监听器
  initEventListeners();

  // 发送就绪信号
  chrome.runtime.sendMessage({
    type: RuntimeMessageTypeEnum.CONTENT_SCRIPT_READY,
  });

  if (isXUrl(window.location.href)) {
    installXNavigationListener();
    scheduleXInit(window.location.href);
  }

  chrome.runtime.onMessage.addListener(function (
    message: TabMessage,
    sender,
    sendResponse,
  ) {
    log(
      sender.tab
        ? "from a content script: " + sender.tab.url
        : "from the extension: ",
      message.type,
    );

    switch (message.type) {
      case TabMessageTypeEnum.CONFIG_UPDATE:
        initConfig().then(() => {
          log("CONFIG_UPDATE DONE");
          scheduleXInit(message.data.url ?? window.location.href, true);
        });
        break;
      case TabMessageTypeEnum.X_URl:
        scheduleXInit(message.data.url);
        break;
      case TabMessageTypeEnum.COMMON_URL:
        log("COMMON_URL", message.data.url);
        handlerCommonUrl();
        break;
      default:
        break;
    }
  });
}

// 确保在 DOM 加载完成后初始化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
