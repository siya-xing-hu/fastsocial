<template>
  <div
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    @click.self="close"
  >
    <div class="bg-theme rounded-lg p-6 w-[600px] max-h-[80vh] flex flex-col">
      <h3 class="text-xl font-medium mb-4 flex items-center">
        <span class="mr-2">{{ title }}</span>
      </h3>

      <!-- 输入区域 -->
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-2">
          输入内容
        </label>
        <textarea
          v-model="inputContent"
          class="w-full border border-gray-300 rounded-md p-3 min-h-[100px]"
          placeholder="请输入要处理的内容..."
        ></textarea>
      </div>

      <!-- 下拉框选择场景和生成按钮 -->
      <div class="mb-4 flex items-center gap-3">
        <div class="flex-1">
          <label class="block text-sm font-medium text-gray-700 mb-2">
            选择场景
          </label>
          <select 
            v-model="selectedPromptId"
            class="w-full border border-gray-300 rounded-md p-2 text-sm"
          >
            <option value="" disabled>请选择场景</option>
            <option 
              v-for="prompt in commonPrompts" 
              :key="prompt.id" 
              :value="prompt.id"
            >
              {{ prompt.icon }} {{ prompt.name }}
            </option>
          </select>
        </div>
        
        <div class="flex flex-col justify-end">
          <label class="block text-sm font-medium text-gray-700 mb-2">
            &nbsp;
          </label>
          <button
            @click="generate"
            :disabled="!canGenerate"
            class="whitespace-nowrap py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ isLoading ? '✨生成中...' : '✨生成' }}
          </button>
        </div>
      </div>

      <!-- 输出区域 -->
      <div v-if="outputContent" class="mt-4">
        <label class="block text-sm font-medium text-gray-700 mb-2">
          生成结果
        </label>
        <div class="border border-gray-300 rounded-md p-3 bg-gray-50 min-h-[120px] max-h-[300px] overflow-auto whitespace-pre-wrap">
          {{ outputContent }}
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="flex justify-end gap-2 mt-4">
        <button
          @click="copyOutput"
          :disabled="!outputContent"
          class="px-4 py-2 border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          复制结果
        </button>
        <button
          @click="close"
          class="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
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
const selectedPromptId = ref("");
const isLoading = ref(false);

// 缓存键
const CACHE_KEY_INPUT = "common_dialog_input";
const CACHE_KEY_OUTPUT = "common_dialog_output";
const CACHE_KEY_PROMPT = "common_dialog_prompt";

// 计算属性：筛选通用场景的按钮
const commonPrompts = computed(() => {
  return config.value.prompts.common.filter(p => p.enabled);
});

// 计算属性：是否可以生成
const canGenerate = computed(() => {
  return inputContent.value.trim() !== "" && selectedPromptId.value !== "" && !isLoading.value;
});

// 生成内容
async function generate() {
  if (!canGenerate.value) return;
  
  isLoading.value = true;
  
  try {
    const message: AIGenarateRuntimeMessage = {
      type: RuntimeMessageTypeEnum.AI_GENARATE,
      data: {
        content: inputContent.value,
        scene: "common",
        id: selectedPromptId.value,
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
    .then(() => {
      alert("已复制到剪贴板");
    })
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
  const cachedPrompt = localStorage.getItem(CACHE_KEY_PROMPT);
  
  if (cachedInput) inputContent.value = cachedInput;
  if (cachedOutput) outputContent.value = cachedOutput;
  if (cachedPrompt) selectedPromptId.value = cachedPrompt;
});
</script> 