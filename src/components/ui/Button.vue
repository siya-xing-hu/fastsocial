<template>
  <div class="flex flex-wrap gap-2">
    <button v-for="button in buttonList" :key="button.id" :id="button.id" :disabled="!button.enabled"
      class="twitter-btn" @click="handleClick(button)">
      <span class="flex items-center">
        {{ button.icon + " " + button.name }}
        <span v-if="!button.enabled" class="ml-2">
          <i class="fas fa-spinner fa-spin"></i>
        </span>
      </span>
    </button>
  </div>
</template>

<script lang="ts" setup>
import { ButtonData, buttonList } from "./button";

const handleClick = async (button: ButtonData) => {
  if (!button.enabled) return;

  try {
    button.enabled = false;
    await button.handler(button, button.params);
  } finally {
    button.enabled = true;
  }
};
</script>

<style scoped>
.twitter-btn {
  @apply inline-flex justify-center items-center px-3 py-1.5 rounded-full text-sm font-medium;  /* 调整大小和字体 */
  @apply bg-[#1d9bf0] text-white;
  @apply hover:bg-[#1a8cd8] active:bg-[#177cc0];
  @apply disabled:opacity-50 disabled:cursor-not-allowed;
  @apply mt-2;  /* 添加上方间距 */
  transition: all 0.2s cubic-bezier(0.23, 1, 0.32, 1);
}

.twitter-btn:disabled {
  @apply hover:bg-[#1d9bf0];
}
</style>
