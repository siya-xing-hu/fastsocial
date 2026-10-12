<template>
  <div class="w-80 min-w-80 box-border bg-gray-200">
    <div class="text-sm bg-white px-5 py-4 rounded-b-xl">
      <div class="flex items-center justify-between border-b border-gray-100 pb-3">
        <span
          class="inline-flex items-center gap-2 text-xs font-medium"
          :class="serviceOnline ? 'text-emerald-700' : 'text-gray-500'"
          role="status"
        >
          <span
            class="h-2 w-2 rounded-full"
            :class="serviceOnline ? 'bg-emerald-500' : 'bg-gray-300'"
          />
          {{ serviceOnline ? '本地服务在线' : '本地服务离线' }}
        </span>
        <div class="flex items-center gap-2"><kbd class="text-xs text-slate-400">⌥ ⇧ F</kbd><ActionButton action="settings" label="打开设置" @click="openOptions" /></div>
      </div>

      <div class="mt-3 flex items-center justify-between gap-2"><span class="text-sm text-slate-700">聊天助手 <kbd class="ml-1 text-xs text-slate-400">⌥ ⇧ S</kbd></span><ActionButton action="chat" label="打开聊天助手" @click="openAssistant" /></div>
      <p v-if="assistantError" class="mt-2 text-xs text-red-600">{{ assistantError }}</p>
      <div class="mt-3 rounded-xl bg-gray-100">
        <div class="flex items-center h-11 pl-4">
          <label class="inline-block text-label mb-0 text-gray-6"
            >翻译服务:</label
          >
          <select
            v-model="config.basic.translateProvider"
            @change="onInput()"
            class="pl-3"
          >
            <option value="auto">自动（Google 优先）</option>
            <option value="google">Google</option>
            <option value="deepl">DeepL</option>
            <option v-if="config.basic.translateProvider === 'ai'" value="ai" disabled>
              AI（请到设置中重新选择）
            </option>
          </select>
        </div>
      </div>

      <div class="mt-3 text-sm px-1 text-gray-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <span class="mb-0 mr-2 shrink-0">离线默认自动翻译</span>
          </div>
          <ToggleSwitch
            id="popup-auto-translate"
            :model-value="config.basic.autoTranslate"
            label="离线默认自动翻译"
            @update:model-value="changeAutoTranslate"
          />
        </div>
      </div>
    </div>

    <footer>
      <div class="px-3 py-2 text-sm flex items-center justify-between">
        <ActionButton action="settings" label="打开设置" @click="openOptions" />
      </div>
    </footer>
  </div>
</template>

<script lang="ts" setup>
import type { HealthResponse } from "@fast-social/contracts";
import { onMounted, ref } from "vue";
import ActionButton from "../../components/ui/ActionButton.vue";
import ToggleSwitch from "../../components/ui/ToggleSwitch.vue";
import { requestLocalService } from "../../common/local-service";
import { config, initConfig, onInput, TranslateChannelEnum } from "../../common/storage-config";
import { confirmOperation } from '../../components/ui/confirm-operation';
import { openAssistantPanel } from "../../assistant/open-panel";

const serviceOnline = ref(false);
const assistantError = ref('');
async function changeAutoTranslate(enabled: boolean) {
  if (enabled && config.value.basic.translateProvider === TranslateChannelEnum.AI && !await confirmOperation({title: '确认启用 AI 自动翻译', message: '启用后，将自动读取页面文本并调用 AI 翻译，持续消耗 AI 用量。是否继续？'})) return;
  config.value.basic.autoTranslate = enabled; onInput();
}
function openAssistant() {
  openAssistantPanel('open').then(() => window.close()).catch(error => { assistantError.value = error.message; });
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

async function checkServiceStatus() {
  try {
    await requestLocalService<HealthResponse>("/health");
    serviceOnline.value = true;
  } catch {
    serviceOnline.value = false;
  }
}

onMounted(() => {
  void Promise.allSettled([
    initConfig(),
    checkServiceStatus(),
  ]);
});
</script>

<style>
.loader {
  right: 40px;
  position: absolute;
  margin-top: -20px;
  display: grid;
}

.check-icon {
  scale: 0.4;
  right: 0;
  position: absolute;
  margin-top: -55px;
  display: grid;
}
</style>
