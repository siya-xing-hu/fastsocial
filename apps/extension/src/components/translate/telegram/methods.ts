import { translateContent } from "../text-translator";
import { config, TranslateChannelEnum } from "../../../common/storage-config";
import { log } from "../../../common/logging";

export async function translateTelegramMethod(): Promise<void> {
  log("开始执行 translateTelegramMethod");
  const mainWrapper = document.querySelector(
    "div[id=dev_page_content_wrap] div[id=dev_page_content]",
  );
  if (!mainWrapper) {
    log("未找到 mainWrapper 元素，可能页面结构已变化");
    return;
  }

  // mainWrapper 下的结构
  // <h3></h3><table class="table"><thead></thead><tbody></tbody></table>
  // <h3></h3><table class="table"><thead></thead><tbody></tbody></table>
  // ...
  // 我想要获取所有的 <h3></h3> 和 <table class="table"><thead></thead><tbody></tbody></table>
  // 然后翻译 <tbody></tbody> 中的所有非 a 标签的文本
  const tableList = mainWrapper.querySelectorAll("table.table");
  for (const table of tableList) {
    const tbody = table.querySelector("tbody");
    if (tbody) {
      const textNodes = tbody.querySelectorAll("td");
      for (const td of textNodes) {
        if (td.textContent && !isLinkElement(td)) {
          td.textContent = await translateContent(
            TranslateChannelEnum.GOOGLE,
            td.textContent,
            true,
          );
        }
      }
    }
  }
}

/**
 * 检查元素是否是链接
 * @param element 要检查的元素
 * @returns 是否是链接元素
 */
function isLinkElement(element: HTMLElement): boolean {
  log("isLinkElement", element);
  log("isLinkElement", element.tagName);
  log("isLinkElement", element.nextElementSibling?.tagName);
  log("isLinkElement", element.textContent);

  // 检查是否是链接标签或者包含链接标签
  if (element.tagName === "A" || element.querySelector("a")) {
    return true;
  }
  return false;
}
