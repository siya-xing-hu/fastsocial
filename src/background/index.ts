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
import { execGptPrompt } from "../utils/ai";
import { retry } from "../utils/kit";
import { translate } from "../utils/translate";
import { addTabListener } from "./listener";

// 跟踪已就绪的标签页
export const readyTabs = new Set<number>();

export function init() {
  const now = new Date();
  log("### init ###", now.toISOString());

  // 监听标签页关闭事件
  chrome.tabs.onRemoved.addListener((tabId) => {
    readyTabs.delete(tabId);
  });

  chrome.runtime.onMessage.addListener(
    (
      message: RuntimeMessage,
      sender,
      sendResponse: (response?: RuntimeMessageResponse) => void,
    ) => {
      log("message", message.type);

      switch (message.type) {
        case RuntimeMessageTypeEnum.CONTENT_SCRIPT_READY:
          if (sender.tab?.id) {
            readyTabs.add(sender.tab.id);
          }
          break;
        case RuntimeMessageTypeEnum.TRANSLATE:
          retry(
            async () => {
              return Promise.resolve(
                await translate(
                  message.data.channel,
                  message.data.content,
                  message.data.is_advanced,
                  "auto",
                ),
              );
            },
            1,
            3,
          ).then((resp) => {
            sendResponse({ is_ok: true, data: resp });
          }).catch((error) => {
            sendResponse({ is_ok: false, error: error.toString() });
          });
          break;
        case RuntimeMessageTypeEnum.CONFIG_UPDATE:
          initConfig().then(() => {
            chrome.tabs.query({ url: "*://*.x.com/*" }, (tabs) => {
              tabs.forEach((tab) => {
                if (typeof tab.id === "number") {
                  const sendMessage: ConfigUpdateTabMessage = {
                    type: TabMessageTypeEnum.CONFIG_UPDATE,
                    data: {
                      url: tab.url,
                    },
                  };
                  sendTabMessage(tab.id, sendMessage);
                }
              });
            });
          });
          break;
        case RuntimeMessageTypeEnum.AI_GENARATE:
          const data: AIGenarateData = message.data;

          const prompt = config.value.prompts[data.scene].find(
            (prompt) => prompt.id === data.id,
          );

          if (!prompt) {
            sendResponse({ is_ok: false, error: "未找到指定的按钮配置" });
            break;
          }

          retry(
            async () => {
              return Promise.resolve(
                await execGptPrompt(prompt.prompt.replace("${replyContent}", data.content).replace("${userContent}", data.keywords || "")),
              );
            },
            1,
            3,
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
