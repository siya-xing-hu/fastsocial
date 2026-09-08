import { log } from "../../common/logging";
import { config } from "../../common/storage-config";
import { execObserver } from "../../utils/mutationObserver";
import { translateTelegramMethod } from "./telegram/methods";

export async function handlerCommonUrl(): Promise<void> {
  log("handlerCommonUrl", config.value.basic.autoTranslate);
  if (config.value.basic.autoTranslate) {
    // 立即执行一次翻译检查，确保页面加载完成后能立即翻译
    await execAutoTranslate();
    
    // 然后设置 MutationObserver 监听后续的 DOM 变化
    execObserver(document.body, async () => {
      log("execObserver", config.value.basic.autoTranslate);
      if (config.value.basic.autoTranslate) {
        log("execAutoTranslate", config.value.basic.autoTranslate);
        await execAutoTranslate();
        return false;
      }
      return false;
    });
  }
}

async function execAutoTranslate(): Promise<void> {
  try {
    // 获取当前浏览器地址
    const url = window.location.href;
    log("execAutoTranslate 开始执行", url);
    
    if (url.startsWith("https://core.telegram.org/methods")) {
      log("检测到 Telegram Methods 页面，开始翻译");
      await translateTelegramMethod();
      log("Telegram Methods 翻译完成");
    } else {
      log("当前页面不是 Telegram Methods 页面，跳过翻译");
    }
  } catch (error) {
    log("execAutoTranslate 执行失败", error);
  }
}
