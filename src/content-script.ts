/**
 * @fileoverview The **main** content script.
 */

import logger from "./common/logging";
import "./popup.css";
import { execNotionTranslate, execTranslate } from "./components/translate";
import { translateConfig, ttTwitterInit } from "./components/_twitter";
import { Message, MessageTypeEnum } from "./common/runtime-message";

async function init() {
  const now = new Date();
  logger.log("### init ###", now.toISOString());

  chrome.runtime.onMessage.addListener(function (
    message: Message,
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
      case MessageTypeEnum.CONFIG_UPDATE:
        chrome.storage.local.get().then(({ xTranslate }) => {
          translateConfig.xTranslate = xTranslate == "TRUE";
        });
        break;
      case MessageTypeEnum.X_URl:
        ttTwitterInit(message.data.url);
        break;
    }
  });

  chrome.storage.local.get().then(({ xTranslate }) => {
    translateConfig.xTranslate = xTranslate == "TRUE";
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

init().catch(logger.error);
