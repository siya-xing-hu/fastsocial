/**
 * @fileoverview 处理鼠标和键盘监听事件的模块
 */

import { log, log_error } from "../../common/logging";
import { execNotionTranslate, execTranslate } from "../translate/text-translator";
import { createApp } from "vue";
import CommonDialog from "../ui/CommonDialog.vue";

// 鼠标位置
let mousePosition = { x: 0, y: 0 };

// 翻译状态
let isTranslating = false;

// 键盘状态
let keyTimer: ReturnType<typeof setTimeout> | null = null;
let isShiftKeyDown = false;
let isCtrlKeyDown = false;
let isMetaKeyDown = false;
let isPKeyDown = false;

// 添加鼠标按键状态跟踪
let isMouseButtonDown = false;

// 通用对话框实例
let commonDialogInstance: HTMLDivElement | null = null;

/**
 * 初始化所有事件监听器
 */
export function initEventListeners() {
  // 监听鼠标移动事件
  document.addEventListener("mousemove", handleMouseMove);
  
  // 监听键盘按下和释放事件
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
  
  // 添加鼠标按键监听
  document.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mouseup", handleMouseUp);
  
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
  // 记录各个按键的状态
  if (event.key === "Shift") {
    isShiftKeyDown = true;
  } else if (event.key === "Control") {
    isCtrlKeyDown = true;
  } else if (event.metaKey) {
    isMetaKeyDown = true;
  } else if (event.key === "p" || event.key === "P") {
    isPKeyDown = true;
  }

  // 检查组合键
  if (event.metaKey && event.shiftKey && (event.key === "p" || event.key === "P")) {
    isPKeyDown = true;
    isShiftKeyDown = true;
    isMetaKeyDown = true;
  }

  // 清除之前的定时器
  if (keyTimer) {
    clearTimeout(keyTimer);
    keyTimer = null;
  }
}

/**
 * 打开通用对话框
 */
function openCommonDialog() {
  // 如果已经有实例存在，先移除
  if (commonDialogInstance) {
    document.body.removeChild(commonDialogInstance);
    commonDialogInstance = null;
  }
  
  // 创建一个新的对话框容器
  commonDialogInstance = document.createElement('div');
  document.body.appendChild(commonDialogInstance);
  
  // 使用Vue创建组件
  const app = createApp(CommonDialog, {
    title: "通用生成工具",
    onClose: () => {
      app.unmount();
      if (commonDialogInstance) {
        document.body.removeChild(commonDialogInstance);
        commonDialogInstance = null;
      }
    }
  });
  
  // 挂载组件
  app.mount(commonDialogInstance);
  
  log("通用对话框已打开");
}

/**
 * 处理鼠标按下事件
 */
function handleMouseDown() {
  isMouseButtonDown = true;
}

/**
 * 处理鼠标释放事件
 */
function handleMouseUp() {
  isMouseButtonDown = false;
}

/**
 * 处理键盘释放事件
 */
function handleKeyUp(event: KeyboardEvent) {
  // 添加调试日志
  log("键盘释放:", { 
    key: event.key, 
    meta: isMetaKeyDown, 
    shift: isShiftKeyDown, 
    p: isPKeyDown,
    eventMeta: event.metaKey,
    eventShift: event.shiftKey
  });

  // 检查是否满足通用对话框快捷键条件 (Command + Shift + P)
  if ((isMetaKeyDown || event.metaKey) && (isShiftKeyDown || event.shiftKey) && 
      (isPKeyDown || (event.key === "p" || event.key === "P"))) {
    // 防止事件冒泡和默认行为
    event.preventDefault();
    event.stopPropagation();
    
    // 在按键释放时打开通用对话框
    openCommonDialog();
    
    // 重置按键状态
    isPKeyDown = false;
    return;
  }
  
  // 检查是否满足高级翻译快捷键条件 (Shift + Ctrl)
  if (isShiftKeyDown && isCtrlKeyDown && (event.key === "Shift" || event.key === "Control")) {
    // 防止事件冒泡和默认行为
    event.preventDefault();
    event.stopPropagation();
    
    // 在按键释放时执行高级翻译
    executeTranslation(true);
    
    // 如果释放的是Ctrl键，重置Ctrl状态
    if (event.key === "Control") {
      isCtrlKeyDown = false;
    }
    return;
  }

  // 处理单独Shift键的释放，并且确保鼠标按键没有被按下
  if (event.key === "Shift" && isShiftKeyDown && !isCtrlKeyDown && !isMetaKeyDown && !isMouseButtonDown) {
    // 设置一个短暂的延迟，确保不是组合键操作
    keyTimer = setTimeout(async () => {
      // 执行普通翻译
      await executeTranslation(false);
    }, 200); // 200毫秒的延迟，足够区分单独按Shift和Shift+其他键
  }
  
  // 更新按键状态
  if (event.key === "Shift") {
    isShiftKeyDown = false;
  } else if (event.key === "Control") {
    isCtrlKeyDown = false;
  } else if (!event.metaKey && isMetaKeyDown) {
    // 如果Meta键被释放（此时event.metaKey已经为false）
    isMetaKeyDown = false;
  } else if (event.key === "p" || event.key === "P") {
    isPKeyDown = false;
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
