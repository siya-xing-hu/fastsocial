<template>
  <section class="grid min-h-[640px] min-w-0 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
    <aside class="min-w-0 overflow-hidden border-b border-slate-200 bg-slate-50/80 p-3 lg:border-b-0 lg:border-r lg:p-4">
      <p class="hidden px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 lg:block">
        服务端配置
      </p>
      <nav ref="serverNavigation" class="flex gap-1 overflow-x-auto lg:block lg:space-y-1" aria-label="服务端设置">
        <button
          v-for="item in navigationItems"
          :key="item.key"
          type="button"
          class="group flex min-w-max items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition lg:w-full"
          :class="section === item.key
            ? 'bg-blue-50 text-blue-700'
            : 'text-slate-600 hover:bg-white hover:text-slate-900'"
          :aria-current="section === item.key ? 'page' : undefined"
          @click="$emit('navigate', item.key)"
        >
          <component :is="item.icon" class="h-4 w-4 shrink-0" />
          <span>{{ item.label }}</span>
          <span
            v-if="item.count !== undefined"
            class="ml-auto rounded-full px-2 py-0.5 text-[11px]"
            :class="section === item.key ? 'bg-blue-100 text-blue-700' : 'bg-white text-slate-500'"
          >
            {{ item.count }}
          </span>
        </button>
      </nav>
    </aside>

    <main class="min-w-0 p-5 sm:p-7 lg:p-8">
      <div v-if="!online" class="grid min-h-[390px] place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center">
        <div class="max-w-md">
          <span class="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
            <ServerOff class="h-6 w-6" />
          </span>
          <h2 class="mt-4 text-lg font-semibold text-slate-900">服务未启动</h2>
          <p class="mt-2 text-sm leading-6 text-slate-600">
            服务端配置暂时不可读。插件基础设置和 Google / DeepL 翻译仍可正常使用。
          </p>
          <div class="mt-5 rounded-lg border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-700 shadow-sm">
            pnpm dev:server
          </div>
        </div>
      </div>

      <template v-else>
        <OverviewPanel v-if="section === 'overview'" @navigate="$emit('navigate', $event)" />
        <ConnectionPanel v-else-if="section === 'connections'" />
        <AIServicePanel v-else-if="section === 'ai'" />
        <MonitorPanel v-else-if="section === 'monitors'" />
        <InteractionPromptPanel v-else />
      </template>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Bot,
  Cable,
  LayoutDashboard,
  MessageSquareText,
  RadioTower,
  ServerOff,
} from "lucide-vue-next";
import type { ServerSection } from "../option-navigation";
import { useServerAdminContext } from "../use-server-admin";
import OverviewPanel from "./server/OverviewPanel.vue";
import ConnectionPanel from "./server/ConnectionPanel.vue";
import AIServicePanel from "./server/AIServicePanel.vue";
import MonitorPanel from "./server/MonitorPanel.vue";
import InteractionPromptPanel from "./server/InteractionPromptPanel.vue";

const props = defineProps<{ section: ServerSection }>();
defineEmits<{ navigate: [section: ServerSection] }>();

const serverNavigation = ref<HTMLElement | null>(null);

const {
  online,
  configuredAIServiceCount,
  enabledMonitorCount,
  settings,
} = useServerAdminContext();

const navigationItems = computed(() => [
  { key: "overview" as const, label: "配置概览", icon: LayoutDashboard },
  { key: "connections" as const, label: "连接配置", icon: Cable },
  { key: "ai" as const, label: "AI 服务", icon: Bot, count: configuredAIServiceCount.value },
  { key: "monitors" as const, label: "用户监听", icon: RadioTower, count: enabledMonitorCount.value },
  {
    key: "prompts" as const,
    label: "互动 Prompt",
    icon: MessageSquareText,
    count: settings.value?.interactionPrompts.length ?? 0,
  },
]);

async function revealSelectedSection() {
  await nextTick();
  if (!window.matchMedia("(max-width: 1023px)").matches) return;
  serverNavigation.value
    ?.querySelector<HTMLElement>('[aria-current="page"]')
    ?.scrollIntoView({ block: "nearest", inline: "center" });
}

watch(() => props.section, revealSelectedSection);
onMounted(() => {
  window.addEventListener("resize", revealSelectedSection);
  void revealSelectedSection();
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", revealSelectedSection);
});
</script>
