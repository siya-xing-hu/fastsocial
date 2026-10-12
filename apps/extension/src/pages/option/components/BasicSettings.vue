<template>
  <section
    class="settings-page space-y-4"
    aria-labelledby="basic-settings-title"
  >
    <header
      class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div>
        <h2
          id="basic-settings-title"
          class="text-2xl font-semibold tracking-tight text-slate-900"
        >
          插件设置
        </h2>
      </div>

      <div class="flex shrink-0 items-center gap-3">
        <div
          class="inline-flex rounded-lg bg-slate-100 p-1"
          role="group"
          aria-label="配置编辑方式"
        >
          <button data-ui="choice" :title="mode === 'form' ? '表单编辑' : 'JSON 编辑'"
            v-for="mode in (['form', 'json'] as const)"
            :key="mode"
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait"
            :class="
              editMode === mode
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            "
            :aria-pressed="editMode === mode"
            :disabled="jsonSaving"
            @click="switchMode(mode)"
          >
            {{ mode === "form" ? "Form" : "JSON" }}
          </button>
        </div>
        <div
          class="inline-flex h-8 w-3 shrink-0 items-center justify-center"
          :title="saveIndicatorText"
          role="status"
          aria-live="polite"
        >
          <span
            class="h-1.5 w-1.5 rounded-full transition-colors"
            :class="saveIndicatorDotClasses"
            aria-hidden="true"
          />
          <span class="sr-only">{{ saveIndicatorText }}</span>
        </div>
      </div>
    </header>

    <template v-if="editMode === 'form'">
      <article class="panel">
        <div class="panel-heading">
          翻译偏好 <span class="muted">浏览器保存</span>
        </div>
        <div class="panel-body">
          <div class="flex items-center justify-between gap-4 mb-5"
            ><span
              ><strong class="text-sm">自动翻译 · 本地默认</strong
              ><span class="muted block mt-1"
                >服务离线时，所有账号统一使用此开关。</span
              ></span
            ><ToggleSwitch
              :model-value="config.basic.autoTranslate"
              label="离线时默认自动翻译"
              @update:model-value="changeAutoTranslate"
          /></div>
          <div class="translation-fields">
            <label class="field"
              >翻译渠道<select
                :value="config.basic.translateProvider"
                class="input"
                @change="changeTranslateProvider"
              >
                <option :value="TranslateChannelEnum.AUTO">
                  自动 · Google 优先
                </option>
                <option :value="TranslateChannelEnum.GOOGLE">Google</option>
                <option :value="TranslateChannelEnum.DEEPL">DeepL</option>
                <option
                  :value="TranslateChannelEnum.AI"
                  :disabled="!aiTranslationAvailable"
                >
                  {{ aiOptionLabel }}
                </option>
              </select></label
            >
            <label class="field"
              >目标语言（_tl_）<select
                v-model="config.basic.targetLang"
                class="input"
                @change="saveConfigChange"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select></label
            >
            <div class="field"><span>AI 翻译</span>
              <div class="flex min-h-9 items-center justify-between gap-2">
                <span class="text-sm text-slate-700">{{ config.translationService.translatePrompt === DEFAULT_TRANSLATE_PROMPT ? '默认翻译指令' : '自定义翻译指令' }}</span>
                <ActionButton action="edit" label="编辑 AI 翻译指令" @click="editTranslation" />
              </div>
            </div>
          </div>
        </div>
      </article>
      <article class="panel">
        <div class="panel-heading">
          DeepL 备用翻译 <span class="muted">浏览器保存</span>
        </div>
        <div class="panel-body">
          <div class="translation-fields">
            <label class="field"
              >API 类型<select
                v-model="config.translationService.deeplApiEndpoint"
                class="input"
                @change="saveConfigChange"
              >
                <option value="https://api-free.deepl.com/v2/translate">
                  API Free
                </option>
                <option value="https://api.deepl.com/v2/translate">
                  Developer / Growth
                </option>
              </select></label
            >
            <label class="field"
              >备用时长（分钟）<input
                v-model.number="
                  config.translationService.fallbackDurationMinutes
                "
                class="input"
                type="number"
                min="1"
                step="1"
                @change="saveConfigChange"
            /></label>
            <label class="field"
              >API Key<input
                class="input"
                type="password"
                :value="getDeeplApiKey()"
                autocomplete="off"
                placeholder="输入 DeepL API Key"
                @input="
                  saveDeeplApiKey(($event.target as HTMLInputElement).value)
                "
            /></label>
          </div>
          <p class="muted mt-3">Google 失败后使用 DeepL，到期再尝试 Google。</p>
        </div>
      </article>
    </template>

    <div v-else>
      <div class="relative">
        <ActionButton action="copy" label="复制 JSON" class="absolute right-3 top-3 z-10" :disabled="jsonSaving" @click="copyJson" />
        <label for="basic-config-json" class="sr-only">插件基础配置 JSON</label>
        <textarea
          id="basic-config-json"
          ref="jsonEditor"
          v-model="jsonDraft"
          class="field-input json-input min-h-[28rem] resize-y font-mono text-[13px] leading-6"
          :class="
            jsonError
              ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
              : ''
          "
          :disabled="jsonSaving"
          :aria-invalid="Boolean(jsonError)"
          :aria-describedby="jsonError ? 'config-json-error' : undefined"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          @input="jsonError = ''"
        />
      </div>
      <p
        v-if="jsonError"
        id="config-json-error"
        class="mt-2 text-sm text-red-700"
        role="alert"
      >
        {{ jsonError }}
      </p>
      <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
        <ActionButton action="format" label="格式化 JSON" :disabled="jsonSaving" @click="formatJson" />
        <ActionButton action="reset" label="还原当前配置" :disabled="jsonSaving || !jsonDirty" @click="resetJson" />
        <ActionButton action="save" label="保存 JSON 配置" :disabled="jsonSaving || !jsonDirty" @click="saveJson" :loading="jsonSaving" />
      </div>
    </div>
    <OptionDialog :open="translationOpen" title="AI 翻译指令" @close="translationOpen = false">
      <label class="settings-page field">翻译指令<textarea v-model="translationDraft" class="input" rows="7" /></label>
      <template #footer><div class="settings-page toolbar justify-end"><ActionButton action="reset" label="恢复默认翻译指令" class="mr-auto" @click="translationDraft = DEFAULT_TRANSLATE_PROMPT" /><ActionButton action="cancel" label="取消" @click="translationOpen = false" /><ActionButton action="save" label="保存翻译指令" :disabled="!translationDraft.trim()" @click="saveTranslation" /></div></template>
    </OptionDialog>
  </section>
</template>

<script setup lang="ts">
import ActionButton from "../../../components/ui/ActionButton.vue";
import { confirmOperation } from '../../../components/ui/confirm-operation';
import { computed, onBeforeUnmount, ref } from "vue";
import OptionDialog from "./OptionDialog.vue";
import ToggleSwitch from "../../../components/ui/ToggleSwitch.vue";
import {
  ConfigJsonError,
  parseBasicSettingsJson,
  serializeBasicSettings,
} from "../../../common/config-transfer";
import {
  DEFAULT_TRANSLATE_PROMPT,
  TranslateChannelEnum,
  apiKeys,
  config,
  getDeeplApiKey,
  importConfigJson,
  onInput,
  setDeeplApiKey,
} from "../../../common/storage-config";
import { useServerAdminContext } from "../use-server-admin";

type SaveState = "idle" | "saving" | "saved";

const saveState = ref<SaveState>("idle");
let savedTimer: number | undefined;
let idleTimer: number | undefined;
const { online, settings, showNotice } = useServerAdminContext();
const editMode = ref<"form" | "json">("form");
const jsonDraft = ref("");
const jsonError = ref("");
const jsonSaving = ref(false);
const jsonEditor = ref<HTMLTextAreaElement>();
const currentJson = computed(() =>
  serializeBasicSettings({ config: config.value, apiKeys: apiKeys.value })
);
const jsonDirty = computed(() => jsonDraft.value !== currentJson.value);

async function switchMode(mode: "form" | "json") {
  if (mode === editMode.value || jsonSaving.value) return;
  if (mode === "json") resetJson();
  else if (jsonDirty.value && !(await saveJson())) return;
  editMode.value = mode;
}

function resetJson() {
  jsonDraft.value = currentJson.value;
  jsonError.value = "";
}

function formatJson(): boolean {
  try {
    jsonDraft.value = serializeBasicSettings(
      parseBasicSettingsJson(jsonDraft.value)
    );
    jsonError.value = "";
    return true;
  } catch (error) {
    jsonError.value = (error as Error).message;
    return false;
  }
}

async function copyJson() {
  if (!formatJson()) return;
  try {
    await navigator.clipboard.writeText(jsonDraft.value);
    showNotice("JSON 已复制");
  } catch {
    jsonEditor.value?.focus();
    jsonEditor.value?.select();
    showNotice("无法自动复制，已选中 JSON，请手动复制", "warning");
  }
}

async function saveJson(): Promise<boolean> {
  if (jsonSaving.value) return false;
  jsonSaving.value = true;
  jsonError.value = "";
  try {
    const next = parseBasicSettingsJson(jsonDraft.value);
    if (next.config.basic.translateProvider === TranslateChannelEnum.AI && !await confirmOperation({title: '确认应用 AI 翻译配置', message: '保存后，已启用自动翻译的账号或页面会按此配置调用 AI 翻译。是否继续？'})) return false;
    const notified = await importConfigJson(jsonDraft.value);
    resetJson();
    showNotice(
      notified ? "基础配置已保存" : "基础配置已保存，刷新已打开的网页后生效",
      notified ? "success" : "warning"
    );
    return true;
  } catch (error) {
    jsonError.value =
      error instanceof ConfigJsonError
        ? error.message
        : "保存失败，原配置未被替换。请重试。";
    return false;
  } finally {
    jsonSaving.value = false;
  }
}

const aiTranslationSelection = computed(() => {
  if (!online.value || !settings.value?.ai.defaultProvider) return null;

  const defaultProvider = settings.value.ai.defaultProvider;
  for (const service of settings.value.ai.services) {
    if (!service.enabled || !service.apiKeyConfigured) continue;
    const model = service.models.find(
      (item) => `${service.id}:${item.name}` === defaultProvider
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

const aiTranslationAvailable = computed(
  () => aiTranslationSelection.value !== null
);
const aiOptionLabel = computed(() =>
  aiTranslationSelection.value
    ? `AI（${aiTranslationSelection.value.label}）`
    : "AI（需要可用的默认模型）"
);

const saveIndicatorText = computed(() => {
  if (editMode.value === "json") {
    if (jsonSaving.value) return "正在保存…";
    if (jsonError.value) return "请检查配置";
    return jsonDirty.value ? "有未保存的修改" : "当前配置";
  }
  if (saveState.value === "saving") return "正在自动保存…";
  if (saveState.value === "saved") return "已自动保存";
  return "修改后自动保存";
});

const saveIndicatorDotClasses = computed(() =>
  editMode.value === "json"
    ? jsonError.value
      ? "bg-red-500"
      : jsonSaving.value
      ? "bg-blue-500"
      : jsonDirty.value
      ? "bg-amber-500"
      : "bg-slate-300"
    : saveState.value === "saved"
    ? "bg-emerald-500"
    : saveState.value === "saving"
    ? "bg-blue-500"
    : "bg-slate-300"
);

onBeforeUnmount(() => {
  window.clearTimeout(savedTimer);
  window.clearTimeout(idleTimer);
});

function saveConfigChange() {
  onInput();
  showSavingState();
}
async function changeAutoTranslate(enabled: boolean) {
  if (enabled && config.value.basic.translateProvider === TranslateChannelEnum.AI && !await confirmOperation({title: '确认启用 AI 自动翻译', message: '启用后，将自动读取页面文本并调用 AI 翻译，持续消耗 AI 用量。是否继续？'})) return;
  config.value.basic.autoTranslate = enabled; saveConfigChange();
}
async function changeTranslateProvider(event: Event) {
  const select = event.target as HTMLSelectElement;
  const provider = select.value as TranslateChannelEnum;
  if (provider === TranslateChannelEnum.AI && !await confirmOperation({title: '确认使用 AI 翻译', message: '切换后，已启用自动翻译的账号或页面会调用 AI 翻译，持续消耗 AI 用量。是否继续？'})) { select.value = config.value.basic.translateProvider; return; }
  config.value.basic.translateProvider = provider; saveConfigChange();
}

function saveDeeplApiKey(key: string) {
  setDeeplApiKey(key);
  showSavingState();
}

const translationOpen = ref(false), translationDraft = ref('');
function editTranslation() { translationDraft.value = config.value.translationService.translatePrompt || DEFAULT_TRANSLATE_PROMPT; translationOpen.value = true; }
function saveTranslation() {
  if (!translationDraft.value.trim()) return;
  config.value.translationService.translatePrompt = translationDraft.value.trim();
  config.value.translationService.promptId = '';
  config.value.translationService.promptName = '';
  saveConfigChange(); translationOpen.value = false;
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
.translation-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 16px;
}
@media (max-width: 800px) {
  .translation-fields {
    grid-template-columns: 1fr;
  }
}

.field-label {
  @apply mb-2 block text-sm font-medium text-slate-700;
}

.field-input {
  @apply w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100;
}

.json-input {
  @apply rounded-xl pt-12;
}
</style>
