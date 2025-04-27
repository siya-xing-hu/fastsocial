<template>
  <div
    class="fixed inset-0 bg-gray-200 bg-opacity-75 flex justify-center items-center"
  >
    <div class="dialog-container">
      <!-- 关闭按钮 -->
      <div class="absolute top-2 right-2">
        <button @click="cancel" class="hover:opacity-80">
          <X />
        </button>
      </div>
      <!-- 标题和内容 -->
      <div>
        <div class="flex items-center gap-2 mb-2">
          <Sparkles />
        </div>
        <span class="block whitespace-pre-wrap leading-relaxed text-sm">{{
          text
        }}</span>
      </div>
      <div class="flex justify-end mt-4">
        <button
          @click="confirm"
          class="confirm-button"
        >
          确认
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { X, Sparkles } from "lucide-vue-next";

defineProps({
  text: String,
});

const emit = defineEmits(['confirm', 'cancel']);

function confirm() {
  emit('confirm');
}

function cancel() {
  emit('cancel');
}
</script>

<style>
.dialog-container {
  background-color: white !important;
  color: #1f2937 !important; /* text-gray-800 equivalent */
  padding: 1.5rem !important;
  border-radius: 0.5rem !important;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
  width: 36rem !important; /* w-164 equivalent, approximately */
  position: relative !important;
  border: 1px solid #e5e7eb !important; /* border-gray-200 equivalent */
}

.dialog-container * {
  color: #1f2937 !important;
}

.confirm-button {
  background-color: #60a5fa !important; /* bg-blue-400 */
  color: white !important;
  font-weight: 100 !important; /* font-thin */
  padding: 0.25rem 0.75rem !important; /* py-1 px-3 */
  border-radius: 0.375rem !important; /* rounded-md */
  font-size: 0.875rem !important; /* text-sm */
}

.confirm-button:hover {
  background-color: #3b82f6 !important; /* bg-blue-500 */
}
</style>
