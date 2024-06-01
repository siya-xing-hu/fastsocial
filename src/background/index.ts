import logger from "../common/logging";
import {
  AIGenarateData,
  ConfigUpdateMessage,
  Message,
  MessageResponse,
  MessageTypeEnum,
} from "../common/runtime-message";
import openConfig, { initOpenAI } from "../config/openai-config";
import { retry } from "../utils/common";
import { translate } from "../utils/translate";
import { execGptPrompt } from "./ai-generate";
import { addTabListener } from "./listener";

export function init() {
  const now = new Date();
  logger.log("### init ###", now.toISOString());

  chrome.runtime.onMessage.addListener(
    (
      message: Message,
      sender,
      sendResponse: (response?: MessageResponse) => void,
    ) => {
      console.log("message", message, sender);

      switch (message.type) {
        case MessageTypeEnum.TRANSLATE:
          const text = message.data.content;
          retry(
            async () => {
              return Promise.resolve(await translate(text, "auto"));
            },
            1,
            5,
          ).then((resp) => {
            sendResponse({ is_ok: true, data: resp });
          }).catch((error) => {
            sendResponse({ is_ok: false, error: error.toString() });
          });
          break;
        case MessageTypeEnum.CONFIG_UPDATE:
          const sendMessage: ConfigUpdateMessage = {
            type: MessageTypeEnum.CONFIG_UPDATE,
          };
          initOpenAI().then(() => {
            chrome.tabs.query({ url: "*://*.twitter.com/*" }, (tabs) => {
              tabs.forEach((tab) => {
                if (typeof tab.id === "number") { // 确保 tab.id 是一个数字
                  chrome.tabs.sendMessage(tab.id, sendMessage);
                }
              });
            });
            chrome.tabs.query({ url: "*://*.x.com/*" }, (tabs) => {
              tabs.forEach((tab) => {
                if (typeof tab.id === "number") { // 确保 tab.id 是一个数字
                  chrome.tabs.sendMessage(tab.id, sendMessage);
                }
              });
            });
          });
          break;
        case MessageTypeEnum.AI_GENARATE:
          const data: AIGenarateData = message.data;
          retry(
            async () => {
              return Promise.resolve(
                await execGptPrompt(data.operation, data.content),
              );
            },
            1,
            5,
          ).then((resp) => {
            sendResponse({ is_ok: true, data: resp });
          }).catch((error) => {
            sendResponse({ is_ok: false, error: error.toString() });
          });
          break;
      }
      return true;
    },
  );

  // Do load the appState and other things
  onLoad().catch(logger.error);
}

async function onLoad() {
  await initOpenAI();

  // 添加标签页监听器
  await addTabListener();
}
