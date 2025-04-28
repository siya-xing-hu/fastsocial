/**
 * @fileoverview 用于 chrome.runtime.sendMessage 的统一消息结构
 */
import { log } from "./logging";
import { TranslateChannelEnum } from "./storage-config";

// 消息类型定义
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// 用于 chrome.runtime.sendMessage 的统一消息结构
export enum RuntimeMessageTypeEnum {
  TRANSLATE = "translate",
  CONFIG_UPDATE = "config-update",
  AI_GENARATE = "ai-genarate",
  CONTENT_SCRIPT_READY = "content-script-ready",
  AI_STREAM_START = "ai-stream-start",
  AI_STREAM_CHUNK = "ai-stream-chunk",
  AI_STREAM_END = "ai-stream-end",
}

export type RuntimeMessage =
  | TranslateRuntimeMessage
  | ConfigUpdateRuntimeMessage
  | AIGenarateRuntimeMessage
  | ContentScriptReadyMessage
  | AIStreamStartMessage
  | AIStreamChunkMessage
  | AIStreamEndMessage;

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
  messages: Message[];
  aiProvider: string;
  stream?: boolean; // 是否使用流式输出
}

export interface AIStreamStartMessage {
  type: RuntimeMessageTypeEnum.AI_STREAM_START;
  data: {
    requestId: string; // 请求唯一标识，用于关联同一个请求的多个消息
  };
}

export interface AIStreamChunkMessage {
  type: RuntimeMessageTypeEnum.AI_STREAM_CHUNK;
  data: {
    requestId: string;
    chunk: string;
  };
}

export interface AIStreamEndMessage {
  type: RuntimeMessageTypeEnum.AI_STREAM_END;
  data: {
    requestId: string;
    error?: string; // 如果有错误，提供错误信息
  };
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
