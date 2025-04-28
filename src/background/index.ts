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
import { execGptPrompt, execGptPromptStream } from "../utils/ai";
import { randomString, retry } from "../utils/kit";
import { translate } from "../utils/translate";
import { addTabListener } from "./listener";

// 跟踪已就绪的标签页
export const readyTabs = new Set<number>();

// 存储活跃的流式请求
const activeStreamRequests = new Map<string, { tabId: number, content: string }>();

export function init() {
  const now = new Date();
  log("### init ###", now.toISOString());

  // 监听标签页关闭事件
  chrome.tabs.onRemoved.addListener((tabId) => {
    readyTabs.delete(tabId);
    
    // 清理关闭标签页的所有流式请求
    for (const [requestId, request] of activeStreamRequests.entries()) {
      if (request.tabId === tabId) {
        activeStreamRequests.delete(requestId);
      }
    }
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
          sendResponse({ is_ok: true });
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
          return true; // 表示将异步响应
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
            sendResponse({ is_ok: true });
          }).catch(error => {
            sendResponse({ is_ok: false, error: error.toString() });
          });
          return true; // 表示将异步响应
        case RuntimeMessageTypeEnum.AI_GENARATE:
          const data: AIGenarateData = message.data;

          // 判断是否使用流式输出
          if (data.stream) {
            // 使用流式输出
            const requestId = randomString(10);
            let fullContent = "";
            
            // 获取发送者标签页
            const tabId = sender.tab?.id;
            if (!tabId) {
              sendResponse({ is_ok: false, error: "无法获取发送方标签页ID" });
              return false; // 立即响应
            }
            
            // 存储请求信息
            activeStreamRequests.set(requestId, { tabId, content: fullContent });
            
            // 尽快发送开始响应，避免通道关闭
            sendResponse({ is_ok: true, data: { requestId } });
            
            // 发送流式开始消息到对应的标签页
            try {
              chrome.tabs.sendMessage(tabId, {
                type: RuntimeMessageTypeEnum.AI_STREAM_START,
                data: { requestId }
              }).catch(error => {
                log_error("发送流开始消息失败", error);
              });
              
              execGptPromptStream(
                data.aiProvider,
                data.messages,
                // 每次收到数据块时回调
                (chunk) => {
                  fullContent += chunk;
                  // 更新存储的内容
                  const requestInfo = activeStreamRequests.get(requestId);
                  if (requestInfo) {
                    requestInfo.content = fullContent;
                    activeStreamRequests.set(requestId, requestInfo);
                  }
                  
                  // 发送数据块消息到对应的标签页
                  chrome.tabs.sendMessage(tabId, {
                    type: RuntimeMessageTypeEnum.AI_STREAM_CHUNK,
                    data: { requestId, chunk }
                  }).catch(error => {
                    log_error("发送流块消息失败", error);
                  });
                },
                // 出错时回调
                (error) => {
                  log_error("流处理错误", error);
                  // 发送流式结束消息带错误信息到对应的标签页
                  chrome.tabs.sendMessage(tabId, {
                    type: RuntimeMessageTypeEnum.AI_STREAM_END,
                    data: { 
                      requestId,
                      error: error.message
                    }
                  }).catch(e => {
                    log_error("发送流结束(错误)消息失败", e);
                  });
                  
                  // 清理请求
                  activeStreamRequests.delete(requestId);
                },
                // 完成时回调
                () => {
                  // 发送流式结束消息到对应的标签页
                  chrome.tabs.sendMessage(tabId, {
                    type: RuntimeMessageTypeEnum.AI_STREAM_END,
                    data: { requestId }
                  }).catch(error => {
                    log_error("发送流结束消息失败", error);
                  });
                  
                  // 清理请求
                  activeStreamRequests.delete(requestId);
                }
              );
            } catch (error) {
              log_error("流式处理失败", error);
              // 清理请求
              activeStreamRequests.delete(requestId);
            }
            
            return false; // 已经响应，不需要异步
          } else {
            // 传统方式
            retry(
              async () => {
                return Promise.resolve(
                  await execGptPrompt(data.aiProvider, data.messages),
                );
              },
              1,
              3,
            ).then((resp) => {
              sendResponse({ is_ok: true, data: resp });
            }).catch((error) => {
              sendResponse({ is_ok: false, error: error.toString() });
            });
            return true; // 表示将异步响应
          }
        default:
          sendResponse({ is_ok: false, error: "未知消息类型" });
          break;
      }
      return false; // 默认不异步响应
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
