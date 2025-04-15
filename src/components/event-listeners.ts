/**
 * @fileoverview 处理鼠标和键盘监听事件的模块
 */

import { log, log_error } from "../common/logging";
import { execNotionTranslate, execTranslate } from "./translate";

// 鼠标位置
let mousePosition = { x: 0, y: 0 };

// 翻译状态
let isTranslating = false;

/**
 * 初始化所有事件监听器
 */
export function initEventListeners() {
  // 监听鼠标移动事件
  document.addEventListener("mousemove", handleMouseMove);
  
  // 监听键盘事件
  document.addEventListener("keydown", handleKeyDown);
  
  log("事件监听器初始化完成");
}

/**
 * 处理鼠标移动事件
 */
function handleMouseMove(event: MouseEvent) {
  mousePosition = { x: event.clientX, y: event.clientY };
}

/**
 * 处理键盘按下事件
 * 使用单一事件处理所有键盘操作，简化逻辑
 */
async function handleKeyDown(event: KeyboardEvent) {
  // 检查是否满足快捷键条件
  // 只有当按下的是Shift或Control键，且没有其他修饰键被按下时，才触发翻译
  const isShiftOnly = event.key === "Shift" && !event.ctrlKey && !event.altKey && !event.metaKey;
  
  if (isShiftOnly) {
    // 防止事件冒泡和默认行为
    event.preventDefault();
    event.stopPropagation();
    
    // 执行翻译
    await executeTranslation();
  }
}

/**
 * 执行翻译操作
 */
async function executeTranslation() {
  if (isTranslating || !mousePosition.x || !mousePosition.y) {
    return;
  }
  
  try {
    isTranslating = true;

    log("开始翻译", mousePosition);
    
    if (window.location.hostname.includes("notion.site")) {
      await execNotionTranslate(mousePosition.x, mousePosition.y);
    } else {
      await execTranslate(mousePosition.x, mousePosition.y);
    }
  } catch (error) {
    log_error("翻译过程中出错:", error);
  } finally {
    isTranslating = false;
  }
}
