import logger, { log } from "../common/logging";
import {
  AIGenarateData,
  RuntimeMessage,
  RuntimeMessageResponse,
  RuntimeMessageTypeEnum,
} from "../common/runtime-message";
import { ConfigUpdateTabMessage, sendTabMessage, TabMessageTypeEnum } from "../common/tabs-message";
import { initConfig } from "../config/storage-config";
import { retry } from "../utils/common";
import { execGptPrompt } from "../utils/openai";
import { translate } from "../utils/translate";
import { addTabListener } from "./listener";

export function init() {
  const now = new Date();
  logger.log("### init ###", now.toISOString());

  chrome.runtime.onMessage.addListener(
    (
      message: RuntimeMessage,
      sender,
      sendResponse: (response?: RuntimeMessageResponse) => void,
    ) => {
      log("message", message.type);

      switch (message.type) {
        case RuntimeMessageTypeEnum.TRANSLATE:
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
        case RuntimeMessageTypeEnum.CONFIG_UPDATE:
          const sendMessage: ConfigUpdateTabMessage = {
            type: TabMessageTypeEnum.CONFIG_UPDATE,
          };
          initConfig().then(() => {
            chrome.tabs.query({ url: "*://*.twitter.com/*" }, (tabs) => {
              tabs.forEach((tab) => {
                if (typeof tab.id === "number") { // 确保 tab.id 是一个数字
                  sendTabMessage(tab.id, sendMessage);
                }
              });
            });
            chrome.tabs.query({ url: "*://*.x.com/*" }, (tabs) => {
              tabs.forEach((tab) => {
                if (typeof tab.id === "number") { // 确保 tab.id 是一个数字
                  sendTabMessage(tab.id, sendMessage);
                }
              });
            });
          });
          break;
        case RuntimeMessageTypeEnum.AI_GENARATE:
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
  await initConfig();

  // 添加标签页监听器
  await addTabListener();
}
