/**
 * @fileoverview 用于 chrome.runtime.sendMessage 的统一消息结构
 */
import { log } from "./logging";
import { PromptScenes, TranslateChannelEnum } from "./storage-config";

// 用于 chrome.runtime.sendMessage 的统一消息结构
export enum RuntimeMessageTypeEnum {
  TRANSLATE = "translate",
  CONFIG_UPDATE = "config-update",
  AI_GENARATE = "ai-genarate",
  CONTENT_SCRIPT_READY = "content-script-ready",
}

export type RuntimeMessage =
  | TranslateRuntimeMessage
  | ConfigUpdateRuntimeMessage
  | AIGenarateRuntimeMessage
  | ContentScriptReadyMessage;

export interface TranslateRuntimeMessage {
  type: RuntimeMessageTypeEnum.TRANSLATE;
  data: {
    channel: TranslateChannelEnum;
    content: string;
    is_advanced: boolean;
  };
}

export interface ConfigUpdateRuntimeMessage {
  type: RuntimeMessageTypeEnum.CONFIG_UPDATE;
}

export interface AIGenarateRuntimeMessage {
  type: RuntimeMessageTypeEnum.AI_GENARATE;
  data: AIGenarateData;
}

export interface AIGenarateData {
  scene: PromptScenes;
  id: string;
  content: string;
  keywords?: string | null;
}

export interface ContentScriptReadyMessage {
  type: RuntimeMessageTypeEnum.CONTENT_SCRIPT_READY;
}

// 用于 chrome.runtime.sendMessage 的统一响应结构
export type RuntimeMessageResponse =
  | OkRuntimeMessageResponse
  | ErrorRuntimeMessageResponse;

export interface OkRuntimeMessageResponse {
  is_ok: true;
  data?: any;
}

export interface ErrorRuntimeMessageResponse {
  is_ok: false;
  error: any;
}

// 封装 chrome.runtime.sendMessage 统一处理
export async function sendRuntimeMessage(message: RuntimeMessage) {
  const response: RuntimeMessageResponse = await chrome.runtime.sendMessage(
    message,
  );
  log("received response:", response);
  return response;
}
