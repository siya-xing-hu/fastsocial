<template>
  <OptionDialog
    :open="Boolean(result)"
    :title="result?.title ?? '测试结果'"
    @close="$emit('close')"
  >
    <div v-if="result" class="space-y-5">
      <div
        class="flex gap-3 rounded-xl border px-4 py-3.5"
        :class="result.status === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-red-200 bg-red-50 text-red-900'"
        role="status"
        aria-live="polite"
      >
        <CircleCheckBig v-if="result.status === 'success'" class="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <CircleX v-else class="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div>
          <p class="text-sm font-semibold">{{ result.status === 'success' ? '测试成功' : '测试失败' }}</p>
          <p class="mt-1 text-sm leading-6 opacity-80">{{ result.summary }}</p>
        </div>
      </div>

      <dl v-if="result.fields?.length" class="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-4">
        <div v-for="field in result.fields" :key="field.label" class="grid gap-1 py-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4">
          <dt class="text-xs font-medium text-slate-500">{{ field.label }}</dt>
          <dd class="min-w-0 break-words text-sm text-slate-800" :class="field.mono ? 'font-mono text-xs' : ''">{{ field.value }}</dd>
        </div>
      </dl>

      <div v-if="result.content" class="space-y-2">
        <p class="text-xs font-semibold text-slate-600">{{ result.content.label }}</p>
        <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">{{ result.content.value }}</pre>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <button type="button" class="secondary-button" @click="$emit('close')">关闭</button>
      </div>
    </template>
  </OptionDialog>
</template>

<script setup lang="ts">
import { CircleCheckBig, CircleX } from "lucide-vue-next";
import type { TestResultState } from "../use-server-admin";
import OptionDialog from "./OptionDialog.vue";

defineProps<{ result: TestResultState | null }>();
defineEmits<{ close: [] }>();
</script>

<style scoped>
.secondary-button { @apply inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50; }
</style>
