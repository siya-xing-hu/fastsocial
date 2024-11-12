/**
 * @fileoverview The **main** content script.
 */

import logger, { log } from "./common/logging";
import "./tailwind.css";
import { execNotionTranslate, execTranslate } from "./components/translate";
import { ttTwitterInit } from "./components/_twitter";
import { TabMessage, TabMessageTypeEnum } from "./common/tabs-message";
import { ttProductHuntInit } from "./components/_producthunt";
import { config, initConfig } from "./config/storage-config";

async function init() {
  const now = new Date();
  logger.log("### init ###", now.toISOString());

  chrome.runtime.onMessage.addListener(function (
    message: TabMessage,
    sender,
    sendResponse,
  ) {
    logger.log(
      sender.tab
        ? "from a content script: " + sender.tab.url
        : "from the extension: ",
      message.type,
    );

    switch (message.type) {
      case TabMessageTypeEnum.CONFIG_UPDATE:
        initConfig().then(() => {
          log("CONFIG_UPDATE DONE")
        })
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

  let currentClientX = 0;
  let currentClientY = 0;
  let isTranslating = false;
  let shiftKey = false;
  let ctrlKey = false;
  let eventKey = "";

  // 监听鼠标悬停事件
  document.addEventListener("mouseover", (event) => {
    currentClientX = event.clientX;
    currentClientY = event.clientY;
  });

  // 监听抬起事件
  document.addEventListener("keyup", async () => {
    const shift = config.value.basic.shortcut.shift;
    const ctrl = config.value.basic.shortcut.ctrl;
    if ((shift && shiftKey && eventKey === "") || (ctrl && ctrlKey && eventKey === "Control")) {
      if (currentClientX && currentClientY) {
        try {
          if (isTranslating) {
            return;
          }
          isTranslating = true;
          if (window.location.hostname.includes("notion.site")) {
            await execNotionTranslate(currentClientX, currentClientY);
          } else {
            await execTranslate(currentClientX, currentClientY);
          }
        } catch (error) {
          console.error(error);
        } finally {
          isTranslating = false;
        }
      }
    }
  });

  // 监听按下事件
  document.addEventListener("keydown", async (event) => {
    shiftKey = event.shiftKey;
    ctrlKey = event.ctrlKey;
    eventKey = event.key;
  });
}

init().then(() => {
  console.log("init success")
})