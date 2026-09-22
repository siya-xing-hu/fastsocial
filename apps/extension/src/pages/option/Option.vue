<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <aside class="fixed inset-y-0 left-0 w-56 border-r border-slate-200 bg-white p-5">
      <h1 class="mb-7 text-xl font-semibold">Fast Social</h1>
      <nav class="space-y-1">
        <button
          v-for="item in menuItems"
          :key="item.key"
          class="w-full rounded-lg px-3 py-2 text-left text-sm"
          :class="currentMenu === item.key ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'"
          @click="currentMenu = item.key"
        >
          {{ item.label }}
        </button>
      </nav>
    </aside>

    <main class="ml-56 max-w-6xl p-8">
      <div v-if="notice" class="mb-5 rounded-lg border px-4 py-3 text-sm" :class="notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'">
        {{ notice.text }}
      </div>

      <section v-if="currentMenu === 'translation'">
        <PageTitle title="基础翻译" description="Google 和 DeepL 配置保存在插件中，本地服务关闭时仍可使用。" />
        <div class="card grid gap-6 md:grid-cols-2">
          <Field label="翻译服务">
            <select v-model="config.basic.translateProvider" class="input" @change="onInput()">
              <option value="auto">自动（Google 优先）</option>
              <option value="google">Google</option>
              <option value="deepl">DeepL</option>
              <option value="ai">AI（离线自动降级）</option>
            </select>
          </Field>
          <Field label="目标语言">
            <select v-model="config.basic.targetLang" class="input" @change="onInput()">
              <option value="zh-CN">中文</option>
              <option value="en">英文</option>
            </select>
          </Field>
          <Field label="DeepL API 地址">
            <select v-model="config.translationService.deeplApiEndpoint" class="input" @change="onInput()">
              <option value="https://api.deepl.com/v2/translate">Developer / Growth</option>
              <option value="https://api-free.deepl.com/v2/translate">API Free</option>
            </select>
          </Field>
          <Field label="DeepL API Key">
            <input type="password" class="input" :value="getDeeplApiKey()" placeholder="仅保存在插件中" @input="setDeeplApiKey(($event.target as HTMLInputElement).value)" />
          </Field>
          <Field label="Google 失败后使用 DeepL（分钟）">
            <input v-model.number="config.translationService.fallbackDurationMinutes" type="number" min="1" class="input" @change="onInput()" />
          </Field>
          <label class="flex items-center gap-3 self-end rounded-lg border border-slate-200 px-4 py-3">
            <input v-model="config.basic.autoTranslate" type="checkbox" @change="onInput()" />
            <span class="text-sm font-medium">自动翻译 X 帖子</span>
          </label>
          <Field label="AI 翻译 Prompt" class="md:col-span-2">
            <textarea v-model="config.translationService.translatePrompt" class="input min-h-28" placeholder="留空使用默认翻译 Prompt" @change="onInput()" />
          </Field>
        </div>
      </section>

      <section v-else>
        <div class="mb-6 flex items-start justify-between gap-4">
          <PageTitle title="本地监控服务" description="AI、X Cookie、Telegram 与定时监控统一由 127.0.0.1:5127 管理。" />
          <button class="button-secondary shrink-0" :disabled="loading" @click="refreshService">刷新状态</button>
        </div>

        <div class="mb-6 flex items-center gap-3 rounded-xl border p-4" :class="online ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'">
          <span class="h-2.5 w-2.5 rounded-full" :class="online ? 'bg-green-500' : 'bg-amber-500'" />
          <div>
            <p class="font-medium">{{ online ? `服务在线 · v${health?.version}` : '服务未启动' }}</p>
            <p class="text-sm text-slate-600">{{ online ? '配置和定时任务已可用' : '请先在项目目录运行 pnpm dev:server；AI 入口会保持隐藏。' }}</p>
          </div>
        </div>

        <template v-if="online && settings">
          <div class="mb-6 grid gap-6 lg:grid-cols-2">
            <div class="card">
              <CardTitle title="X 登录" description="粘贴当前浏览器中的完整 Cookie，仅保存在本机数据库。" />
              <Field label="Cookie">
                <textarea v-model="secretDraft.xCookie" class="input min-h-24" :placeholder="settings.x.cookieConfigured ? '已配置；留空表示保留' : 'auth_token=...; ct0=...'" />
              </Field>
              <div class="mt-4 flex gap-2">
                <input v-model="testUsername" class="input" placeholder="测试用户名，例如 tibo_maker" />
                <button class="button-secondary shrink-0" @click="testX">测试 X</button>
              </div>
            </div>

            <div class="card">
              <CardTitle title="Telegram" description="匹配后直接发送；失败只记录错误，不补发。" />
              <div class="space-y-4">
                <Field label="Bot Token">
                  <input v-model="secretDraft.telegramToken" type="password" class="input" :placeholder="settings.telegram.botTokenConfigured ? '已配置；留空表示保留' : '123456:ABC...'" />
                </Field>
                <Field label="Chat ID">
                  <input v-model="settings.telegram.chatId" class="input" placeholder="例如 123456789" />
                </Field>
                <button class="button-secondary" @click="testTelegram">发送测试消息</button>
              </div>
            </div>
          </div>

          <div class="card mb-6">
            <div class="mb-5 flex items-start justify-between gap-4">
              <CardTitle title="AI 服务" description="支持 OpenAI 兼容的 Chat Completions 地址。" />
              <button class="button-primary" @click="openServiceDialog()">添加服务</button>
            </div>
            <div v-if="settings.ai.services.length === 0" class="empty">还没有 AI 服务</div>
            <div v-else class="divide-y divide-slate-100 rounded-lg border border-slate-200">
              <div v-for="service in settings.ai.services" :key="service.id" class="grid items-center gap-4 p-4 md:grid-cols-[1fr_1.6fr_1fr_auto]">
                <div>
                  <p class="font-medium">{{ service.name }}</p>
                  <p class="text-xs text-slate-500">{{ service.apiKeyConfigured ? 'Key 已配置' : '缺少 Key' }}</p>
                </div>
                <p class="truncate text-sm text-slate-600" :title="service.endpoint">{{ service.endpoint }}</p>
                <p class="text-sm text-slate-600">{{ service.models.map(model => model.name).join(', ') }}</p>
                <div class="flex items-center gap-2">
                  <label class="text-sm"><input v-model="service.enabled" type="checkbox" /> 启用</label>
                  <button class="link" @click="openServiceDialog(service)">编辑</button>
                  <button class="link text-red-600" @click="removeService(service.id)">删除</button>
                </div>
              </div>
            </div>
            <div class="mt-5 grid items-end gap-4 md:grid-cols-[1fr_auto]">
              <Field label="默认模型">
                <select v-model="settings.ai.defaultProvider" class="input">
                  <option value="">请选择</option>
                  <option v-for="option in aiOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </Field>
              <button class="button-secondary" @click="testAI">测试 AI</button>
            </div>
          </div>

          <div class="card mb-6">
            <div class="mb-5 flex items-start justify-between gap-4">
              <CardTitle title="发帖 / 回复 Prompt" description="服务在线时，插件才会在 X 页面显示这些 AI 快捷操作。" />
              <button class="button-secondary" @click="addPrompt">添加 Prompt</button>
            </div>
            <div v-if="settings.interactionPrompts.length === 0" class="empty">没有 Prompt，插件不会显示 AI 发帖或回复按钮</div>
            <div v-for="prompt in settings.interactionPrompts" :key="prompt.id" class="mb-3 grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-[140px_1fr_auto]">
              <div class="space-y-3">
                <input v-model="prompt.name" class="input" placeholder="名称" />
                <select v-model="prompt.scene" class="input"><option value="post">发帖</option><option value="reply">回复</option></select>
              </div>
              <textarea v-model="prompt.prompt" class="input min-h-24" placeholder="可用 {userContent}、{replyContent}" />
              <div class="flex items-start gap-2">
                <label class="text-sm"><input v-model="prompt.enabled" type="checkbox" /> 启用</label>
                <button class="link text-red-600" @click="removePrompt(prompt.id)">删除</button>
              </div>
            </div>
          </div>

          <div class="mb-6 flex justify-end">
            <button class="button-primary" :disabled="saving" @click="saveServerSettings()">{{ saving ? '保存中…' : '保存服务配置' }}</button>
          </div>

          <div class="card">
            <div class="mb-5 flex items-start justify-between gap-4">
              <CardTitle title="用户 Post 监控" description="首次执行只建立最新帖子基线，不通知历史内容。" />
              <button class="button-primary" @click="openMonitorDialog()">添加监控</button>
            </div>
            <div v-if="monitors.length === 0" class="empty">还没有监控规则</div>
            <div v-else class="divide-y divide-slate-100 rounded-lg border border-slate-200">
              <div v-for="monitor in monitors" :key="monitor.id" class="grid items-center gap-4 p-4 md:grid-cols-[1fr_120px_100px_1.2fr_auto]">
                <div><p class="font-medium">{{ monitor.name }}</p><p class="text-xs text-slate-500">@{{ monitor.username }}</p></div>
                <p class="text-sm">每 {{ monitor.intervalMinutes }} 分钟</p>
                <label class="text-sm"><input :checked="monitor.enabled" type="checkbox" @change="toggleMonitor(monitor, ($event.target as HTMLInputElement).checked)" /> 启用</label>
                <p class="truncate text-xs" :class="monitor.lastError ? 'text-red-600' : 'text-slate-500'" :title="monitor.lastError || monitor.prompt">{{ monitor.lastError || monitor.prompt }}</p>
                <div class="flex gap-2">
                  <button class="link" @click="runMonitor(monitor)">测试</button>
                  <button class="link" @click="openMonitorDialog(monitor)">编辑</button>
                  <button class="link text-red-600" @click="deleteMonitor(monitor.id)">删除</button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </section>
    </main>

    <div v-if="serviceDialog" class="modal" @click.self="serviceDialog = false">
      <div class="modal-panel">
        <CardTitle :title="serviceDraft.id ? '编辑 AI 服务' : '添加 AI 服务'" description="地址应为完整的 Chat Completions API URL。" />
        <div class="mt-5 space-y-4">
          <Field label="名称"><input v-model="serviceDraft.name" class="input" placeholder="例如 OpenAI" /></Field>
          <Field label="API 地址"><input v-model="serviceDraft.endpoint" class="input" placeholder="https://api.openai.com/v1/chat/completions" /></Field>
          <Field label="API Key"><input v-model="serviceDraft.apiKey" type="password" class="input" :placeholder="serviceDraft.apiKeyConfigured ? '已配置；留空表示保留' : 'sk-...'" /></Field>
          <Field label="模型列表"><textarea v-model="serviceDraft.modelsText" class="input min-h-24" placeholder="gpt-5-mini&#10;gpt-5.1" /></Field>
        </div>
        <div class="mt-6 flex justify-end gap-3"><button class="button-secondary" @click="serviceDialog = false">取消</button><button class="button-primary" @click="saveServiceDraft">保存</button></div>
      </div>
    </div>

    <div v-if="monitorDialog" class="modal" @click.self="monitorDialog = false">
      <div class="modal-panel">
        <CardTitle :title="monitorDraft.id ? '编辑监控' : '添加监控'" description="Prompt 应说明什么内容需要通知，以及希望收到怎样的摘要。" />
        <div class="mt-5 space-y-4">
          <Field label="名称"><input v-model="monitorDraft.name" class="input" placeholder="Codex 重置提醒" /></Field>
          <Field label="X 用户名"><input v-model="monitorDraft.username" class="input" placeholder="tibo_maker" /></Field>
          <Field label="检查间隔（分钟）"><input v-model.number="monitorDraft.intervalMinutes" type="number" min="1" max="1440" class="input" /></Field>
          <Field label="AI 判断 Prompt"><textarea v-model="monitorDraft.prompt" class="input min-h-32" placeholder="当帖子提到 Codex 使用额度重置的具体时间时通知我，并总结重置时间。" /></Field>
          <label class="flex gap-2 text-sm"><input v-model="monitorDraft.enabled" type="checkbox" /> 启用</label>
        </div>
        <div class="mt-6 flex justify-end gap-3"><button class="button-secondary" @click="monitorDialog = false">取消</button><button class="button-primary" @click="saveMonitorDraft">保存</button></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref } from "vue";
import type {
  AIServiceConfig,
  HealthResponse,
  InteractionPrompt,
  Monitor,
  MonitorTestResult,
  ServerSettings,
  ServerSettingsPatch,
} from "@fast-social/contracts";
import { requestLocalService } from "../../common/local-service";
import { RuntimeMessageTypeEnum, sendRuntimeMessage } from "../../common/runtime-message";
import {
  config,
  getDeeplApiKey,
  initConfig,
  onInput,
  setDeeplApiKey,
} from "../../common/storage-config";

const PageTitle = defineComponent({
  props: { title: String, description: String },
  setup: (props) => () => h("div", { class: "mb-6" }, [h("h2", { class: "text-3xl font-bold" }, props.title), h("p", { class: "mt-1 text-slate-600" }, props.description)]),
});
const CardTitle = defineComponent({
  props: { title: String, description: String },
  setup: (props) => () => h("div", [h("h3", { class: "text-lg font-semibold" }, props.title), h("p", { class: "mt-1 text-sm text-slate-500" }, props.description)]),
});
const Field = defineComponent({
  props: { label: String },
  setup: (props, { slots }) => () => h("label", { class: "block" }, [h("span", { class: "mb-2 block text-sm font-medium text-slate-700" }, props.label), slots.default?.()]),
});

type Menu = "translation" | "service";
type Notice = { type: "success" | "error"; text: string };
type AIOption = { value: string; label: string };
type ServiceDraft = {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  modelsText: string;
  enabled: boolean;
};
type MonitorDraft = {
  id: string;
  name: string;
  username: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
};

const menuItems: Array<{ key: Menu; label: string }> = [
  { key: "translation", label: "基础翻译" },
  { key: "service", label: "监控服务" },
];
const currentMenu = ref<Menu>("translation");
const loading = ref(false);
const saving = ref(false);
const online = ref(false);
const health = ref<HealthResponse | null>(null);
const settings = ref<ServerSettings | null>(null);
const monitors = ref<Monitor[]>([]);
const notice = ref<Notice | null>(null);
const testUsername = ref("");
const secretDraft = ref({ xCookie: "", telegramToken: "" });
const serviceDialog = ref(false);
const monitorDialog = ref(false);
const serviceDraft = ref<ServiceDraft>(emptyServiceDraft());
const monitorDraft = ref<MonitorDraft>(emptyMonitorDraft());

const aiOptions = computed<AIOption[]>(() =>
  (settings.value?.ai.services ?? []).flatMap((service) =>
    service.enabled
      ? service.models.map((model) => ({ value: `${service.id}:${model.name}`, label: `${service.name} / ${model.name}` }))
      : [],
  ),
);

onMounted(async () => {
  await initConfig();
  await refreshService();
});

async function refreshService() {
  loading.value = true;
  try {
    health.value = await requestLocalService<HealthResponse>("/health");
    online.value = true;
    await Promise.all([loadSettings(), loadMonitors()]);
  } catch (error) {
    online.value = false;
    health.value = null;
    settings.value = null;
    monitors.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadSettings() {
  settings.value = await requestLocalService<ServerSettings>("/api/settings");
  secretDraft.value = { xCookie: "", telegramToken: "" };
}

async function loadMonitors() {
  monitors.value = await requestLocalService<Monitor[]>("/api/monitors");
}

async function saveServerSettings(showSuccess = true): Promise<boolean> {
  if (!settings.value) return false;
  saving.value = true;
  const patch: ServerSettingsPatch = {
    ai: {
      defaultProvider: settings.value.ai.defaultProvider,
      services: settings.value.ai.services.map((service) => ({
        id: service.id,
        name: service.name,
        endpoint: service.endpoint,
        enabled: service.enabled,
        models: service.models,
        ...(service.apiKey ? { apiKey: service.apiKey } : {}),
      })),
    },
    interactionPrompts: settings.value.interactionPrompts,
    x: secretDraft.value.xCookie ? { cookie: secretDraft.value.xCookie } : {},
    telegram: {
      chatId: settings.value.telegram.chatId,
      ...(secretDraft.value.telegramToken ? { botToken: secretDraft.value.telegramToken } : {}),
    },
  };
  try {
    settings.value = await requestLocalService<ServerSettings>("/api/settings", { method: "PUT", body: patch });
    secretDraft.value = { xCookie: "", telegramToken: "" };
    await sendRuntimeMessage({ type: RuntimeMessageTypeEnum.CONFIG_UPDATE });
    if (showSuccess) showNotice("服务配置已保存");
    return true;
  } catch (error) {
    showError(error);
    return false;
  } finally {
    saving.value = false;
  }
}

function openServiceDialog(service?: AIServiceConfig) {
  serviceDraft.value = service
    ? {
        id: service.id,
        name: service.name,
        endpoint: service.endpoint,
        apiKey: "",
        apiKeyConfigured: Boolean(service.apiKeyConfigured),
        modelsText: service.models.map((model) => model.name).join("\n"),
        enabled: service.enabled,
      }
    : emptyServiceDraft();
  serviceDialog.value = true;
}

function saveServiceDraft() {
  if (!settings.value) return;
  const draft = serviceDraft.value;
  const models = draft.modelsText.split(/[\n,]/).map((name) => name.trim()).filter(Boolean).map((name) => ({ name }));
  if (!draft.name.trim() || !draft.endpoint.trim() || models.length === 0) {
    showNotice("请填写服务名称、API 地址和至少一个模型", "error");
    return;
  }
  const service: AIServiceConfig = {
    id: draft.id || crypto.randomUUID(),
    name: draft.name.trim(),
    endpoint: draft.endpoint.trim(),
    enabled: draft.enabled,
    models,
    ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
    ...(draft.apiKeyConfigured ? { apiKeyConfigured: true } : {}),
  };
  const index = settings.value.ai.services.findIndex((item) => item.id === service.id);
  if (index >= 0) settings.value.ai.services[index] = service;
  else settings.value.ai.services.push(service);
  serviceDialog.value = false;
}

function removeService(id: string) {
  if (!settings.value) return;
  settings.value.ai.services = settings.value.ai.services.filter((service) => service.id !== id);
  if (settings.value.ai.defaultProvider.startsWith(`${id}:`)) settings.value.ai.defaultProvider = "";
}

function addPrompt() {
  settings.value?.interactionPrompts.push({
    id: crypto.randomUUID(),
    name: "新 Prompt",
    scene: "post",
    prompt: "",
    enabled: true,
  });
}

function removePrompt(id: string) {
  if (settings.value) settings.value.interactionPrompts = settings.value.interactionPrompts.filter((prompt) => prompt.id !== id);
}

function openMonitorDialog(monitor?: Monitor) {
  monitorDraft.value = monitor
    ? { id: monitor.id, name: monitor.name, username: monitor.username, prompt: monitor.prompt, intervalMinutes: monitor.intervalMinutes, enabled: monitor.enabled }
    : emptyMonitorDraft();
  monitorDialog.value = true;
}

async function saveMonitorDraft() {
  const input = monitorDraft.value;
  if (!input.name.trim() || !input.username.trim() || !input.prompt.trim()) {
    showNotice("请填写监控名称、用户名和判断 Prompt", "error");
    return;
  }
  try {
    await requestLocalService<Monitor>(input.id ? `/api/monitors/${input.id}` : "/api/monitors", {
      method: input.id ? "PUT" : "POST",
      body: { name: input.name, username: input.username, prompt: input.prompt, intervalMinutes: input.intervalMinutes, enabled: input.enabled },
    });
    monitorDialog.value = false;
    await loadMonitors();
    showNotice("监控规则已保存");
  } catch (error) {
    showError(error);
  }
}

async function toggleMonitor(monitor: Monitor, enabled: boolean) {
  try {
    await requestLocalService(`/api/monitors/${monitor.id}`, { method: "PUT", body: { enabled } });
    monitor.enabled = enabled;
  } catch (error) {
    showError(error);
  }
}

async function deleteMonitor(id: string) {
  if (!confirm("确定删除这条监控规则？")) return;
  try {
    await requestLocalService(`/api/monitors/${id}`, { method: "DELETE" });
    await loadMonitors();
  } catch (error) {
    showError(error);
  }
}

async function runMonitor(monitor: Monitor) {
  try {
    const result = await requestLocalService<MonitorTestResult>(`/api/monitors/${monitor.id}/run`, { method: "POST" });
    showNotice(`${result.evaluation.matched ? "命中" : "未命中"}：${result.evaluation.message || result.post.text}`);
  } catch (error) {
    showError(error);
  }
}

async function testX() {
  if (!testUsername.value.trim()) return showNotice("请先填写测试用户名", "error");
  try {
    if (!(await saveServerSettings(false))) return;
    const result = await requestLocalService<{ posts: Array<{ text: string }> }>("/api/test/x", { method: "POST", body: { username: testUsername.value } });
    showNotice(result.posts[0] ? `读取成功：${result.posts[0].text.slice(0, 100)}` : "读取成功，但没有找到帖子");
  } catch (error) { showError(error); }
}

async function testAI() {
  try {
    if (!(await saveServerSettings(false))) return;
    const result = await requestLocalService<{ content: string }>("/api/test/ai", { method: "POST", body: { provider: settings.value?.ai.defaultProvider } });
    showNotice(`AI 返回：${result.content}`);
  } catch (error) { showError(error); }
}

async function testTelegram() {
  try {
    if (!(await saveServerSettings(false))) return;
    await requestLocalService("/api/test/telegram", { method: "POST" });
    showNotice("Telegram 测试消息已发送");
  } catch (error) { showError(error); }
}

function emptyServiceDraft(): ServiceDraft {
  return { id: "", name: "", endpoint: "", apiKey: "", apiKeyConfigured: false, modelsText: "", enabled: true };
}

function emptyMonitorDraft(): MonitorDraft {
  return { id: "", name: "", username: "", prompt: "", intervalMinutes: 10, enabled: true };
}

function showNotice(text: string, type: Notice["type"] = "success") {
  notice.value = { type, text };
  window.setTimeout(() => { if (notice.value?.text === text) notice.value = null; }, 6000);
}

function showError(error: unknown) {
  showNotice(error instanceof Error ? error.message : String(error), "error");
}
</script>

<style scoped>
.card { @apply rounded-xl border border-slate-200 bg-white p-6 shadow-sm; }
.input { @apply w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100; }
.button-primary { @apply rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50; }
.button-secondary { @apply rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50; }
.link { @apply rounded px-2 py-1 text-sm text-blue-600 hover:bg-slate-50; }
.empty { @apply rounded-lg border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500; }
.modal { @apply fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6; }
.modal-panel { @apply max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-6 shadow-2xl; }
</style>
