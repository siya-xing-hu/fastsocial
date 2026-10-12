<template>
  <div v-if="loading && !settings" class="settings-page" role="status">
    <div class="panel panel-body"><p>正在读取服务配置…</p></div>
  </div>
  <div v-else-if="serviceIncompatible" class="settings-page" role="alert">
    <div class="panel panel-body">
      <h2>服务版本不兼容</h2>
      <p class="subtitle">{{ serviceError || settingsError }}</p>
      <ActionButton action="refresh" label="重新连接" class="mt-4" :disabled="loading" @click="refreshService" :loading="loading" />
    </div>
  </div>
  <div v-else-if="!online" class="settings-page">
    <div class="panel panel-body">
      <h2>服务未启动</h2>
      <p class="subtitle">服务端配置暂时不可用，插件基础翻译仍可使用。</p>
      <p v-if="serviceError" class="error mt-2">{{ serviceError }}</p>
      <ActionButton action="refresh" label="重新连接" class="mt-4" :disabled="loading" @click="refreshService" :loading="loading" />
    </div>
  </div>
  <div v-else-if="!settings" class="settings-page" role="alert">
    <div class="panel panel-body">
      <h2>配置加载失败</h2>
      <p class="subtitle">{{ settingsError || '未能读取服务配置，请重新连接。' }}</p>
      <ActionButton action="refresh" label="重新连接" class="mt-4" :disabled="loading" @click="refreshService" :loading="loading" />
    </div>
  </div>
  <AccountPanel v-else-if="section === 'accounts'" />
  <FollowingPanel v-else-if="section === 'following'" />
  <SkillPanel v-else-if="section === 'skills'" />
  <AIServicePanel v-else-if="section === 'ai'" />
  <ConnectionPanel v-else-if="section === 'connections'" />
  <WorkflowPanel v-else />
</template>
<script setup lang="ts">
import ActionButton from "../../../components/ui/ActionButton.vue";
import type { ServerSection } from "../option-navigation";
import { useServerAdminContext } from "../use-server-admin";
import AccountPanel from "./server/AccountPanel.vue";
import FollowingPanel from "./server/FollowingPanel.vue";
import SkillPanel from "./server/SkillPanel.vue";
import AIServicePanel from "./server/AIServicePanel.vue";
import ConnectionPanel from "./server/ConnectionPanel.vue";
import WorkflowPanel from "./server/WorkflowPanel.vue";
defineProps<{ section: ServerSection }>();
defineEmits<{ navigate: [section: ServerSection] }>();
const { loading, online, serviceIncompatible, serviceError, settingsError, settings, refreshService } = useServerAdminContext();
</script>
