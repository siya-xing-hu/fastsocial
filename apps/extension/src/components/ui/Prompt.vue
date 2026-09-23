<template>
  <div class="fast-social-prompt-bar">
    <div class="prompt-choices" role="group" aria-label="AI 互动场景">
      <button
        v-for="prompt in visiblePrompts"
        :key="prompt.id"
        type="button"
        class="prompt-chip"
        :class="{ 'prompt-chip-active': prompt.id === selectedPromptId }"
        :aria-pressed="prompt.id === selectedPromptId"
        :title="prompt.name"
        @click="selectedPromptId = prompt.id"
      >
        <span>{{ prompt.name }}</span>
      </button>

      <button
        v-if="hasMorePrompts"
        type="button"
        class="more-button"
        :class="{ 'more-button-active': selectedPromptIsOverflow }"
        aria-label="显示全部互动场景"
        title="更多场景"
        @click="pickerOpen = true"
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
    </div>

    <button
      type="button"
      class="generate-button"
      :disabled="isLoading || !selectedPrompt"
      @click="handleGenerate"
    >
      <LoaderCircle v-if="isLoading" class="animate-spin" aria-hidden="true" />
      <Sparkles v-else aria-hidden="true" />
      <span>{{ isLoading ? "生成中" : "生成" }}</span>
    </button>
  </div>

  <Teleport to="body">
    <TransitionRoot appear :show="pickerOpen" as="template">
      <Dialog as="div" class="prompt-picker-root" @close="pickerOpen = false">
        <TransitionChild
          as="template"
          enter="duration-150 ease-out"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="duration-100 ease-in"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div class="prompt-picker-backdrop" />
        </TransitionChild>

        <div class="prompt-picker-positioner">
          <TransitionChild
            as="template"
            enter="duration-150 ease-out"
            enter-from="opacity-0 scale-95"
            enter-to="opacity-100 scale-100"
            leave="duration-100 ease-in"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-95"
          >
            <DialogPanel class="prompt-picker-panel">
              <div class="prompt-picker-header">
                <div>
                  <DialogTitle class="prompt-picker-title">选择互动场景</DialogTitle>
                  <p class="prompt-picker-description">选中后返回 X，再点击生成即可使用。</p>
                </div>
                <button type="button" class="prompt-picker-close" aria-label="关闭" @click="pickerOpen = false">
                  <X aria-hidden="true" />
                </button>
              </div>

              <div class="prompt-picker-list">
                <button
                  v-for="prompt in activePrompts"
                  :key="prompt.id"
                  type="button"
                  class="prompt-picker-option"
                  :class="{ 'prompt-picker-option-active': prompt.id === selectedPromptId }"
                  @click="selectFromPicker(prompt.id)"
                >
                  <span>{{ prompt.name }}</span>
                  <Check v-if="prompt.id === selectedPromptId" aria-hidden="true" />
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </TransitionRoot>
  </Teleport>
</template>

<script lang="ts" setup>
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import { Check, LoaderCircle, MoreHorizontal, Sparkles, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import type { PromptData } from "./prompt";

const QUICK_PROMPT_LIMIT = 3;

const props = defineProps<{
  promptList: PromptData[];
}>();

const selectedPromptId = ref("");
const isLoading = ref(false);
const pickerOpen = ref(false);

const activePrompts = computed(() => props.promptList.filter((prompt) => prompt.enabled));
const selectedPrompt = computed(() =>
  activePrompts.value.find((prompt) => prompt.id === selectedPromptId.value),
);
const selectedPromptIsOverflow = computed(() =>
  activePrompts.value.findIndex((prompt) => prompt.id === selectedPromptId.value) >= QUICK_PROMPT_LIMIT,
);
const hasMorePrompts = computed(() => activePrompts.value.length > QUICK_PROMPT_LIMIT);
const visiblePrompts = computed(() => {
  const firstPrompts = activePrompts.value.slice(0, QUICK_PROMPT_LIMIT);
  if (!selectedPromptIsOverflow.value || !selectedPrompt.value) return firstPrompts;
  return [...firstPrompts.slice(0, QUICK_PROMPT_LIMIT - 1), selectedPrompt.value];
});

watch(
  () => activePrompts.value.map((prompt) => prompt.id),
  (ids) => {
    if (!ids.includes(selectedPromptId.value)) {
      selectedPromptId.value = ids[0] ?? "";
    }
  },
  { immediate: true },
);

function selectFromPicker(promptId: string): void {
  selectedPromptId.value = promptId;
  pickerOpen.value = false;
}

async function handleGenerate(): Promise<void> {
  if (isLoading.value || !selectedPrompt.value) return;
  isLoading.value = true;
  try {
    await selectedPrompt.value.handler(selectedPrompt.value, selectedPrompt.value.params);
  } finally {
    isLoading.value = false;
  }
}
</script>

<style scoped>
.fast-social-prompt-bar {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.375rem;
  margin-bottom: 0.25rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.prompt-choices {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  gap: 0.375rem;
  overflow: hidden;
}

.prompt-chip,
.more-button,
.generate-button,
.prompt-picker-close,
.prompt-picker-option {
  margin: 0;
  border: 0;
  font: inherit;
  cursor: pointer;
}

.prompt-chip {
  display: inline-flex;
  height: 2rem;
  min-width: 0;
  max-width: 7.5rem;
  flex: 0 1 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(83, 100, 113, 0.32);
  border-radius: 9999px;
  background: transparent;
  padding: 0 0.75rem;
  color: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.prompt-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-chip:hover,
.more-button:hover {
  border-color: rgba(29, 155, 240, 0.6);
  background: rgba(29, 155, 240, 0.08);
}

.prompt-chip-active {
  border-color: rgba(29, 155, 240, 0.65);
  background: rgba(29, 155, 240, 0.12);
  color: rgb(29, 155, 240);
}

.more-button {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  flex: 0 0 2rem;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(83, 100, 113, 0.32);
  border-radius: 9999px;
  background: transparent;
  color: inherit;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.more-button svg,
.generate-button svg,
.prompt-picker-close svg,
.prompt-picker-option svg {
  width: 1rem;
  height: 1rem;
}

.more-button-active {
  border-color: rgba(29, 155, 240, 0.65);
  color: rgb(29, 155, 240);
}

.generate-button {
  display: inline-flex;
  height: 2rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border-radius: 9999px;
  background: rgb(29, 155, 240);
  padding: 0 0.875rem;
  color: white;
  font-size: 0.8125rem;
  font-weight: 700;
  white-space: nowrap;
  transition: background-color 120ms ease, opacity 120ms ease;
}

.generate-button:hover:not(:disabled) {
  background: rgb(26, 140, 216);
}

.generate-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.prompt-picker-root {
  position: relative;
  z-index: 2147483647;
}

.prompt-picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(2px);
}

.prompt-picker-positioner {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: 1rem;
}

.prompt-picker-panel {
  width: 100%;
  max-width: 24rem;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 1rem;
  background: rgb(255, 255, 255);
  color: rgb(15, 23, 42);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
}

.prompt-picker-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid rgb(226, 232, 240);
  padding: 1rem 1rem 0.875rem;
}

.prompt-picker-title {
  margin: 0;
  color: rgb(15, 23, 42);
  font-size: 1rem;
  font-weight: 700;
}

.prompt-picker-description {
  margin: 0.25rem 0 0;
  color: rgb(100, 116, 139);
  font-size: 0.75rem;
  line-height: 1.25rem;
}

.prompt-picker-close {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  flex: 0 0 2rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: transparent;
  color: rgb(100, 116, 139);
}

.prompt-picker-close:hover {
  background: rgb(241, 245, 249);
  color: rgb(15, 23, 42);
}

.prompt-picker-list {
  display: grid;
  gap: 0.375rem;
  padding: 0.75rem;
}

.prompt-picker-option {
  display: flex;
  width: 100%;
  min-height: 2.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-radius: 0.75rem;
  background: transparent;
  padding: 0.625rem 0.75rem;
  color: rgb(51, 65, 85);
  text-align: left;
  font-size: 0.875rem;
  font-weight: 600;
}

.prompt-picker-option:hover {
  background: rgb(248, 250, 252);
}

.prompt-picker-option-active {
  background: rgba(29, 155, 240, 0.1);
  color: rgb(2, 132, 199);
}

@media (max-width: 520px) {
  .prompt-chip {
    max-width: 6.25rem;
    padding: 0 0.625rem;
  }

  .generate-button {
    padding: 0 0.75rem;
  }
}
</style>
