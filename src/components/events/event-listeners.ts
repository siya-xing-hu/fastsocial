/**
 * @fileoverview 处理鼠标和键盘监听事件的模块
 */

import { log, log_error } from "../../common/logging";
import { execNotionTranslate, execTranslate } from "../translate/text-translator";
import { createApp } from "vue";
import CommonDialog from "../ui/CommonDialog.vue";
import hotkeys from 'hotkeys-js';

// 鼠标位置
let mousePosition = { x: 0, y: 0 };

// 翻译状态
let isTranslating = false;

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
  
  // 添加鼠标按键监听
  document.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mouseup", handleMouseUp);
  
  // 配置 hotkeys 的设置
  hotkeys.filter = function() {
    return true; // 允许所有元素上触发快捷键
  };
  
  // 设置快捷键
  hotkeys('ctrl+shift+p,ctrl+shift+t,ctrl+t', function(event, handler) {
    log("ctrl+shift+p,ctrl+shift+t,ctrl+t", handler.key, isMouseButtonDown);
    if (isMouseButtonDown) {
      return;
    }
    switch (handler.key) {
      case 'ctrl+shift+p':
        event.preventDefault();
        openCommonDialog();
        break;
      case 'ctrl+shift+t':
        event.preventDefault();
        executeTranslation(true);
        break;
      case 'ctrl+t':
        event.preventDefault();
        executeTranslation(false);
        break;
    }
  });
  
  log("事件监听器初始化完成");
}

/**
 * 处理鼠标移动事件
 */
function handleMouseMove(event: MouseEvent) {
  mousePosition = { x: event.clientX, y: event.clientY };
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
  commonDialogInstance.className = "common-dialog-container";
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
