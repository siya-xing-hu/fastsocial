<template>
  <section class="space-y-6" aria-labelledby="basic-settings-title">
    <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 id="basic-settings-title" class="text-2xl font-semibold tracking-tight text-slate-900">
          插件基础设置
        </h2>
        <p class="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">
          翻译配置保存在浏览器插件中。即使本地服务未启动，Google 和 DeepL 仍可正常使用。
        </p>
      </div>

      <div
        class="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
        :class="saveIndicatorClasses"
        role="status"
        aria-live="polite"
      >
        <span class="h-1.5 w-1.5 rounded-full" :class="saveIndicatorDotClasses" />
        {{ saveIndicatorText }}
      </div>
    </header>

    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-100 px-6 py-5">
        <h3 class="text-base font-semibold text-slate-900">翻译偏好</h3>
        <p class="mt-1 text-sm text-slate-500">选择日常使用的翻译方式和默认目标语言。</p>
      </div>

      <div class="grid gap-6 p-6 md:grid-cols-2">
        <label class="block">
          <span class="field-label">翻译服务</span>
          <select
            v-model="config.basic.translateProvider"
            class="field-input"
            @change="saveConfigChange"
          >
            <option :value="TranslateChannelEnum.AUTO">自动（Google 优先）</option>
            <option :value="TranslateChannelEnum.GOOGLE">Google</option>
            <option :value="TranslateChannelEnum.DEEPL">DeepL</option>
            <option
              :value="TranslateChannelEnum.AI"
              :disabled="!aiTranslationAvailable"
            >
              {{ aiOptionLabel }}
            </option>
          </select>
          <span class="field-help">
            {{ providerDescription }}
          </span>
          <span
            class="mt-2 flex items-start gap-1.5 text-xs leading-5"
            :class="aiTranslationAvailable ? 'text-emerald-700' : 'text-amber-700'"
          >
            <span
              class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              :class="aiTranslationAvailable ? 'bg-emerald-500' : 'bg-amber-400'"
            />
            <span>
              {{ aiAvailabilityText }}
              <a
                v-if="!aiTranslationAvailable"
                href="#server/ai"
                class="ml-1 font-semibold underline decoration-current/30 underline-offset-2 hover:decoration-current"
              >配置 AI 服务</a>
            </span>
          </span>
        </label>

        <label class="block">
          <span class="field-label">目标语言</span>
          <select
            v-model="config.basic.targetLang"
            class="field-input"
            @change="saveConfigChange"
          >
            <option value="zh-CN">中文</option>
            <option value="en">英文</option>
          </select>
          <span class="field-help">翻译结果默认输出的语言。</span>
        </label>

        <label class="md:col-span-2 flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3.5 transition hover:border-slate-300">
          <span>
            <span class="block text-sm font-medium text-slate-800">自动翻译 X 帖子</span>
            <span class="mt-1 block text-xs leading-5 text-slate-500">浏览 X 时自动展示译文，无需逐条点击翻译。</span>
          </span>
          <input
            v-model="config.basic.autoTranslate"
            type="checkbox"
            class="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            @change="saveConfigChange"
          />
        </label>
      </div>
    </div>

    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div class="flex flex-col gap-2 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 class="text-base font-semibold text-slate-900">DeepL 备用翻译</h3>
          <p class="mt-1 text-sm text-slate-500">可直接使用 DeepL，也可在自动模式下作为 Google 的备用服务。</p>
        </div>
        <span class="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">仅保存在插件中</span>
      </div>

      <div class="grid gap-6 p-6 md:grid-cols-2">
        <label class="block">
          <span class="field-label">API 类型</span>
          <select
            v-model="config.translationService.deeplApiEndpoint"
            class="field-input"
            @change="saveConfigChange"
          >
            <option value="https://api.deepl.com/v2/translate">Developer / Growth</option>
            <option value="https://api-free.deepl.com/v2/translate">API Free</option>
          </select>
          <span class="field-help">请与 DeepL 账户中的订阅类型保持一致。</span>
        </label>

        <label class="block">
          <span class="field-label">API Key</span>
          <input
            type="password"
            class="field-input"
            :value="getDeeplApiKey()"
            autocomplete="off"
            placeholder="输入 DeepL API Key"
            @input="saveDeeplApiKey(($event.target as HTMLInputElement).value)"
          />
          <span class="field-help">Key 只写入当前浏览器的扩展存储。</span>
        </label>

        <label class="block md:col-span-2 md:max-w-sm">
          <span class="field-label">Google 失败后使用 DeepL</span>
          <div class="relative">
            <input
              v-model.number="config.translationService.fallbackDurationMinutes"
              type="number"
              min="1"
              step="1"
              class="field-input pr-16"
              @input="saveConfigChange"
            />
            <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-400">分钟</span>
          </div>
          <span class="field-help">自动模式检测到 Google 暂时不可用后，在这段时间内直接使用 DeepL。</span>
        </label>
      </div>
    </div>

    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div class="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-base font-semibold text-slate-900">AI 翻译</h3>
            <span class="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">需要本地服务</span>
          </div>
          <p class="mt-1 text-sm text-slate-500">选择 AI 翻译时使用此 Prompt；服务离线时会自动降级到 Google / DeepL。</p>
        </div>
        <button
          type="button"
          class="w-fit rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          @click="restoreDefaultPrompt"
        >
          恢复默认 Prompt
        </button>
      </div>

      <div class="p-6">
        <label class="block">
          <span class="field-label">AI 翻译 Prompt</span>
          <textarea
            v-model="config.translationService.translatePrompt"
            class="field-input min-h-36 resize-y leading-6"
            placeholder="留空则使用内置翻译 Prompt"
            @input="saveConfigChange"
          />
          <span class="field-help">可使用 <code>{userContent}</code> 表示原文，使用 <code>{targetLang}</code> 表示目标语言。</span>
        </label>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import {
  DEFAULT_TRANSLATE_PROMPT,
  TranslateChannelEnum,
  config,
  getDeeplApiKey,
  onInput,
  setDeeplApiKey,
} from "../../../common/storage-config";
import { useServerAdminContext } from "../use-server-admin";

type SaveState = "idle" | "saving" | "saved";

const saveState = ref<SaveState>("idle");
let savedTimer: number | undefined;
let idleTimer: number | undefined;
const { online, settings } = useServerAdminContext();

const aiTranslationSelection = computed(() => {
  if (!online.value || !settings.value?.ai.defaultProvider) return null;

  const defaultProvider = settings.value.ai.defaultProvider;
  for (const service of settings.value.ai.services) {
    if (!service.enabled || !service.apiKeyConfigured) continue;
    const model = service.models.find(
      (item) => `${service.id}:${item.name}` === defaultProvider,
    );
    if (model) {
      return {
        value: defaultProvider,
        label: `${service.name} / ${model.name}`,
      };
    }
  }
  return null;
});

const aiTranslationAvailable = computed(() => aiTranslationSelection.value !== null);
const aiOptionLabel = computed(() =>
  aiTranslationSelection.value
    ? `AI（${aiTranslationSelection.value.label}）`
    : "AI（需要可用的默认模型）",
);
const aiAvailabilityText = computed(() => {
  if (aiTranslationSelection.value) {
    return `AI 翻译将使用 ${aiTranslationSelection.value.label}`;
  }
  return online.value
    ? "AI 翻译暂不可选：请启用已配置 API Key 的服务并选择默认模型。"
    : "AI 翻译暂不可选：本地服务当前离线。";
});

const saveIndicatorText = computed(() => {
  if (saveState.value === "saving") return "正在自动保存…";
  if (saveState.value === "saved") return "已自动保存";
  return "修改后自动保存";
});

const saveIndicatorClasses = computed(() =>
  saveState.value === "saved"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-white text-slate-500",
);

const saveIndicatorDotClasses = computed(() =>
  saveState.value === "saved" ? "bg-emerald-500" : saveState.value === "saving" ? "bg-blue-500" : "bg-slate-300",
);

const providerDescription = computed(() => {
  switch (config.value.basic.translateProvider) {
    case TranslateChannelEnum.AUTO:
      return "优先使用 Google；Google 不可用时切换到 DeepL（需要 API Key），不会隐式调用 AI。";
    case TranslateChannelEnum.GOOGLE:
      return "直接使用 Google 翻译，无需额外配置。";
    case TranslateChannelEnum.DEEPL:
      return "直接使用 DeepL，需要在下方配置 API Key。";
    case TranslateChannelEnum.AI:
      return aiTranslationSelection.value
        ? `使用 ${aiTranslationSelection.value.label}；请求失败时自动回退到 Google / DeepL。`
        : "AI 不可用时会自动回退到 Google / DeepL。";
    default:
      return "选择插件翻译内容时使用的服务。";
  }
});

onBeforeUnmount(() => {
  window.clearTimeout(savedTimer);
  window.clearTimeout(idleTimer);
});

function saveConfigChange() {
  onInput();
  showSavingState();
}

function saveDeeplApiKey(key: string) {
  setDeeplApiKey(key);
  showSavingState();
}

function restoreDefaultPrompt() {
  config.value.translationService.translatePrompt = DEFAULT_TRANSLATE_PROMPT;
  saveConfigChange();
}

function showSavingState() {
  saveState.value = "saving";
  window.clearTimeout(savedTimer);
  window.clearTimeout(idleTimer);
  savedTimer = window.setTimeout(() => {
    saveState.value = "saved";
    idleTimer = window.setTimeout(() => {
      saveState.value = "idle";
    }, 1800);
  }, 700);
}
</script>

<style scoped>
.field-label {
  @apply mb-2 block text-sm font-medium text-slate-700;
}

.field-input {
  @apply w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100;
}

.field-help {
  @apply mt-2 block text-xs leading-5 text-slate-500;
}

.field-help code {
  @apply rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700;
}
</style>
