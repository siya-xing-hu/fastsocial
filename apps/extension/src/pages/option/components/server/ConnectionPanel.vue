<template>
  <section class="settings-page">
    <header class="page-heading">
      <div>
        <h2>连接配置</h2>
        <p class="subtitle">设置通知渠道。</p>
      </div>
    </header>
    <div v-if="!settings" class="error">
      {{ settingsError || "无法读取配置" }}
    </div>
    <template v-else>
      <article class="panel">
        <div class="panel-heading">Telegram</div>
        <fieldset class="panel-body" :disabled="busyAction !== null">
          <div class="form-grid">
            <label class="field"
              >Bot Token<input
                v-model="secretDraft.telegramToken"
                class="input"
                type="password"
                autocomplete="off"
                :placeholder="
                  settings.telegram.botTokenConfigured
                    ? '已配置，留空保留'
                    : '输入 Bot Token'
                " /></label
            ><label class="field"
              >Chat ID<input v-model="settings.telegram.chatId" class="input"
            /></label>
          </div>
          <div class="toolbar mt-4">
            <ActionButton action="save" label="保存 Telegram" @click="saveTelegram()" :loading="busyAction === 'telegram'" /><ActionButton action="test" label="发送测试消息" @click="testTelegram" :loading="busyAction === 'test:telegram'" />
          </div>
        </fieldset>
      </article>
    </template>
  </section>
</template>
<script setup lang="ts">
import ActionButton from "../../../../components/ui/ActionButton.vue";
import { useServerAdminContext } from "../../use-server-admin";
const {
  settings,
  settingsError,
  busyAction,
  secretDraft,
  saveTelegram,
  testTelegram,
} = useServerAdminContext();
</script>
