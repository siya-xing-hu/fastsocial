<template>
  <div class="config-item mb-4">
    <h4 class="font-medium mb-2">{{ title }}</h4>
    <div v-for="button in buttons" :key="button.id" class="flex items-center gap-4 mb-2">
      <button @click="removeButton(button.id)"
        class="w-6 h-6 flex items-center justify-center text-red-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
        <span class="text-xl">−</span>
      </button>

      <!-- 启用复选框、名称和图标放在一组 -->
      <div class="flex items-center gap-2 w-1/5">
        <input type="checkbox" v-model="button.enabled" class="form-checkbox">
        <input type="text" v-model="button.name" class="form-input w-24">
        <select v-model="button.icon" class="form-input w-16">
          <option v-for="icon in iconOptions" :key="icon.value" :value="icon.value">
            {{ icon.value }}
          </option>
        </select>
      </div>

      <!-- 提示词输入框占据剩余空间 -->
      <input type="text" v-model="button.prompt" class="form-input flex-1" placeholder="请输入提示词">
    </div>
    <button @click="addButton"
      class="mt-2 w-6 h-6 flex items-center justify-center text-blue-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
      <span class="text-xl">+</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ButtonConfig } from '../common/storage-config';

const props = defineProps<{
  title: string;
  buttons: ButtonConfig[];
  platform: string;
  page: string;
}>();

const emit = defineEmits<{
  (e: 'add', platform: string, page: string): void;
  (e: 'remove', platform: string, page: string, id: string): void;
}>();

const iconOptions = computed(() => [
  { value: '🌎' },
  { value: '✨' },
  { value: '👍' },
  { value: '👎' },
  { value: '🫶' },
  { value: '🔥' },
  { value: '💡' },
  { value: '❓' },
]);

const addButton = () => {
  emit('add', props.platform, props.page);
};

const removeButton = (id: string) => {
  emit('remove', props.platform, props.page, id);
};
</script>

<style scoped>
.form-input {
  @apply w-full rounded-md border-gray-300 bg-gray-50 shadow-sm text-base py-2.5 focus:border-blue-500 focus:ring-blue-500 focus:bg-white transition-colors;
}

.form-checkbox {
  @apply rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-500 focus:ring-blue-500;
}
</style> 