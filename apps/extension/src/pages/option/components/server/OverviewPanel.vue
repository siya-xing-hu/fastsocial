<template>
  <section aria-labelledby="overview-title">
    <header>
      <h2 id="overview-title" class="text-2xl font-semibold tracking-tight text-slate-900">配置概览</h2>
      <p class="mt-1.5 text-sm leading-6 text-slate-600">确认监听所需配置是否齐全；这里只展示当前状态，不保存执行历史。</p>
    </header>

    <div class="mt-6 grid gap-3 sm:grid-cols-3">
      <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p class="text-xs font-medium text-slate-500">AI 服务</p>
        <p class="mt-2 text-2xl font-semibold text-slate-900">{{ configuredAIServiceCount }}</p>
        <p class="mt-1 text-xs text-slate-500">已启用服务</p>
      </article>
      <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p class="text-xs font-medium text-slate-500">用户监听</p>
        <p class="mt-2 text-2xl font-semibold text-slate-900">{{ enabledMonitorCount }}</p>
        <p class="mt-1 text-xs text-slate-500">正在运行</p>
      </article>
      <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p class="text-xs font-medium text-slate-500">互动场景</p>
        <p class="mt-2 text-2xl font-semibold text-slate-900">{{ enabledPromptCount }}</p>
        <p class="mt-1 text-xs text-slate-500">已启用场景</p>
      </article>
    </div>

    <div class="mt-7 flex items-center justify-between">
      <div>
        <h3 class="text-sm font-semibold text-slate-900">启用监听前需要完成</h3>
        <p class="mt-1 text-xs text-slate-500">缺失项可以直接跳转到对应设置。</p>
      </div>
      <span class="text-xs font-medium text-slate-500">{{ completedCount }} / 3 已完成</span>
    </div>

    <div class="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div v-for="item in checklist" :key="item.key" class="flex items-center gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0">
        <span
          class="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold"
          :class="item.complete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'"
        >
          <Check v-if="item.complete" class="h-4 w-4" />
          <span v-else>!</span>
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-slate-900">{{ item.label }}</p>
          <p class="mt-0.5 truncate text-xs text-slate-500">{{ item.description }}</p>
        </div>
        <button type="button" class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50" @click="$emit('navigate', item.target)">
          {{ item.complete ? '查看' : '去配置' }}
          <ChevronRight class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Check, ChevronRight } from "lucide-vue-next";
import type { ServerSection } from "../../option-navigation";
import { useServerAdminContext } from "../../use-server-admin";

defineEmits<{ navigate: [section: ServerSection] }>();

const {
  settings,
  configuredAIServiceCount,
  enabledMonitorCount,
} = useServerAdminContext();

const enabledPromptCount = computed(
  () => settings.value?.interactionPrompts.filter((prompt) => prompt.enabled).length ?? 0,
);
const usableCookieCount = computed(
  () => settings.value?.x.cookies.filter((cookie) => (
    cookie.enabled && cookie.cookieConfigured && cookie.status !== "invalid"
  )).length ?? 0,
);

const checklist = computed(() => [
  {
    key: "x",
    label: "X 访问 Cookie",
    description: usableCookieCount.value > 0
      ? `${usableCookieCount.value} 个 Cookie 可用于读取 Post`
      : "没有启用且未失效的 Cookie，无法读取用户 Post",
    complete: usableCookieCount.value > 0,
    target: "connections" as const,
  },
  {
    key: "ai",
    label: "AI 服务与默认模型",
    description: settings.value?.ai.defaultProvider ? "已选择默认 AI 服务与模型" : "添加 AI 服务并选择默认模型",
    complete: Boolean(settings.value?.ai.defaultProvider),
    target: "ai" as const,
  },
  {
    key: "telegram",
    label: "Telegram 通知",
    description: settings.value?.telegram.botTokenConfigured && settings.value.telegram.chatId ? "Bot Token 与 Chat ID 已配置" : "补充 Bot Token 与 Chat ID 后才能通知",
    complete: Boolean(settings.value?.telegram.botTokenConfigured && settings.value.telegram.chatId),
    target: "connections" as const,
  },
]);

const completedCount = computed(() => checklist.value.filter((item) => item.complete).length);
</script>
