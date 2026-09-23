import { computed, inject, ref } from "vue";
import type { InjectionKey } from "vue";
import type {
  AIServiceConfig,
  AccountProfileView,
  InteractionPrompt,
  Monitor,
  MonitorTestResult,
  ServerSettings,
  ServerSettingsPatch,
  XCookieConfig,
  XCookieInput,
} from "@fast-social/contracts";
import { requestLocalService } from "../../common/local-service";
import {
  RuntimeMessageTypeEnum,
  sendRuntimeMessage,
} from "../../common/runtime-message";

export type AdminNotice = { type: "success" | "warning" | "error"; text: string };
export type AIOption = { value: string; label: string };
export type TestResultKind = "x" | "ai" | "telegram" | "monitor";
export type TestResultState = {
  kind: TestResultKind;
  status: "success" | "error";
  title: string;
  summary: string;
  fields?: Array<{ label: string; value: string; mono?: boolean }>;
  content?: { label: string; value: string };
};
export type ServiceDraft = {
  id: string;
  name: string;
  endpoint: string;
  apiFormat: "openai" | "anthropic";
  apiKey: string;
  apiKeyConfigured: boolean;
  modelsText: string;
  enabled: boolean;
};
export type XCookieDraft = {
  id: string;
  name: string;
  cookie: string;
  cookieConfigured: boolean;
  enabled: boolean;
};
export type MonitorDraft = {
  id: string;
  name: string;
  username: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
};
export type PromptDraft = InteractionPrompt;

export function emptyServiceDraft(): ServiceDraft {
  return {
    id: "",
    name: "",
    endpoint: "https://api.openai.com/v1/chat/completions",
    apiFormat: "openai",
    apiKey: "",
    apiKeyConfigured: false,
    modelsText: "",
    enabled: true,
  };
}

export function serviceToDraft(service: AIServiceConfig): ServiceDraft {
  return {
    id: service.id,
    name: service.name,
    endpoint: service.endpoint,
    apiFormat: service.apiFormat ?? "openai",
    apiKey: "",
    apiKeyConfigured: Boolean(service.apiKeyConfigured),
    modelsText: service.models.map((model) => model.name).join("\n"),
    enabled: service.enabled,
  };
}

export function emptyXCookieDraft(): XCookieDraft {
  return {
    id: "",
    name: "",
    cookie: "",
    cookieConfigured: false,
    enabled: true,
  };
}

export function xCookieToDraft(cookie: XCookieConfig): XCookieDraft {
  return {
    id: cookie.id,
    name: cookie.name,
    cookie: "",
    cookieConfigured: cookie.cookieConfigured,
    enabled: cookie.enabled,
  };
}

export function emptyMonitorDraft(): MonitorDraft {
  return {
    id: "",
    name: "",
    username: "",
    prompt: "",
    intervalMinutes: 10,
    enabled: true,
  };
}

export function monitorToDraft(monitor: Monitor): MonitorDraft {
  return {
    id: monitor.id,
    name: monitor.name,
    username: monitor.username,
    prompt: monitor.prompt,
    intervalMinutes: monitor.intervalMinutes,
    enabled: monitor.enabled,
  };
}

export function emptyPromptDraft(): PromptDraft {
  return {
    id: "",
    name: "",
    scene: "post",
    prompt: "",
    enabled: true,
  };
}

export function promptToDraft(prompt: InteractionPrompt): PromptDraft {
  return { ...prompt };
}

export function useServerAdmin() {
  const loading = ref(false);
  const busyAction = ref<string | null>(null);
  const online = ref(false);
  const serviceError = ref("");
  const settingsError = ref("");
  const monitorsError = ref("");
  const settings = ref<ServerSettings | null>(null);
  const monitors = ref<Monitor[]>([]);
  const notice = ref<AdminNotice | null>(null);
  const testResult = ref<TestResultState | null>(null);
  const testUsername = ref("");
  const secretDraft = ref({ telegramToken: "" });

  const aiOptions = computed<AIOption[]>(() =>
    (settings.value?.ai.services ?? []).flatMap((service) =>
      service.enabled && service.apiKeyConfigured
        ? service.models.map((model) => ({
            value: `${service.id}:${model.name}`,
            label: `${service.name} / ${model.name}`,
          }))
        : [],
    ),
  );

  const configuredAIServiceCount = computed(
    () => settings.value?.ai.services.filter((service) => service.enabled).length ?? 0,
  );
  const enabledMonitorCount = computed(
    () => monitors.value.filter((monitor) => monitor.enabled).length,
  );

  async function refreshService(): Promise<void> {
    loading.value = true;
    serviceError.value = "";
    settingsError.value = "";
    monitorsError.value = "";
    try {
      try {
        await requestLocalService("/health");
        online.value = true;
      } catch (error) {
        online.value = false;
        settings.value = null;
        monitors.value = [];
        serviceError.value = errorMessage(error);
        return;
      }

      const [settingsResult, monitorsResult] = await Promise.allSettled([
        loadSettings(),
        loadMonitors(),
      ]);
      if (settingsResult.status === "rejected") {
        settings.value = null;
        settingsError.value = `服务配置加载失败：${errorMessage(settingsResult.reason)}`;
      }
      if (monitorsResult.status === "rejected") {
        monitors.value = [];
        monitorsError.value = `监听列表加载失败：${errorMessage(monitorsResult.reason)}`;
      }
    } finally {
      loading.value = false;
    }
  }

  async function loadSettings(resetSecrets = true): Promise<void> {
    settings.value = await requestLocalService<ServerSettings>("/api/settings");
    if (resetSecrets) secretDraft.value = { telegramToken: "" };
    settingsError.value = "";
  }

  async function refreshXSettings(): Promise<void> {
    const updated = await requestLocalService<ServerSettings>("/api/settings");
    if (settings.value) settings.value.x = updated.x;
    else settings.value = updated;
    settingsError.value = "";
  }

  async function loadMonitors(): Promise<void> {
    monitors.value = await requestLocalService<Monitor[]>("/api/monitors");
    monitorsError.value = "";
  }

  async function updateSettings(
    patch: ServerSettingsPatch,
    action: string,
    successMessage?: string,
    onFailure: (error: unknown) => void = showError,
  ): Promise<boolean> {
    busyAction.value = action;
    try {
      const updated = await requestLocalService<ServerSettings>("/api/settings", {
        method: "PUT",
        body: patch,
      });
      settings.value = mergeSettingsPatch(settings.value, updated, patch);
      settingsError.value = "";

      try {
        const response = await sendRuntimeMessage({
          type: RuntimeMessageTypeEnum.CONFIG_UPDATE,
        });
        if (!response.is_ok) {
          throw new Error(errorMessage(response.error));
        }
        if (successMessage) showNotice(successMessage);
      } catch (error) {
        console.warn("配置已保存，但插件页面同步通知失败", error);
        showNotice(
          "配置已保存，但页面同步通知失败；刷新 X 页面即可生效",
          "warning",
        );
      }
      return true;
    } catch (error) {
      onFailure(error);
      return false;
    } finally {
      busyAction.value = null;
    }
  }

  function telegramPatch(): ServerSettingsPatch | null {
    if (!settings.value) return null;
    return {
      telegram: {
        chatId: settings.value.telegram.chatId.trim(),
        ...(secretDraft.value.telegramToken.trim()
          ? { botToken: secretDraft.value.telegramToken.trim() }
          : {}),
      },
    };
  }

  function aiPatch(): ServerSettingsPatch | null {
    if (!settings.value) return null;
    return {
      ai: {
        defaultProvider: settings.value.ai.defaultProvider,
        services: settings.value.ai.services.map((service) => ({
          id: service.id,
          name: service.name,
          endpoint: service.endpoint,
          apiFormat: service.apiFormat ?? "openai",
          enabled: service.enabled,
          models: service.models,
          ...(service.apiKey?.trim() ? { apiKey: service.apiKey.trim() } : {}),
        })),
      },
    };
  }

  function promptsPatch(): ServerSettingsPatch | null {
    if (!settings.value) return null;
    return { interactionPrompts: settings.value.interactionPrompts };
  }

  async function saveTelegram(
    showSuccess = true,
    onFailure: (error: unknown) => void = showError,
  ): Promise<boolean> {
    const patch = telegramPatch();
    if (!patch) return false;
    const saved = await updateSettings(
      patch,
      "telegram",
      showSuccess ? "Telegram 配置已保存" : undefined,
      onFailure,
    );
    if (saved) secretDraft.value.telegramToken = "";
    return saved;
  }

  function xCookieInputs(
    transform?: (cookies: XCookieInput[]) => XCookieInput[],
  ): XCookieInput[] {
    const cookies = (settings.value?.x.cookies ?? []).map((cookie) => ({
      id: cookie.id,
      name: cookie.name,
      enabled: cookie.enabled,
    }));
    return transform ? transform(cookies) : cookies;
  }

  async function saveXCookieDraft(draft: XCookieDraft): Promise<boolean> {
    if (!settings.value) return false;
    const name = draft.name.trim();
    const cookie = draft.cookie.trim();
    if (!name || (!draft.cookieConfigured && !cookie)) {
      showNotice("请填写配置名称和完整 Cookie", "error");
      return false;
    }

    const id = draft.id || crypto.randomUUID();
    const next: XCookieInput = {
      id,
      name,
      enabled: draft.enabled,
      ...(cookie ? { cookie } : {}),
    };
    const cookies = xCookieInputs((items) => {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) items.splice(index, 1, next);
      else items.push(next);
      return items;
    });
    return updateSettings(
      { x: { cookies } },
      `x-cookie:${id}`,
      draft.id ? "X Cookie 已更新" : "X Cookie 已添加",
    );
  }

  async function removeXCookie(id: string): Promise<boolean> {
    if (!settings.value) return false;
    return updateSettings(
      { x: { cookies: xCookieInputs((items) => items.filter((item) => item.id !== id)) } },
      `x-cookie:${id}`,
      "X Cookie 已删除",
    );
  }

  async function toggleXCookie(cookie: XCookieConfig, enabled: boolean): Promise<boolean> {
    if (!settings.value) return false;
    return updateSettings(
      {
        x: {
          cookies: xCookieInputs((items) => items.map((item) =>
            item.id === cookie.id ? { ...item, enabled } : item,
          )),
        },
      },
      `x-cookie:${cookie.id}`,
    );
  }

  async function saveAI(showSuccess = true): Promise<boolean> {
    const patch = aiPatch();
    if (!patch) return false;
    return updateSettings(
      patch,
      "ai",
      showSuccess ? "AI 服务配置已保存" : undefined,
    );
  }

  async function savePrompts(showSuccess = true): Promise<boolean> {
    const patch = promptsPatch();
    if (!patch) return false;
    return updateSettings(
      patch,
      "prompts",
      showSuccess ? "互动 Prompt 已保存" : undefined,
    );
  }

  async function saveServiceDraft(draft: ServiceDraft): Promise<boolean> {
    if (!settings.value) return false;
    const models = draft.modelsText
      .split(/[\n,]/)
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
    if (!draft.name.trim() || !draft.endpoint.trim() || models.length === 0) {
      showNotice("请填写服务名称、API 地址和至少一个模型", "error");
      return false;
    }

    const service: AIServiceConfig = {
      id: draft.id || crypto.randomUUID(),
      name: draft.name.trim(),
      endpoint: draft.endpoint.trim(),
      apiFormat: draft.apiFormat,
      enabled: draft.enabled,
      models,
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      ...(draft.apiKeyConfigured ? { apiKeyConfigured: true } : {}),
    };
    const previousServices = cloneServices(settings.value.ai.services);
    const previousDefaultProvider = settings.value.ai.defaultProvider;
    const services = settings.value.ai.services;
    const index = services.findIndex((item) => item.id === service.id);
    if (index >= 0) services.splice(index, 1, service);
    else services.push(service);

    const defaultPrefix = `${service.id}:`;
    if (settings.value.ai.defaultProvider.startsWith(defaultPrefix)) {
      const defaultModel = settings.value.ai.defaultProvider.slice(defaultPrefix.length);
      if (!service.enabled || !models.some((model) => model.name === defaultModel)) {
        settings.value.ai.defaultProvider = "";
      }
    }

    const saved = await saveAI();
    if (!saved && settings.value) {
      settings.value.ai.services = previousServices;
      settings.value.ai.defaultProvider = previousDefaultProvider;
    }
    return saved;
  }

  async function removeService(id: string): Promise<boolean> {
    if (!settings.value) return false;
    const previousServices = cloneServices(settings.value.ai.services);
    const previousDefaultProvider = settings.value.ai.defaultProvider;
    settings.value.ai.services = settings.value.ai.services.filter(
      (service) => service.id !== id,
    );
    if (settings.value.ai.defaultProvider.startsWith(`${id}:`)) {
      settings.value.ai.defaultProvider = "";
    }
    const saved = await saveAI();
    if (!saved && settings.value) {
      settings.value.ai.services = previousServices;
      settings.value.ai.defaultProvider = previousDefaultProvider;
    }
    return saved;
  }

  async function savePromptDraft(draft: PromptDraft): Promise<boolean> {
    if (!settings.value) return false;
    if (!draft.name.trim() || !draft.prompt.trim()) {
      showNotice("请填写 Prompt 名称和内容", "error");
      return false;
    }
    const prompt: InteractionPrompt = {
      ...draft,
      id: draft.id || crypto.randomUUID(),
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
    };
    const previousPrompts = settings.value.interactionPrompts.map((item) => ({ ...item }));
    const prompts = settings.value.interactionPrompts;
    const index = prompts.findIndex((item) => item.id === prompt.id);
    if (index >= 0) prompts.splice(index, 1, prompt);
    else prompts.push(prompt);
    const saved = await savePrompts();
    if (!saved && settings.value) settings.value.interactionPrompts = previousPrompts;
    return saved;
  }

  async function removePrompt(id: string): Promise<boolean> {
    if (!settings.value) return false;
    const previousPrompts = settings.value.interactionPrompts.map((item) => ({ ...item }));
    settings.value.interactionPrompts = settings.value.interactionPrompts.filter(
      (prompt) => prompt.id !== id,
    );
    const saved = await savePrompts();
    if (!saved && settings.value) settings.value.interactionPrompts = previousPrompts;
    return saved;
  }

  async function saveMonitorDraft(input: MonitorDraft): Promise<boolean> {
    if (!input.name.trim() || !input.username.trim() || !input.prompt.trim()) {
      showNotice("请填写监控名称、用户名和判断 Prompt", "error");
      return false;
    }
    busyAction.value = input.id ? `monitor:${input.id}` : "monitor:new";
    try {
      const savedMonitor = await requestLocalService<Monitor>(
        input.id ? `/api/monitors/${input.id}` : "/api/monitors",
        {
          method: input.id ? "PUT" : "POST",
          body: {
            name: input.name.trim(),
            username: input.username.trim().replace(/^@/, ""),
            prompt: input.prompt.trim(),
            intervalMinutes: input.intervalMinutes,
            enabled: input.enabled,
          },
        },
      );
      const index = monitors.value.findIndex((monitor) => monitor.id === savedMonitor.id);
      if (index >= 0) monitors.value.splice(index, 1, savedMonitor);
      else monitors.value.push(savedMonitor);
      monitorsError.value = "";
      showNotice("监听规则已保存");
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      busyAction.value = null;
    }
  }

  async function toggleMonitor(monitor: Monitor, enabled: boolean): Promise<boolean> {
    busyAction.value = `monitor:${monitor.id}`;
    try {
      const updated = await requestLocalService<Monitor>(`/api/monitors/${monitor.id}`, {
        method: "PUT",
        body: { enabled },
      });
      const index = monitors.value.findIndex((item) => item.id === monitor.id);
      if (index >= 0) monitors.value.splice(index, 1, updated);
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      busyAction.value = null;
    }
  }

  async function deleteMonitor(id: string): Promise<boolean> {
    busyAction.value = `monitor:${id}`;
    try {
      await requestLocalService(`/api/monitors/${id}`, { method: "DELETE" });
      monitors.value = monitors.value.filter((monitor) => monitor.id !== id);
      showNotice("监听规则已删除");
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      busyAction.value = null;
    }
  }

  async function runMonitor(monitor: Monitor): Promise<void> {
    busyAction.value = `run:${monitor.id}`;
    try {
      const result = await requestLocalService<MonitorTestResult>(
        `/api/monitors/${monitor.id}/run`,
        { method: "POST" },
      );
      showTestResult({
        kind: "monitor",
        status: "success",
        title: "监听批量测试结果",
        summary: `已分析最近 ${result.posts.length} 条 Post：${result.decisions.filter(item => item.status === 'match').length} 条命中，${result.decisions.filter(item => item.status === 'uncertain').length} 条不确定。测试不发送通知，不修改正式画像和监听进度。`,
        fields: [
          { label: "监听规则", value: monitor.name },
          { label: "X 用户", value: `@${monitor.username}` },
          { label: "画像版本", value: result.profileVersion ? `v${result.profileVersion}` : '首次学习预览' },
          { label: "结果来源", value: result.cached ? '相同输入的缓存结果' : '本次批量分析' },
        ],
        content: {
          label: "Post 与判断依据",
          value: [...result.posts].reverse().map(post => {
            const decision = result.decisions.find(item => item.postId === post.id);
            const label = decision?.status === 'match' ? '命中' : decision?.status === 'uncertain' ? '不确定' : '未命中';
            return `${post.text}\n${post.url}\n${label}：${decision?.reason ?? ''}${decision?.eventTime ? `\n时间：${decision.eventTime}` : ''}${decision?.evidenceIds.length ? `\n依据帖子：${decision.evidenceIds.join('、')}` : ''}`;
          }).join('\n\n────────\n\n'),
        },
      });
    } catch (error) {
      showTestError("monitor", "监听测试结果", error, [
        { label: "监听规则", value: monitor.name },
        { label: "X 用户", value: `@${monitor.username}` },
      ]);
    } finally {
      busyAction.value = null;
    }
  }

  async function getMonitorProfile(monitor: Monitor): Promise<AccountProfileView | null> {
    busyAction.value = `profile:${monitor.id}`;
    try { return await requestLocalService<AccountProfileView>(`/api/monitors/${monitor.id}/profile`); }
    catch (error) { showError(error); return null; }
    finally { busyAction.value = null; }
  }
  async function saveMonitorProfile(monitor: Monitor, text: string): Promise<AccountProfileView | null> {
    busyAction.value = `profile:${monitor.id}`;
    try {
      const result = await requestLocalService<AccountProfileView>(`/api/monitors/${monitor.id}/profile`, { method: 'PUT', body: { text } });
      showNotice(text.trim() ? '画像已更新，同账号的规则共享此画像' : '画像已清空，之后只从新证据学习');
      return result;
    } catch (error) { showError(error); return null; }
    finally { busyAction.value = null; }
  }

  async function testXCookie(cookie: XCookieConfig): Promise<void> {
    const username = testUsername.value.trim().replace(/^@/, "");
    if (!username) {
      showTestError("x", "X 测试结果", "请先填写测试用户名", [
        { label: "Cookie 配置", value: cookie.name },
      ]);
      return;
    }
    busyAction.value = `test:x:${cookie.id}`;
    try {
      const result = await requestLocalService<{
        username: string;
        posts: Array<{ text: string }>;
      }>(
        "/api/test/x",
        { method: "POST", body: { username, cookieId: cookie.id } },
      );
      showTestResult({
        kind: "x",
        status: "success",
        title: "X 测试结果",
        summary: result.posts.length > 0
          ? "Cookie 验证成功，并成功读取到 Post。"
          : "Cookie 验证成功，但该用户暂时没有可读取的 Post。",
        fields: [
          { label: "Cookie 配置", value: cookie.name },
          { label: "X 用户", value: `@${result.username || username}` },
          { label: "读取数量", value: `${result.posts.length} 条` },
        ],
        ...(result.posts[0]
          ? { content: { label: "最新 Post", value: result.posts[0].text } }
          : {}),
      });
      await refreshXSettings().catch(() => undefined);
    } catch (error) {
      showTestError("x", "X 测试结果", error, [
        { label: "Cookie 配置", value: cookie.name },
        { label: "X 用户", value: `@${username}` },
      ]);
      await refreshXSettings().catch(() => undefined);
    } finally {
      busyAction.value = null;
    }
  }

  async function testAI(): Promise<void> {
    const provider = settings.value?.ai.defaultProvider ?? "";
    const separator = provider.indexOf(":");
    const serviceId = separator >= 0 ? provider.slice(0, separator) : "";
    const modelName = separator >= 0 ? provider.slice(separator + 1) : "";
    const service = settings.value?.ai.services.find((item) => item.id === serviceId);
    if (!service || !modelName) {
      showTestError("ai", "AI 测试结果", "请先选择默认服务和模型");
      return;
    }
    const fields = [
      { label: "AI 服务", value: service.name },
      {
        label: "接口格式",
        value: service.apiFormat === "anthropic" ? "Anthropic Messages" : "OpenAI Chat Completions",
      },
      { label: "模型", value: modelName, mono: true },
      { label: "Endpoint", value: service.endpoint, mono: true },
    ];
    busyAction.value = "test:ai";
    try {
      const result = await requestLocalService<{ content: string }>("/api/test/ai", {
        method: "POST",
        body: { provider },
      });
      showTestResult({
        kind: "ai",
        status: "success",
        title: "AI 测试结果",
        summary: "接口连接、鉴权和模型响应均正常。",
        fields,
        content: { label: "模型原始回复", value: result.content },
      });
    } catch (error) {
      showTestError("ai", "AI 测试结果", error, fields);
    } finally {
      busyAction.value = null;
    }
  }

  async function testTelegram(): Promise<void> {
    const fields = settings.value?.telegram.chatId
      ? [{ label: "目标 Chat ID", value: maskIdentifier(settings.value.telegram.chatId) }]
      : undefined;
    const saved = await saveTelegram(false, (error) => {
      showTestError("telegram", "Telegram 测试结果", error, fields);
    });
    if (!saved) return;
    busyAction.value = "test:telegram";
    try {
      await requestLocalService("/api/test/telegram", { method: "POST" });
      showTestResult({
        kind: "telegram",
        status: "success",
        title: "Telegram 测试结果",
        summary: "测试消息已成功发送，请在 Telegram 中确认收到。",
        fields,
      });
    } catch (error) {
      showTestError("telegram", "Telegram 测试结果", error, fields);
    } finally {
      busyAction.value = null;
    }
  }

  function showTestResult(result: TestResultState): void {
    testResult.value = result;
  }

  function showTestError(
    kind: TestResultKind,
    title: string,
    error: unknown,
    fields?: TestResultState["fields"],
  ): void {
    showTestResult({
      kind,
      status: "error",
      title,
      summary: "测试失败，请检查下面的错误信息后重试。",
      fields,
      content: { label: "错误详情", value: errorMessage(error) },
    });
  }

  function closeTestResult(): void {
    testResult.value = null;
  }

  function showNotice(
    text: string,
    type: AdminNotice["type"] = "success",
  ): void {
    notice.value = { type, text };
    window.setTimeout(() => {
      if (notice.value?.text === text) notice.value = null;
    }, 6_000);
  }

  function showError(error: unknown): void {
    showNotice(errorMessage(error), "error");
  }

  return {
    loading,
    busyAction,
    online,
    serviceError,
    settingsError,
    monitorsError,
    settings,
    monitors,
    notice,
    testResult,
    testUsername,
    secretDraft,
    aiOptions,
    configuredAIServiceCount,
    enabledMonitorCount,
    refreshService,
    saveTelegram,
    saveXCookieDraft,
    removeXCookie,
    toggleXCookie,
    saveAI,
    savePrompts,
    saveServiceDraft,
    removeService,
    savePromptDraft,
    removePrompt,
    saveMonitorDraft,
    toggleMonitor,
    deleteMonitor,
    runMonitor,
    getMonitorProfile,
    saveMonitorProfile,
    testXCookie,
    testAI,
    testTelegram,
    closeTestResult,
    showNotice,
  };
}

export type ServerAdmin = ReturnType<typeof useServerAdmin>;
export const SERVER_ADMIN_KEY: InjectionKey<ServerAdmin> = Symbol("server-admin");

export function useServerAdminContext(): ServerAdmin {
  const admin = inject(SERVER_ADMIN_KEY);
  if (!admin) throw new Error("Server admin context is unavailable");
  return admin;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function maskIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 6) return trimmed;
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-3)}`;
}

function cloneServices(services: AIServiceConfig[]): AIServiceConfig[] {
  return services.map((service) => ({
    ...service,
    models: service.models.map((model) => ({ ...model })),
  }));
}

function mergeSettingsPatch(
  current: ServerSettings | null,
  updated: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  if (!current) return updated;

  return {
    ai: patch.ai === undefined ? current.ai : updated.ai,
    interactionPrompts:
      patch.interactionPrompts === undefined
        ? current.interactionPrompts
        : updated.interactionPrompts,
    x: patch.x === undefined ? current.x : updated.x,
    telegram:
      patch.telegram === undefined ? current.telegram : updated.telegram,
  };
}
