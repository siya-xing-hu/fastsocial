<template>
  <div
    class="fixed inset-0 bg-gray-200 bg-opacity-75 flex items-center justify-end z-50"
    @click.self="close"
  >
    <div class="common-dialog-panel bg-white rounded-l-lg p-6 h-full flex flex-col shadow-lg border border-gray-200 overflow-auto">
      <!-- 关闭按钮 -->
      <div class="absolute top-2 right-2">
        <button @click="close" class="hover:opacity-80">
          <X />
        </button>
      </div>
      
      <h3 class="text-xl font-medium mb-4 flex items-center text-gray-800">
        <div class="flex items-center gap-2 mb-2">
          <Sparkles />
        </div>
        <span class="mr-2">{{ title }}</span>
      </h3>

      <!-- 输入区域 -->
      <div class="mt-4 flex-grow overflow-hidden flex flex-col">
        <label class="block text-sm font-medium text-gray-700 mb-2">
          输入内容
        </label>
        <textarea
          v-model="inputContent"
          class="border border-gray-300 rounded-md p-3 bg-gray-50 flex-grow overflow-auto whitespace-pre-wrap text-gray-800"
          placeholder="请输入要处理的内容..."
        ></textarea>
      </div>

      <!-- 引用 Prompt 组件 -->
      <div class="mb-4">
        <Prompt :promptList="commonPrompts" />
      </div>

      <!-- 输出区域 -->
      <div v-if="outputContent" class="mt-4 flex-grow overflow-hidden flex flex-col">
        <label class="block text-sm font-medium text-gray-700 mb-2">
          生成结果
        </label>
        <div class="border border-gray-300 rounded-md p-3 bg-gray-50 flex-grow overflow-auto whitespace-pre-wrap text-gray-800">
          {{ outputContent }}
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="flex gap-2 mt-4 justify-end">
        <button
          @click="copyOutput"
          :disabled="!outputContent"
          class="copy-button"
        >
          复制结果
        </button>
        <button
          @click="close"
          class="confirm-button"
        >
          关闭
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { config } from "../../common/storage-config";
import { AIGenarateRuntimeMessage, RuntimeMessageTypeEnum, sendRuntimeMessage } from "../../common/runtime-message";
import { log_error } from "../../common/logging";
import Prompt from "./Prompt.vue";
import type { HandlerParams } from "./prompt";
import type { PromptConfig } from "../../common/storage-config";
import { X, Sparkles } from "lucide-vue-next";

// Props 和 Emits
const props = defineProps({
  title: {
    type: String,
    default: "创建内容",
  },
  onClose: {
    type: Function,
    required: true
  }
});

// 状态变量
const inputContent = ref("");
const outputContent = ref("");
const isLoading = ref(false);

// 缓存键
const CACHE_KEY_INPUT = "common_dialog_input";
const CACHE_KEY_OUTPUT = "common_dialog_output";

// 计算属性：筛选通用场景的按钮
const commonPrompts = computed(() => {
  return config.value.prompts.common
    .filter(p => p.enabled)
    .map(prompt => ({
      ...prompt,
      params: { data: null } as HandlerParams,
      handler: async (promptConfig: PromptConfig, params: HandlerParams) => {
        await handleGenerate(prompt.id);
      }
    }));
});

// 生成内容
async function handleGenerate(promptId: string) {
  if (isLoading.value || !inputContent.value.trim()) return;
  
  isLoading.value = true;
  
  try {
    const message: AIGenarateRuntimeMessage = {
      type: RuntimeMessageTypeEnum.AI_GENARATE,
      data: {
        scene: "common",
        id: promptId,
        userContent: inputContent.value,
      },
    };
    
    const response = await sendRuntimeMessage(message);
    if (!response.is_ok) {
      log_error("AI generate failed", response.error);
      alert("生成失败: " + response.error);
      return;
    }
    
    outputContent.value = response.data;
    // 保存结果到本地存储
    localStorage.setItem(CACHE_KEY_INPUT, inputContent.value);
    localStorage.setItem(CACHE_KEY_OUTPUT, outputContent.value);
  } catch (error) {
    log_error("生成内容失败", error);
    alert("生成失败，请重试");
  } finally {
    isLoading.value = false;
  }
}

// 复制输出内容
function copyOutput() {
  if (!outputContent.value) return;
  
  navigator.clipboard.writeText(outputContent.value)
    .catch(err => {
      log_error("复制失败", err);
      alert("复制失败，请手动复制");
    });
}

// 关闭对话框
function close() {
  props.onClose();
}

// 组件挂载时，恢复缓存数据
onMounted(() => {
  const cachedInput = localStorage.getItem(CACHE_KEY_INPUT);
  const cachedOutput = localStorage.getItem(CACHE_KEY_OUTPUT);
  
  if (cachedInput) inputContent.value = cachedInput;
  if (cachedOutput) outputContent.value = cachedOutput;
});
</script>

<style scoped>
/* 组件特定样式，其余样式在全局 CSS 文件中定义 */
</style> 