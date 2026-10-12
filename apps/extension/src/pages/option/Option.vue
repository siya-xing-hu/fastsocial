<template>
  <div class="settings-shell">
    <header class="shell-header">
      <div class="flex items-center gap-3">
        <img :src="brandIcon" width="30" height="30" alt="" /><strong
          >Fast Social</strong
        >
      </div>
      <div class="flex items-center gap-3">
        <span
          class="text-xs"
          :class="serviceIncompatible || settingsError ? 'text-amber-600' : online ? 'text-emerald-600' : 'text-slate-400'"
          >● {{ loading ? "正在连接" : serviceIncompatible ? "服务需更新" : settingsError ? "配置加载失败" : online ? "服务在线" : "服务离线" }}</span
        ><ActionButton action="refresh" label="刷新服务状态" :disabled="loading" @click="refreshService" :loading="loading" />
      </div>
    </header>
    <div class="shell-body">
      <aside class="shell-sidebar">
        <p>插件 · 本地保存</p>
        <button data-ui="navigation" title="插件设置"
          :class="{ active: navigation.area === 'basic' }"
          @click="openBasic"
        >
          <Settings2 :size="16" />插件设置
        </button>
        <p class="mt-7">服务端 · 集中管理</p>
        <button data-ui="navigation" :title="item.label"
          v-for="item in navigationItems"
          :key="item.key"
          :class="{
            active:
              navigation.area === 'server' &&
              navigation.serverSection === item.key,
          }"
          @click="openServerSection(item.key)"
        >
          <component :is="item.icon" :size="16" />{{ item.label }}
        </button>
      </aside>
      <main class="shell-main">
        <template v-if="navigation.area === 'basic'"
          ><BasicSettings v-if="configReady" />
          <p v-else class="text-sm text-slate-400">
            正在读取插件设置…
          </p></template
        ><ServerSettings
          v-else
          :section="navigation.serverSection"
          @navigate="openServerSection"
        />
      </main>
    </div>
    <TestResultDialog :result="testResult" @close="closeTestResult" />
    <div
      v-if="notice"
      class="fixed bottom-5 right-5 z-[60] max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg"
      :class="
        notice.type === 'error'
          ? 'border-red-200 bg-red-50 text-red-700'
          : notice.type === 'warning'
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      "
      role="status"
    >
      {{ notice.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import ActionButton from "../../components/ui/ActionButton.vue";
import {
  Settings2,
  Users,
  MessageSquareText,
  Bot,
  Cable,
  RadioTower,
  UserRoundCheck,
} from "lucide-vue-next";
import { onBeforeUnmount, onMounted, provide, ref } from "vue";
import "./settings.css";
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
import { SERVER_ADMIN_KEY, useServerAdmin } from "./use-server-admin";

const admin = useServerAdmin();
provide(SERVER_ADMIN_KEY, admin);

const {
  loading,
  online,
  serviceIncompatible,
  settingsError,
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
  initialNavigation.area === "server"
    ? initialNavigation.serverSection
    : "accounts"
);

const navigationItems = [
  { key: "accounts" as const, label: "账号设置", icon: Users },
  { key: "following" as const, label: "关注列表", icon: UserRoundCheck },
  { key: "skills" as const, label: "互动 Skills", icon: MessageSquareText },
  { key: "ai" as const, label: "AI 服务", icon: Bot },
  { key: "connections" as const, label: "连接配置", icon: Cable },
  { key: "workflows" as const, label: "动作监听", icon: RadioTower },
];
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

<style scoped>
.settings-shell {
  min-height: 100vh;
  background: #f6f7fb;
  color: #243044;
  font-size: 14px;
}
.shell-header {
  height: 68px;
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 26px;
  background: #fff;
  border-bottom: 1px solid #e4e8ef;
}
.shell-body {
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  min-height: calc(100vh - 68px);
}
.shell-sidebar {
  background: #fafbfe;
  border-right: 1px solid #e4e8ef;
  padding: 24px 12px;
}
.shell-sidebar p {
  font-size: 10px;
  letter-spacing: 0.7px;
  color: #8b94a3;
  padding: 0 10px 12px;
}
.shell-sidebar button {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 12px 10px;
  border-radius: 7px;
  margin-bottom: 4px;
  text-align: left;
  font-size: 13px;
  color: #637087;
}
.shell-sidebar button.active {
  background: #ecf0fe;
  color: #4260bb;
  font-weight: 600;
}
.shell-main {
  padding: 28px;
  min-width: 0;
  width: 100%;
  margin: 0;
  align-self: start;
  min-height: calc(100vh - 68px);
}
@media (max-width: 750px) {
  .shell-body {
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
    grid-template-columns: 1fr;
  }
  .shell-sidebar {
    display: flex;
    overflow: auto;
    padding: 8px;
    border-bottom: 1px solid #e4e8ef;
    gap: 5px;
  }
  .shell-sidebar p {
    display: none;
  }
  .shell-sidebar button {
    min-width: max-content;
    width: auto;
    margin: 0;
  }
  .shell-main {
    padding: 18px;
  }
  .shell-header {
    padding: 0 18px;
  }
}
</style>
