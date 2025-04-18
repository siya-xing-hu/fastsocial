/**
 * @fileoverview 处理鼠标和键盘监听事件的模块
 */

import { log, log_error } from "../../common/logging";
import { execNotionTranslate, execTranslate } from "../translate/text-translator";

// 鼠标位置
let mousePosition = { x: 0, y: 0 };

// 翻译状态
let isTranslating = false;

// Shift键状态
let shiftKeyTimer: ReturnType<typeof setTimeout> | null = null;
let isShiftKeyDown = false;

/**
 * 初始化所有事件监听器
 */
export function initEventListeners() {
  // 监听鼠标移动事件
  document.addEventListener("mousemove", handleMouseMove);
  
  // 监听键盘按下和释放事件
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
  
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
 */
function handleKeyDown(event: KeyboardEvent) {
  // 检查是否满足高级翻译快捷键条件 (Shift + Ctrl)
  const isShiftCtrl = event.shiftKey && event.ctrlKey && !event.altKey && !event.metaKey;
  
  if (isShiftCtrl) {
    // 防止事件冒泡和默认行为
    event.preventDefault();
    event.stopPropagation();
    
    // 执行高级翻译
    executeTranslation(true);
    return;
  }

  // 只处理单独的Shift键
  if (event.key === "Shift" && !event.ctrlKey && !event.altKey && !event.metaKey) {
    isShiftKeyDown = true;
    
    // 清除之前的定时器
    if (shiftKeyTimer) {
      clearTimeout(shiftKeyTimer);
      shiftKeyTimer = null;
    }
  } else {
    // 如果按下了其他键，取消Shift的状态
    isShiftKeyDown = false;
    if (shiftKeyTimer) {
      clearTimeout(shiftKeyTimer);
      shiftKeyTimer = null;
    }
  }
}

/**
 * 处理键盘释放事件
 */
function handleKeyUp(event: KeyboardEvent) {
  // 只处理Shift键的释放
  if (event.key === "Shift" && isShiftKeyDown) {
    // 设置一个短暂的延迟，确保不是组合键操作
    shiftKeyTimer = setTimeout(async () => {
      // 执行普通翻译
      await executeTranslation(false);
      isShiftKeyDown = false;
    }, 200); // 200毫秒的延迟，足够区分单独按Shift和Shift+其他键
  }
}

/**
 * 执行翻译操作
 */
async function executeTranslation(isShiftCtrl: boolean) {
  if (isTranslating || !mousePosition.x || !mousePosition.y) {
    return;
  }
  
  try {
    isTranslating = true;

    log("开始翻译", mousePosition);
    
    if (window.location.hostname.includes("notion.site")) {
      await execNotionTranslate(mousePosition.x, mousePosition.y, isShiftCtrl);
    } else {
      await execTranslate(mousePosition.x, mousePosition.y, isShiftCtrl);
    }
  } catch (error) {
    log_error("翻译过程中出错:", error);
  } finally {
    isTranslating = false;
  }
}
