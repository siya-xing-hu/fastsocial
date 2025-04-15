/**
 * @fileoverview The **main** content script.
 */

import { log } from "./common/logging";
import { initConfig } from "./common/storage-config";
import { TabMessage, TabMessageTypeEnum } from "./common/tabs-message";
import { ttProductHuntInit } from "./components/_producthunt";
import { ttTwitterInit } from "./components/_twitter";
import { initEventListeners } from "./components/event-listeners";
import "./tailwind.css";

async function init() {
  const now = new Date();
  log("### init ###", now.toISOString());

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
        });
        break;
      case TabMessageTypeEnum.X_URl:
        ttTwitterInit(message.data.url);
        break;
      case TabMessageTypeEnum.PH_URl:
        ttProductHuntInit(message.data.url);
        break;
    }
  });

  await initConfig();

  // 初始化事件监听器
  initEventListeners();
}

init().then(() => {
  log("init success");
});