<template>
  <section aria-labelledby="ai-services-title">
    <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 id="ai-services-title" class="text-2xl font-semibold tracking-tight text-slate-900">AI 服务</h2>
        <p class="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">集中维护 API 地址、模型和 Key；监听与插件 AI 能力统一使用这里的配置。</p>
      </div>
      <ActionButton action="add" label="添加 AI 服务" :disabled="!settings || busyAction !== null" @click="openDialog()" />
    </header>

    <div class="mt-5 flex gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs leading-5 text-blue-800">
      <Info class="mt-0.5 h-4 w-4 shrink-0" />
      <p>先添加服务并保存，再选择默认模型进行测试。同一服务 ID 的新配置会直接覆盖旧配置。</p>
    </div>

    <div v-if="!settings" class="error-card mt-5">{{ settingsError || 'AI 配置暂时不可用，请刷新后重试。' }}</div>

    <template v-else>
      <div v-if="settings.ai.services.length === 0" class="mt-5 grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
        <div>
          <Bot class="mx-auto h-7 w-7 text-slate-400" />
          <p class="mt-3 text-sm font-medium text-slate-700">还没有 AI 服务</p>
          <p class="mt-1 text-xs text-slate-500">添加一个 OpenAI 或 Anthropic 兼容服务后即可配置监听。</p>
        </div>
      </div>

      <div v-else class="mt-5 space-y-3">
        <article v-for="service in settings.ai.services" :key="service.id" class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
          <div class="flex flex-col gap-4 md:flex-row md:items-center">
            <div class="flex min-w-0 flex-1 items-start gap-3">
              <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-xs font-bold text-white">AI</span>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="font-semibold text-slate-900">{{ service.name }}</h3>
                  <span v-if="isDefaultService(service.id)" class="status-badge bg-blue-50 text-blue-700">默认</span>
                  <span class="status-badge" :class="service.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'">
                    {{ service.enabled ? '已启用' : '已停用' }}
                  </span>
                  <span class="status-badge bg-violet-50 text-violet-700">
                    {{ AI_API_FORMAT_DETAILS[service.apiFormat ?? 'openai'].label }}
                  </span>
                  <span class="status-badge" :class="service.apiKeyConfigured ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'">
                    {{ service.apiKeyConfigured ? 'Key 已配置' : '缺少 Key' }}
                  </span>
                </div>
                <p class="mt-1 truncate text-xs text-slate-500" :title="service.endpoint">{{ service.endpoint }}</p>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <span v-for="model in service.models" :key="model.name" class="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{{ model.name }}</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 md:justify-end">
              <ToggleSwitch class="mr-1" :model-value="service.enabled" :label="`启用 AI 服务 ${service.name}`" :disabled="busyAction !== null" @update:model-value="toggleService(service, $event)" />
              <ActionButton action="edit" :label="`编辑 ${service.name}`" :disabled="busyAction !== null" @click="openDialog(service)" />
              <ActionButton action="delete" :label="`删除 ${service.name}`" :disabled="busyAction !== null" @click="confirmRemove(service.id)" />
            </div>
          </div>
        </article>
      </div>

      <article class="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label class="block flex-1">
            <span class="field-label">默认服务 / 模型</span>
            <select v-model="settings.ai.defaultProvider" class="field-input" :disabled="busyAction !== null">
              <option value="">请选择默认模型</option>
              <option v-for="option in aiOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <div class="flex gap-2">
            <ActionButton action="save" label="保存默认模型" :disabled="busyAction !== null" @click="saveAI()" :loading="busyAction === 'ai'" />
            <ActionButton action="test" label="测试 AI" :disabled="busyAction !== null || !settings.ai.defaultProvider" @click="testAI" :loading="busyAction === 'test:ai'" />
          </div>
        </div>
      </article>
    </template>

    <OptionDialog
      :open="dialogOpen"
      :title="draft.id ? '编辑 AI 服务' : '添加 AI 服务'"
      description="选择接口格式，并填写对应的完整 API 地址。"
      :close-disabled="busyAction !== null"
      @close="closeDialog"
    >
      <fieldset :disabled="busyAction !== null" class="min-w-0 space-y-4 border-0 p-0 disabled:opacity-70">
        <label class="block"><span class="field-label">服务名称</span><input v-model="draft.name" class="field-input" placeholder="例如 OpenAI" /></label>
        <label class="block">
          <span class="field-label">接口格式</span>
          <select v-model="draft.apiFormat" class="field-input" @change="handleFormatChange">
            <option v-for="(format, value) in AI_API_FORMAT_DETAILS" :key="value" :value="value">{{ format.label }}</option>
          </select>
        </label>
        <label class="block">
          <span class="field-label">API 地址</span>
          <input
            v-model="draft.endpoint"
            class="field-input"
            :placeholder="AI_API_FORMAT_DETAILS[draft.apiFormat].endpoint"
          />
          <span class="field-help">填写完整的 {{ AI_API_FORMAT_DETAILS[draft.apiFormat].apiName }} URL。</span>
          <span v-if="usesLoopbackAddress(draft.endpoint)" class="mt-2 block rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            Fast Social 使用 Docker 时，localhost 会指向容器自身，请改为 host.docker.internal。
          </span>
        </label>
        <label class="block"><span class="field-label">模型列表</span><textarea v-model="draft.modelsText" class="field-input min-h-24 resize-y" placeholder="gpt-5.1&#10;gpt-5-mini" /><span class="field-help">每行一个模型，也可以使用英文逗号分隔。</span></label>
        <label class="block"><span class="field-label">API Key</span><input v-model="draft.apiKey" type="password" class="field-input" autocomplete="off" :placeholder="draft.apiKeyConfigured ? '已配置；留空表示保留' : 'sk-...'" /></label>
        <ToggleSwitch v-model="draft.enabled" label="启用此服务" :disabled="busyAction !== null" />
      </fieldset>
      <template #footer>
        <div class="flex justify-end gap-3">
          <ActionButton action="cancel" label="取消" :disabled="busyAction !== null" @click="closeDialog" />
          <ActionButton action="save" label="保存 AI 服务" :disabled="busyAction !== null" @click="submitDraft" :loading="busyAction === 'ai'" />
        </div>
      </template>
    </OptionDialog>
  </section>
</template>

<script setup lang="ts">
import ActionButton from "../../../../components/ui/ActionButton.vue";
import { confirmOperation } from '../../../../components/ui/confirm-operation';
import { ref } from "vue";
import type { AIServiceConfig } from "@fast-social/contracts";
import { Bot, Info } from "lucide-vue-next";
import OptionDialog from "../OptionDialog.vue";
import ToggleSwitch from "../../../../components/ui/ToggleSwitch.vue";
import {
  AI_API_FORMAT_DETAILS,
  emptyServiceDraft,
  serviceToDraft,
  useServerAdminContext,
} from "../../use-server-admin";

const {
  settings,
  settingsError,
  aiOptions,
  busyAction,
  saveAI,
  testAI,
  saveServiceDraft,
  removeService,
} = useServerAdminContext();

const dialogOpen = ref(false);
const draft = ref(emptyServiceDraft());

function openDialog(service?: AIServiceConfig) {
  draft.value = service ? serviceToDraft(service) : emptyServiceDraft();
  dialogOpen.value = true;
}

function closeDialog() {
  if (busyAction.value === null) dialogOpen.value = false;
}

function handleFormatChange() {
  if (!draft.value.endpoint || Object.values(AI_API_FORMAT_DETAILS).some((format) => format.endpoint === draft.value.endpoint)) {
    draft.value.endpoint = AI_API_FORMAT_DETAILS[draft.value.apiFormat].endpoint;
  }
}

async function submitDraft() {
  if (await saveServiceDraft(draft.value)) dialogOpen.value = false;
}

async function confirmRemove(id: string) {
  if (await confirmOperation({title: '确认删除 AI 服务', message: '确定删除这个 AI 服务？'})) await removeService(id);
}

async function toggleService(service: AIServiceConfig, enabled: boolean) {
  const previous = service.enabled;
  const previousDefaultProvider = settings.value?.ai.defaultProvider ?? "";
  service.enabled = enabled;
  if (!enabled && settings.value?.ai.defaultProvider.startsWith(`${service.id}:`)) {
    settings.value.ai.defaultProvider = "";
  }
  if (!(await saveAI())) {
    service.enabled = previous;
    if (settings.value) settings.value.ai.defaultProvider = previousDefaultProvider;
  }
}

function isDefaultService(id: string): boolean {
  return settings.value?.ai.defaultProvider.startsWith(`${id}:`) ?? false;
}

function usesLoopbackAddress(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
</script>

<style scoped>
.field-label { @apply mb-2 block text-sm font-medium text-slate-700; }
.field-input { @apply w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100; }
.field-help { @apply mt-2 block text-xs leading-5 text-slate-500; }
.status-badge { @apply rounded-full px-2 py-0.5 text-[10px] font-semibold; }
.error-card { @apply rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700; }
</style>
