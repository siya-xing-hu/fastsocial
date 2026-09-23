<template>
  <section aria-labelledby="connections-title">
    <header>
      <h2 id="connections-title" class="text-2xl font-semibold tracking-tight text-slate-900">连接配置</h2>
      <p class="mt-1.5 text-sm leading-6 text-slate-600">管理读取 X Post 的 Cookie 池和 Telegram 通知目标。</p>
    </header>

    <div v-if="!settings" class="error-card mt-6">{{ settingsError || '服务配置暂时不可用，请刷新后重试。' }}</div>

    <div v-else class="mt-6 space-y-5">
      <article class="settings-card">
        <div class="card-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-base font-semibold text-slate-900">X 访问配置</h3>
              <span class="status-badge" :class="usableCookieCount > 0 ? 'status-ready' : 'status-pending'">
                {{ usableCookieCount }} 个可用 / {{ settings.x.cookies.length }} 个
              </span>
            </div>
            <p class="mt-1 text-sm text-slate-500">每次抓取随机选择一个启用且未失效的 Cookie；凭证失效后自动尝试下一项。</p>
          </div>
          <button type="button" class="primary-button" :disabled="busyAction !== null" @click="openCookieDialog()">
            <Plus class="h-4 w-4" />添加 Cookie
          </button>
        </div>

        <div class="space-y-4 p-5 sm:p-6">
          <label class="block">
            <span class="field-label">测试用户名</span>
            <input v-model="testUsername" class="field-input" placeholder="例如 tibo_maker" />
            <span class="field-help">每行的“测试”只验证对应 Cookie，并读取该用户的最新 Post。</span>
          </label>

          <div v-if="settings.x.cookies.length === 0" class="grid min-h-36 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
            <div>
              <Cookie class="mx-auto h-6 w-6 text-slate-400" />
              <p class="mt-2 text-sm font-medium text-slate-700">还没有 X Cookie</p>
              <p class="mt-1 text-xs text-slate-500">添加后即可测试和运行用户监听。</p>
            </div>
          </div>

          <div v-else class="space-y-3">
            <div v-for="cookie in settings.x.cookies" :key="cookie.id" class="rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h4 class="font-semibold text-slate-900">{{ cookie.name }}</h4>
                    <span class="status-badge" :class="cookieStatusClass(cookie.status)">{{ cookieStatusText(cookie.status) }}</span>
                    <span class="status-badge" :class="cookie.enabled ? 'status-ready' : 'bg-slate-100 text-slate-500'">
                      {{ cookie.enabled ? '已启用' : '已停用' }}
                    </span>
                    <span v-if="cookie.cookieConfigured" class="status-badge bg-slate-100 text-slate-600">Cookie 已配置</span>
                  </div>
                  <p class="mt-2 text-xs text-slate-500">
                    {{ cookie.lastCheckedAt ? `最近验证 ${formatTime(cookie.lastCheckedAt)}` : '尚未验证' }}
                  </p>
                  <p v-if="cookie.lastError" class="mt-1 break-words text-xs leading-5 text-red-600">{{ cookie.lastError }}</p>
                </div>

                <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                  <label class="mr-1 inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                    <input
                      :checked="cookie.enabled"
                      type="checkbox"
                      class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      :disabled="busyAction !== null"
                      @change="handleToggle(cookie, $event)"
                    />
                    启用
                  </label>
                  <button type="button" class="secondary-button" :disabled="busyAction !== null || !cookie.cookieConfigured" @click="testXCookie(cookie)">
                    {{ busyAction === `test:x:${cookie.id}` ? '测试中…' : '测试' }}
                  </button>
                  <button type="button" class="secondary-button" :class="cookie.status === 'invalid' ? 'border-red-200 text-red-700 hover:bg-red-50' : ''" :disabled="busyAction !== null" @click="openCookieDialog(cookie)">
                    <Pencil class="h-3.5 w-3.5" />{{ cookie.status === 'invalid' ? '更新 Cookie' : '编辑' }}
                  </button>
                  <button type="button" class="icon-button text-red-600 hover:bg-red-50" :aria-label="`删除 ${cookie.name}`" :disabled="busyAction !== null" @click="confirmRemoveCookie(cookie.id)">
                    <Trash2 class="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>

      <article class="settings-card">
        <div class="card-header">
          <div class="flex items-center gap-2">
            <h3 class="text-base font-semibold text-slate-900">Telegram 通知</h3>
            <span class="status-badge" :class="telegramReady ? 'status-ready' : 'status-pending'">
              {{ telegramReady ? '已配置' : '待配置' }}
            </span>
          </div>
          <p class="mt-1 text-sm text-slate-500">命中 Prompt 后立即发送；失败直接报错，不补发。</p>
        </div>
        <fieldset :disabled="busyAction !== null" class="grid min-w-0 gap-5 border-0 p-5 sm:grid-cols-2 sm:p-6 disabled:opacity-70">
          <label class="block">
            <span class="field-label">Bot Token</span>
            <input
              v-model="secretDraft.telegramToken"
              type="password"
              class="field-input"
              :placeholder="settings.telegram.botTokenConfigured ? '已配置；留空表示保留' : '123456:ABC...'"
              autocomplete="off"
            />
          </label>
          <label class="block">
            <span class="field-label">Chat ID</span>
            <input v-model="settings.telegram.chatId" class="field-input" placeholder="例如 123456789" />
          </label>
          <div class="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" class="primary-button" @click="saveTelegram()">
              {{ busyAction === 'telegram' ? '保存中…' : '保存 Telegram' }}
            </button>
            <button type="button" class="secondary-button" @click="testTelegram">
              {{ busyAction === 'test:telegram' ? '发送中…' : '发送测试消息' }}
            </button>
          </div>
        </fieldset>
      </article>
    </div>

    <OptionDialog
      :open="cookieDialogOpen"
      :title="cookieDraft.id ? '编辑 X Cookie' : '添加 X Cookie'"
      description="Cookie 只保存在本机 SQLite，页面不会读取并回显明文。"
      :close-disabled="busyAction !== null"
      @close="closeCookieDialog"
    >
      <fieldset :disabled="busyAction !== null" class="min-w-0 space-y-4 border-0 p-0 disabled:opacity-70">
        <label class="block">
          <span class="field-label">配置名称</span>
          <input v-model="cookieDraft.name" class="field-input" placeholder="例如 主账号" />
          <span class="field-help">用于区分不同账号或登录会话。</span>
        </label>
        <label class="block">
          <span class="field-label">完整 Cookie</span>
          <textarea
            v-model="cookieDraft.cookie"
            class="field-input min-h-32 resize-y font-mono text-xs leading-5"
            :placeholder="cookieDraft.cookieConfigured ? '已配置；留空表示保留当前 Cookie' : 'auth_token=...; ct0=...'"
            autocomplete="off"
          />
        </label>
        <label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
          <input v-model="cookieDraft.enabled" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />启用此 Cookie
        </label>
      </fieldset>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button type="button" class="secondary-button" :disabled="busyAction !== null" @click="closeCookieDialog">取消</button>
          <button type="button" class="primary-button" :disabled="busyAction !== null" @click="submitCookie">
            {{ busyAction?.startsWith('x-cookie:') ? '保存中…' : '保存 Cookie' }}
          </button>
        </div>
      </template>
    </OptionDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { XCookieConfig, XCookieStatus } from "@fast-social/contracts";
import { Cookie, Pencil, Plus, Trash2 } from "lucide-vue-next";
import OptionDialog from "../OptionDialog.vue";
import {
  emptyXCookieDraft,
  useServerAdminContext,
  xCookieToDraft,
} from "../../use-server-admin";

const {
  settings,
  settingsError,
  secretDraft,
  testUsername,
  busyAction,
  saveTelegram,
  saveXCookieDraft,
  removeXCookie,
  toggleXCookie,
  testXCookie,
  testTelegram,
} = useServerAdminContext();

const cookieDialogOpen = ref(false);
const cookieDraft = ref(emptyXCookieDraft());

const telegramReady = computed(() => Boolean(
  settings.value?.telegram.botTokenConfigured && settings.value.telegram.chatId,
));
const usableCookieCount = computed(() => (
  settings.value?.x.cookies.filter((cookie) => (
    cookie.enabled && cookie.cookieConfigured && cookie.status !== "invalid"
  )).length ?? 0
));

function openCookieDialog(cookie?: XCookieConfig) {
  cookieDraft.value = cookie ? xCookieToDraft(cookie) : emptyXCookieDraft();
  cookieDialogOpen.value = true;
}

function closeCookieDialog() {
  if (busyAction.value === null) cookieDialogOpen.value = false;
}

async function submitCookie() {
  if (await saveXCookieDraft(cookieDraft.value)) cookieDialogOpen.value = false;
}

async function confirmRemoveCookie(id: string) {
  if (window.confirm("确定删除这个 X Cookie？")) await removeXCookie(id);
}

async function handleToggle(cookie: XCookieConfig, event: Event) {
  const input = event.target as HTMLInputElement;
  if (!(await toggleXCookie(cookie, input.checked))) input.checked = cookie.enabled;
}

function cookieStatusText(status: XCookieStatus): string {
  if (status === "valid") return "可用";
  if (status === "invalid") return "已失效";
  return "未验证";
}

function cookieStatusClass(status: XCookieStatus): string {
  if (status === "valid") return "status-ready";
  if (status === "invalid") return "bg-red-50 text-red-700";
  return "status-pending";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
</script>

<style scoped>
.settings-card { @apply overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm; }
.card-header { @apply border-b border-slate-100 px-5 py-4 sm:px-6; }
.field-label { @apply mb-2 block text-sm font-medium text-slate-700; }
.field-input { @apply w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100; }
.field-help { @apply mt-2 block text-xs leading-5 text-slate-500; }
.primary-button { @apply inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50; }
.secondary-button { @apply inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50; }
.icon-button { @apply inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50; }
.status-badge { @apply rounded-full px-2.5 py-1 text-[11px] font-semibold; }
.status-ready { @apply bg-emerald-50 text-emerald-700; }
.status-pending { @apply bg-amber-50 text-amber-700; }
.error-card { @apply rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700; }
</style>
