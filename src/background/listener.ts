import { log } from "../common/logging";
import { sendTabMessage, TabMessageTypeEnum, XUrlTabMessage } from "../common/tabs-message";

export async function addTabListener() {
  // 监听标签页更新事件
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    log("tabs.onUpdated", tabId, changeInfo, tab);

    if (changeInfo.status === "complete") {
      sendMessageToContentScript(tabId, tab.url);
    }
  });

  // 监听标签页激活事件
  chrome.tabs.onActivated.addListener((activeInfo) => {
    log("tabs.onActivated", activeInfo);

    const tabId = activeInfo.tabId;
    chrome.tabs.get(tabId, (tab) => {
      log("tabs.get", tab);
      // 检测标签页加载完毕
      if (tab && tab.status === "complete") {
        sendMessageToContentScript(tabId, tab.url);
      }
    });
  });
}

// 发送消息给内容脚本
function sendMessageToContentScript(tabId: number, url: string | undefined) {
  if (!url || typeof tabId != "number") {
    return;
  }
  if (isTwitterUrl(url)) {
    const message: XUrlTabMessage = {
      type: TabMessageTypeEnum.X_URl,
      data: {
        url: url,
      },
    };
    sendTabMessage(tabId, message).then(() => {
      log("ok")
    })
  }
}

// 判断是否是 Twitter URL
function isTwitterUrl(url: string) {
  return url.startsWith("https://twitter.com/") ||
    url.startsWith("https://x.com/");
}
