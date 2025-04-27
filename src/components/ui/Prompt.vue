<template>
  <div class="flex items-center gap-3 mt-1">
    <div class="flex-1 relative">
      <select 
        v-model="selectedPromptId"
        class="w-full border border-gray-300 rounded-md p-2 text-sm bg-transparent pr-8"
      >
        <option value="" disabled>请选择场景</option>
        <option 
          v-for="prompt in props.promptList" 
          :key="prompt.id" 
          :value="prompt.id"
          :disabled="!prompt.enabled"
        >
          {{ prompt.icon }} {{ prompt.name }}
        </option>
      </select>
      <div class="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
        <ChevronDown />
      </div>
    </div>
    
    <button 
      class="generate-btn" 
      @click="handleGenerate"
      :disabled="isLoading"
    >
      <span class="flex items-center justify-center">
        ✨生成
        <span v-if="isLoading" class="ml-2">
          <i class="fas fa-spinner fa-spin"></i>
        </span>
      </span>
    </button>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed } from "vue";
import { ChevronDown } from "lucide-vue-next";
import type { PromptData } from "./prompt";

// 定义props
const props = defineProps<{
  promptList: PromptData[]
}>();

const selectedPromptId = ref("");
const isLoading = ref(false);

// 计算当前选中的 prompt
const selectedPrompt = computed(() => {
  return props.promptList.find(p => p.id === selectedPromptId.value);
});

// 处理生成点击
const handleGenerate = async () => {
  if (isLoading.value) return;
  
  const prompt = selectedPrompt.value;
  if (!prompt) return;
  
  isLoading.value = true;
  
  try {
    await prompt.handler(prompt, prompt.params);
  } finally {
    isLoading.value = false;
  }
};
</script>

<style scoped>
.generate-btn {
  @apply inline-flex justify-center items-center px-3 py-2 rounded-full text-sm font-medium;
  @apply bg-[#1d9bf0] text-white;
  @apply hover:bg-[#1a8cd8] active:bg-[#177cc0];
  @apply disabled:opacity-50 disabled:cursor-not-allowed;
  @apply whitespace-nowrap;
  transition: all 0.2s cubic-bezier(0.23, 1, 0.32, 1);
}

.generate-btn:disabled {
  @apply hover:bg-[#1d9bf0];
}

select {
  appearance: none;
  background-color: transparent;
}

select option {
  background-color: transparent;
}
</style>
