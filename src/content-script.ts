/**
 * @fileoverview The **main** content script.
 */

import logger from "./common/logging";
import "./tailwind.css";
import { execNotionTranslate, execTranslate } from "./components/translate";
import { translateConfig, ttTwitterInit } from "./components/_twitter";
import { TabMessage, TabMessageTypeEnum } from "./common/tabs-message";
import { ttProductHuntInit } from "./components/_producthunt";

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
        chrome.storage.local.get().then(({ alwaysTranslate }) => {
          if (alwaysTranslate !== undefined) {
            translateConfig.xTranslate = alwaysTranslate;
          }
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

  chrome.storage.local.get().then(({ alwaysTranslate }) => {
    if (alwaysTranslate !== undefined) {
      translateConfig.xTranslate = alwaysTranslate;
    }
  });

  let currentClientX = 0;
  let currentClientY = 0;
  let isTranslating = false;
  let ctrlKey = false;
  let eventKey = "";

  // 监听鼠标悬停事件
  document.addEventListener("mouseover", (event) => {
    currentClientX = event.clientX;
    currentClientY = event.clientY;
  });

  // 监听抬起事件
  document.addEventListener("keyup", async () => {
    if (
      ctrlKey && eventKey === "Control" && currentClientX && currentClientY
    ) {
      if (isTranslating) {
        return;
      }
      try {
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
    ctrlKey = false;
    eventKey = "";
  });

  // 监听按下事件
  document.addEventListener("keydown", async (event) => {
    ctrlKey = event.ctrlKey;
    eventKey = event.key;
  });
}

console.log("11111")
init().then(() => {
  console.log("22222")
})