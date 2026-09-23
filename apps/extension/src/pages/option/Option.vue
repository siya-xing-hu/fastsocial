<template>
  <div class="min-h-screen bg-slate-100 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex min-h-[76px] max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div class="flex min-w-0 items-center gap-3">
          <img :src="brandIcon" alt="" width="40" height="40" class="h-10 w-10 shrink-0" />
          <div class="min-w-0">
            <h1 class="truncate text-base font-semibold tracking-tight text-slate-900">Fast Social 设置</h1>
            <p class="mt-0.5 hidden text-xs text-slate-500 sm:block">插件能力与本地监控服务</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center gap-2 text-xs font-medium"
            :class="loading ? 'text-slate-500' : online ? 'text-emerald-700' : 'text-slate-500'"
            role="status"
            aria-live="polite"
          >
            <span
              class="h-2 w-2 rounded-full"
              :class="loading ? 'animate-pulse bg-slate-300' : online ? 'bg-emerald-500' : 'bg-slate-300'"
            />
            {{ loading ? '正在检查' : online ? '服务在线' : '服务离线' }}
          </span>
          <button
            type="button"
            class="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="loading"
            aria-label="刷新本地服务状态"
            title="刷新本地服务状态"
            @click="refreshService"
          >
            <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
          </button>
        </div>
      </div>

      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <nav class="flex gap-1" aria-label="设置分类">
          <button
            type="button"
            class="relative min-h-12 px-4 text-sm font-semibold transition"
            :class="navigation.area === 'basic' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-900'"
            :aria-current="navigation.area === 'basic' ? 'page' : undefined"
            @click="openBasic"
          >
            插件基础设置
            <span v-if="navigation.area === 'basic'" class="absolute inset-x-3 bottom-0 h-0.5 rounded-t bg-blue-600" />
          </button>
          <button
            type="button"
            class="relative min-h-12 px-4 text-sm font-semibold transition"
            :class="navigation.area === 'server' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-900'"
            :aria-current="navigation.area === 'server' ? 'page' : undefined"
            @click="openServer"
          >
            服务端设置
            <span v-if="navigation.area === 'server'" class="absolute inset-x-3 bottom-0 h-0.5 rounded-t bg-blue-600" />
          </button>
        </nav>
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
      <div v-if="navigation.area === 'basic'" class="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm sm:p-7 lg:p-8">
        <BasicSettings v-if="configReady" />
        <div v-else class="grid min-h-64 place-items-center" role="status" aria-live="polite">
          <div class="text-center">
            <span class="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
            <p class="mt-3 text-sm text-slate-500">正在读取插件设置…</p>
          </div>
        </div>
      </div>
      <div v-else class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <ServerSettings :section="navigation.serverSection" @navigate="openServerSection" />
      </div>
    </main>

    <TestResultDialog :result="testResult" @close="closeTestResult" />

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div
        v-if="notice"
        class="fixed bottom-5 right-5 z-[60] max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-xl"
        :class="notice.type === 'error'
          ? 'border-red-200 bg-red-50 text-red-700'
          : notice.type === 'warning'
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700'"
        role="status"
        aria-live="polite"
      >
        {{ notice.text }}
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { RefreshCw } from "lucide-vue-next";
import { onBeforeUnmount, onMounted, provide, ref } from "vue";
import brandIcon from "../../assets/icons/icon-128.png";
import { initConfig } from "../../common/storage-config";
import BasicSettings from "./components/BasicSettings.vue";
import ServerSettings from "./components/ServerSettings.vue";
import TestResultDialog from "./components/TestResultDialog.vue";
import {
  loadOptionNavigation,
  navigateOption,
  parseOptionNavigation,
  saveOptionNavigation,
} from "./option-navigation";
import type { OptionNavigation, ServerSection } from "./option-navigation";
import {
  SERVER_ADMIN_KEY,
  useServerAdmin,
} from "./use-server-admin";

const admin = useServerAdmin();
provide(SERVER_ADMIN_KEY, admin);

const {
  loading,
  online,
  notice,
  testResult,
  refreshService,
  closeTestResult,
  showNotice,
} = admin;
const configReady = ref(false);
const initialNavigation = loadOptionNavigation(window.location.hash);
const navigation = ref<OptionNavigation>(initialNavigation);
const lastServerSection = ref<ServerSection>(
  initialNavigation.area === "server" ? initialNavigation.serverSection : "overview",
);

function applyNavigation(next: OptionNavigation) {
  navigation.value = next;
  if (next.area === "server") lastServerSection.value = next.serverSection;
}

function openBasic() {
  applyNavigation(navigateOption("#basic"));
}

function openServer() {
  openServerSection(lastServerSection.value);
}

function openServerSection(section: ServerSection) {
  applyNavigation(navigateOption(`#server/${section}`));
}

function handleHashChange() {
  const next = parseOptionNavigation(window.location.hash);
  saveOptionNavigation(next.hash);
  if (window.location.hash !== next.hash) {
    window.history.replaceState(null, "", next.hash);
  }
  applyNavigation(next);
}

onMounted(async () => {
  if (window.location.hash !== initialNavigation.hash) {
    window.history.replaceState(null, "", initialNavigation.hash);
  }
  saveOptionNavigation(initialNavigation.hash);
  window.addEventListener("hashchange", handleHashChange);
  const serviceRefresh = refreshService();
  try {
    await initConfig();
  } catch (error) {
    console.error("读取插件基础设置失败", error);
    showNotice("插件基础设置读取失败，当前显示默认值", "error");
  } finally {
    configReady.value = true;
  }
  await serviceRefresh;
});

onBeforeUnmount(() => {
  window.removeEventListener("hashchange", handleHashChange);
});
</script>
