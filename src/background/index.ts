import { log, log_error } from "../common/logging";
import {
  AIGenarateData,
  RuntimeMessage,
  RuntimeMessageResponse,
  RuntimeMessageTypeEnum,
} from "../common/runtime-message";
import { config, initConfig } from "../common/storage-config";
import {
  ConfigUpdateTabMessage,
  sendTabMessage,
  TabMessageTypeEnum,
} from "../common/tabs-message";
import { retry } from "../utils/kit";
import { execGptPrompt } from "../utils/ai";
import { translate } from "../utils/translate";
import { addTabListener } from "./listener";

export function init() {
  const now = new Date();
  log("### init ###", now.toISOString());

  chrome.runtime.onMessage.addListener(
    (
      message: RuntimeMessage,
      sender,
      sendResponse: (response?: RuntimeMessageResponse) => void,
    ) => {
      log("message", message.type);

      switch (message.type) {
        case RuntimeMessageTypeEnum.TRANSLATE:
          retry(
            async () => {
              return Promise.resolve(
                await translate(
                  message.data.channel,
                  message.data.content,
                  "auto",
                ),
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
                await execGptPrompt(config.value.basic.aiProvider, data.button.prompt, data.content),
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
  onLoad().catch(log_error);
}

async function onLoad() {
  await initConfig();

  // 添加标签页监听器
  await addTabListener();
}
