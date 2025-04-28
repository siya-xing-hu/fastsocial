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

  // 如果是 Twitter 页面，立即初始化
  if (
    window.location.href.includes("x.com")
  ) {
    ttTwitterInit(window.location.href);
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
          if (message.data.url) {
            ttTwitterInit(message.data.url);
          }
        });
        break;
      case TabMessageTypeEnum.X_URl:
        ttTwitterInit(message.data.url);
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
