import type {
  AIServiceConfig,
  CreateMonitorInput,
  InteractionPrompt,
  ServerSettingsPatch,
  UpdateMonitorInput,
  XCookieInput,
} from "@fast-social/contracts";

export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
}

export function validateCreateMonitor(value: unknown): CreateMonitorInput {
  if (!isObject(value)) throw new ValidationError("请求内容无效");
  const input = value as Record<string, unknown>;
  const name = requiredString(input.name, "监控名称");
  const username = requiredString(input.username, "X 用户名");
  const prompt = requiredString(input.prompt, "Prompt");
  const intervalMinutes = validInterval(input.intervalMinutes);
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new ValidationError("启用状态无效");
  }
  return {
    name,
    username,
    prompt,
    intervalMinutes,
    enabled: input.enabled as boolean | undefined,
    platform: "x",
  };
}

export function validateUpdateMonitor(value: unknown): UpdateMonitorInput {
  if (!isObject(value)) throw new ValidationError("请求内容无效");
  const input = value as Record<string, unknown>;
  const update: UpdateMonitorInput = {};
  if (input.name !== undefined) update.name = requiredString(input.name, "监控名称");
  if (input.username !== undefined) {
    update.username = requiredString(input.username, "X 用户名");
  }
  if (input.prompt !== undefined) update.prompt = requiredString(input.prompt, "Prompt");
  if (input.intervalMinutes !== undefined) {
    update.intervalMinutes = validInterval(input.intervalMinutes);
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new ValidationError("启用状态无效");
    update.enabled = input.enabled;
  }
  return update;
}

export function validateSettingsPatch(value: unknown): ServerSettingsPatch {
  if (!isObject(value)) throw new ValidationError("请求内容无效");
  const patch: ServerSettingsPatch = {};

  if (value.ai !== undefined) {
    if (!isObject(value.ai) || !Array.isArray(value.ai.services)) {
      throw new ValidationError("AI 服务配置无效");
    }
    const defaultProvider = stringValue(value.ai.defaultProvider, "默认 AI 服务");
    const services = value.ai.services.map(validateAIService);
    if (new Set(services.map((service) => service.id)).size !== services.length) {
      throw new ValidationError("AI 服务 ID 不能重复");
    }
    if (defaultProvider) {
      const separator = defaultProvider.indexOf(":");
      const serviceId = defaultProvider.slice(0, separator);
      const modelName = defaultProvider.slice(separator + 1);
      const selected = services.find((service) => service.id === serviceId);
      if (separator < 1 || !selected?.enabled || !selected.models.some((model) => model.name === modelName)) {
        throw new ValidationError("默认 AI 服务或模型不存在");
      }
    }
    patch.ai = { defaultProvider, services };
  }

  if (value.interactionPrompts !== undefined) {
    if (!Array.isArray(value.interactionPrompts)) {
      throw new ValidationError("Prompt 配置无效");
    }
    patch.interactionPrompts = value.interactionPrompts.map(validateInteractionPrompt);
  }

  if (value.x !== undefined) {
    if (!isObject(value.x)) throw new ValidationError("X 配置无效");
    if (value.x.cookies !== undefined) {
      if (!Array.isArray(value.x.cookies)) {
        throw new ValidationError("X Cookie 列表无效");
      }
      const cookies = value.x.cookies.map(validateXCookie);
      if (new Set(cookies.map((cookie) => cookie.id)).size !== cookies.length) {
        throw new ValidationError("X Cookie ID 不能重复");
      }
      patch.x = { cookies };
    } else {
      patch.x = value.x.cookie === undefined
        ? {}
        : { cookie: stringValue(value.x.cookie, "X Cookie") };
    }
  }

  if (value.telegram !== undefined) {
    if (!isObject(value.telegram)) throw new ValidationError("Telegram 配置无效");
    patch.telegram = {
      ...(value.telegram.botToken === undefined
        ? {}
        : { botToken: stringValue(value.telegram.botToken, "Telegram Bot Token") }),
      ...(value.telegram.chatId === undefined
        ? {}
        : { chatId: stringValue(value.telegram.chatId, "Telegram Chat ID") }),
    };
  }

  return patch;
}

function validateAIService(value: unknown): AIServiceConfig {
  if (!isObject(value) || !Array.isArray(value.models)) {
    throw new ValidationError("AI 服务格式无效");
  }
  const id = requiredString(value.id, "AI 服务 ID");
  const name = requiredString(value.name, "AI 服务名称");
  const endpoint = requiredString(value.endpoint, "AI API 地址");
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new ValidationError("AI API 地址必须是有效的 HTTP(S) URL");
  }
  if (typeof value.enabled !== "boolean") throw new ValidationError("AI 服务启用状态无效");
  const apiFormat = value.apiFormat ?? "openai";
  if (apiFormat !== "openai" && apiFormat !== "anthropic") {
    throw new ValidationError("AI 接口格式无效");
  }
  const models = value.models.map((model) => {
    if (!isObject(model)) throw new ValidationError("AI 模型格式无效");
    return { name: requiredString(model.name, "AI 模型名称") };
  });
  if (models.length === 0) throw new ValidationError("AI 服务至少需要一个模型");
  if (new Set(models.map((model) => model.name)).size !== models.length) {
    throw new ValidationError("同一服务的模型名称不能重复");
  }
  return {
    id,
    name,
    endpoint,
    apiFormat,
    enabled: value.enabled,
    models,
    ...(value.apiKey === undefined
      ? {}
      : { apiKey: stringValue(value.apiKey, "AI API Key") }),
  };
}

function validateXCookie(value: unknown): XCookieInput {
  if (!isObject(value)) throw new ValidationError("X Cookie 格式无效");
  if (typeof value.enabled !== "boolean") {
    throw new ValidationError("X Cookie 启用状态无效");
  }
  return {
    id: requiredString(value.id, "X Cookie ID"),
    name: requiredString(value.name, "X Cookie 名称"),
    enabled: value.enabled,
    ...(value.cookie === undefined
      ? {}
      : { cookie: stringValue(value.cookie, "X Cookie") }),
  };
}

function validateInteractionPrompt(value: unknown): InteractionPrompt {
  if (!isObject(value)) throw new ValidationError("Prompt 格式无效");
  const scene = value.scene;
  if (scene !== "post" && scene !== "reply") throw new ValidationError("Prompt 场景无效");
  if (typeof value.enabled !== "boolean") throw new ValidationError("Prompt 启用状态无效");
  return {
    id: requiredString(value.id, "Prompt ID"),
    name: requiredString(value.name, "Prompt 名称"),
    prompt: requiredString(value.prompt, "Prompt 内容"),
    scene,
    enabled: value.enabled,
  };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`请填写${label}`);
  }
  return value.trim();
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new ValidationError(`${label}必须是字符串`);
  return value.trim();
}

function validInterval(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 1440) {
    throw new ValidationError("检查间隔必须是 1 到 1440 分钟之间的整数");
  }
  return Number(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
