<template>
  <button
    type="button"
    role="switch"
    class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-0 p-0 align-middle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
    :class="modelValue ? 'bg-blue-600' : 'bg-slate-300'"
    :aria-checked="modelValue"
    :aria-label="label"
    :title="`${label} · ${modelValue ? '已启用' : '已停用'}`"
    :disabled="disabled"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span
      class="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none"
      :class="modelValue ? 'translate-x-4' : 'translate-x-0'"
      aria-hidden="true"
    />
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: boolean;
  label: string;
  disabled?: boolean;
}>(), { disabled: false });

defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>
