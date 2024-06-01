import logger, { log } from "../common/logging";
import { MessageTypeEnum, XUrlMessage } from "../common/runtime-message";

export async function addTabListener() {
  // 监听标签页更新事件
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    logger.log("tabs.onUpdated", tabId, changeInfo, tab);

    if (changeInfo.status === "complete") {
      sendMessageToContentScript(tabId, tab.url);
    }
  });

  // 监听标签页激活事件
  chrome.tabs.onActivated.addListener((activeInfo) => {
    logger.log("tabs.onActivated", activeInfo);

    const tabId = activeInfo.tabId;
    chrome.tabs.get(tabId, (tab) => {
      logger.log("tabs.get", tab);
      // 检测标签页加载完毕
      if (tab && tab.status === "complete") {
        sendMessageToContentScript(tabId, tab.url);
      }
    });
  });
}

// 发送消息给内容脚本
function sendMessageToContentScript(tabId: number, url: string | undefined) {
  if (!url) {
    return;
  }
  if (isTwitterUrl(url)) {
    const message: XUrlMessage = {
      type: MessageTypeEnum.X_URl,
      data: {
        url: url,
      },
    };
    chrome.tabs.sendMessage(tabId, message);
  }
}

// 判断是否是 Twitter URL
function isTwitterUrl(url: string) {
  return url.startsWith("https://twitter.com/") ||
    url.startsWith("https://x.com/");
}
