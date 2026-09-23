<template>
  <section aria-labelledby="monitors-title">
    <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 id="monitors-title" class="text-2xl font-semibold tracking-tight text-slate-900">用户监听</h2>
        <p class="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">指定 X 用户，再用 Prompt 描述哪些 Post 值得发送 Telegram 通知。</p>
      </div>
      <button type="button" class="primary-button" :disabled="busyAction !== null" @click="openDialog()"><Plus class="h-4 w-4" />新建监听</button>
    </header>

    <div class="mt-5 flex gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs leading-5 text-blue-800">
      <Workflow class="mt-0.5 h-4 w-4 shrink-0" />
      <p>先学习简介和最近 20 条 Post，之后结合短画像批量判断新增内容，命中才发 Telegram。X 与 AI 各重试一次；仍失败则保留进度，等下次检查补齐。</p>
    </div>

    <div v-if="monitorsError" class="error-card mt-5">{{ monitorsError }}</div>

    <div v-if="monitors.length === 0" class="mt-5 grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
      <div><RadioTower class="mx-auto h-7 w-7 text-slate-400" /><p class="mt-3 text-sm font-medium text-slate-700">还没有用户监听</p><p class="mt-1 text-xs text-slate-500">从一个你关心的 X 用户开始。</p></div>
    </div>

    <div v-else class="mt-5 space-y-3">
      <article v-for="monitor in monitors" :key="monitor.id" class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
        <div class="flex flex-col gap-4 xl:flex-row xl:items-center">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="font-semibold text-slate-900">{{ monitor.name }}</h3>
              <span class="status-badge" :class="monitor.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'">{{ monitor.enabled ? '已启用' : '已暂停' }}</span>
              <span v-if="monitor.lastError" class="status-badge bg-red-50 text-red-700">最近检查失败</span>
            </div>
            <p class="mt-1 text-sm font-medium text-blue-700">@{{ monitor.username }}</p>
            <p class="mt-2 line-clamp-2 text-xs leading-5" :class="monitor.lastError ? 'text-red-600' : 'text-slate-500'">{{ monitor.lastError || monitor.prompt }}</p>
            <p v-if="monitor.batchStatus" class="mt-2 text-xs text-slate-500">上轮获取 {{ monitor.batchStatus.fetched }} 条 · 分析 {{ monitor.batchStatus.analyzed }} 条 · 命中 {{ monitor.batchStatus.matched }} 条<span v-if="monitor.batchStatus.uncertain"> · 不确定 {{ monitor.batchStatus.uncertain }} 条</span><span v-if="monitor.batchStatus.pending"> · 待处理 {{ monitor.batchStatus.pending }} 条</span><span v-if="monitor.batchStatus.error"> · {{ phaseLabel(monitor.batchStatus.phase) }}失败</span></p>
            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
              <span>每 {{ monitor.intervalMinutes }} 分钟</span>
              <span>{{ monitor.lastCheckedAt ? `最近检查 ${formatTime(monitor.lastCheckedAt)}` : '尚未检查' }}</span>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 xl:justify-end">
            <label class="mr-1 inline-flex items-center gap-2 text-xs font-medium text-slate-600"><input type="checkbox" class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" :checked="monitor.enabled" :disabled="busyAction !== null" @change="handleToggle(monitor, $event)" />启用</label>
            <button type="button" class="secondary-button" :disabled="busyAction !== null" @click="runMonitor(monitor)">{{ busyAction === `run:${monitor.id}` ? '检查中…' : '批量测试' }}</button>
            <button type="button" class="secondary-button" :disabled="busyAction !== null" @click="openProfile(monitor)">画像</button>
            <button type="button" class="icon-button" :aria-label="`编辑 ${monitor.name}`" :disabled="busyAction !== null" @click="openDialog(monitor)"><Pencil class="h-4 w-4" /></button>
            <button type="button" class="icon-button text-red-600 hover:bg-red-50" :aria-label="`删除 ${monitor.name}`" :disabled="busyAction !== null" @click="confirmDelete(monitor.id)"><Trash2 class="h-4 w-4" /></button>
          </div>
        </div>
      </article>
    </div>

    <OptionDialog :open="profileOpen" title="账号短画像" description="同账号的监听规则共享画像；四行、最多 250 字。清空后仅从新证据继续学习。" :close-disabled="busyAction !== null" @close="profileOpen = false">
      <div v-if="profileView?.profile" class="space-y-4">
        <div class="rounded-lg bg-slate-50 p-3 text-sm leading-6"><p class="font-medium">{{ profileView.profile.account.name }} · @{{ profileView.profile.account.username }}</p><p class="mt-1 whitespace-pre-wrap text-slate-600">{{ profileView.profile.account.bio || '未填写简介' }}</p></div>
        <label class="block"><span class="field-label">画像 v{{ profileView.profile.version }} · {{ profileText.length }}/250 字</span><textarea v-model="profileText" maxlength="250" rows="6" class="field-input resize-y leading-6" placeholder="背景：…&#10;主题：…&#10;用语：…&#10;近况：…" :disabled="busyAction !== null" /></label>
        <p class="text-xs text-slate-400">更新于 {{ formatTime(profileView.profile.updatedAt) }}。推断内容请保留“可能”等限定。</p>
        <details v-if="profileView.evidence.length" class="text-xs"><summary class="cursor-pointer font-medium text-slate-600">查看画像来源（{{ profileView.evidence.length }} 条）</summary><div v-for="post in profileView.evidence" :key="post.id" class="mt-3 rounded-lg border border-slate-200 p-3"><p class="whitespace-pre-wrap leading-5 text-slate-600">{{ post.text }}</p><a :href="post.url" target="_blank" rel="noopener noreferrer" class="mt-2 inline-block text-blue-600">查看原帖 · {{ formatTime(post.createdAt) }}</a></div></details>
      </div>
      <div v-else class="space-y-3"><p class="text-sm leading-6 text-slate-500">尚未完成首次学习。定时检查会读取简介和最近 20 条帖子；批量测试只预览，不保存正式画像。</p><p v-if="profileView?.status?.error" class="error-card break-words">上次{{ phaseLabel(profileView.status.phase) }}失败：{{ profileView.status.error }}</p></div>
      <template #footer><div class="flex justify-between gap-3"><button v-if="profileView?.profile" type="button" class="secondary-button text-red-600" :disabled="busyAction !== null" @click="profileText = ''">清空内容</button><div class="ml-auto flex gap-3"><button type="button" class="secondary-button" :disabled="busyAction !== null" @click="profileOpen = false">关闭</button><button v-if="profileView?.profile" type="button" class="primary-button" :disabled="busyAction !== null" @click="submitProfile">保存画像</button></div></div></template>
    </OptionDialog>

    <OptionDialog
      :open="dialogOpen"
      :title="draft.id ? '编辑监听' : '新建监听'"
      description="Prompt 越具体，通知结果越稳定。"
      :close-disabled="busyAction !== null"
      @close="closeDialog"
    >
      <fieldset :disabled="busyAction !== null" class="min-w-0 space-y-4 border-0 p-0 disabled:opacity-70">
        <label class="block"><span class="field-label">名称</span><input v-model="draft.name" class="field-input" placeholder="Codex 重置提醒" /></label>
        <label class="block"><span class="field-label">X 用户名</span><input v-model="draft.username" class="field-input" placeholder="tibo_maker" /><span class="field-help">可以带或不带 @。</span></label>
        <label class="block"><span class="field-label">检查间隔（分钟）</span><input v-model.number="draft.intervalMinutes" type="number" min="1" max="1440" class="field-input" /></label>
        <label class="block"><span class="field-label">AI 判断 Prompt</span><textarea v-model="draft.prompt" class="field-input min-h-36 resize-y leading-6" placeholder="当帖子提到 Codex 使用额度重置的具体时间时通知我，并总结重置时间。" /></label>
        <label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700"><input v-model="draft.enabled" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />保存后立即启用</label>
      </fieldset>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button type="button" class="secondary-button" :disabled="busyAction !== null" @click="closeDialog">取消</button>
          <button type="button" class="primary-button" :disabled="busyAction !== null" @click="submitDraft">{{ busyAction?.startsWith('monitor:') ? '保存中…' : '保存监听' }}</button>
        </div>
      </template>
    </OptionDialog>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { Monitor, AccountProfileView, MonitorBatchStatus } from "@fast-social/contracts";
import { Pencil, Plus, RadioTower, Trash2, Workflow } from "lucide-vue-next";
import OptionDialog from "../OptionDialog.vue";
import { emptyMonitorDraft, monitorToDraft, useServerAdminContext } from "../../use-server-admin";

const { monitors, monitorsError, busyAction, saveMonitorDraft, toggleMonitor, deleteMonitor, runMonitor, getMonitorProfile, saveMonitorProfile } = useServerAdminContext();
const profileOpen = ref(false);
const profileView = ref<AccountProfileView | null>(null);
const profileMonitor = ref<Monitor | null>(null);
const profileText = ref('');
async function openProfile(monitor: Monitor) {
  const result = await getMonitorProfile(monitor);
  if (!result) return;
  profileMonitor.value = monitor;
  profileView.value = result;
  const labels = { background: '背景', topics: '主题', language: '用语', recent: '近况' };
  profileText.value = Object.entries(result.profile?.memory ?? {}).map(([key, fact]) => `${labels[key as keyof typeof labels]}：${fact.text}`).join('\n');
  profileOpen.value = true;
}
async function submitProfile() {
  if (!profileMonitor.value) return;
  const result = await saveMonitorProfile(profileMonitor.value, profileText.value);
  if (result) { profileView.value = result; profileOpen.value = false; }
}
function phaseLabel(phase: MonitorBatchStatus['phase']): string { return { fetch: '抓取', learn: '学习', analyze: '分析', notify: '通知', done: '检查' }[phase]; }
const dialogOpen = ref(false);
const draft = ref(emptyMonitorDraft());

function openDialog(monitor?: Monitor) { draft.value = monitor ? monitorToDraft(monitor) : emptyMonitorDraft(); dialogOpen.value = true; }
function closeDialog() { if (busyAction.value === null) dialogOpen.value = false; }
async function submitDraft() { if (await saveMonitorDraft(draft.value)) dialogOpen.value = false; }
async function confirmDelete(id: string) { if (window.confirm("确定删除这条监听规则？")) await deleteMonitor(id); }
async function handleToggle(monitor: Monitor, event: Event) {
  const input = event.target as HTMLInputElement;
  if (!(await toggleMonitor(monitor, input.checked))) input.checked = monitor.enabled;
}
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
</script>

<style scoped>
.field-label { @apply mb-2 block text-sm font-medium text-slate-700; }
.field-input { @apply w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100; }
.field-help { @apply mt-2 block text-xs leading-5 text-slate-500; }
.primary-button { @apply inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50; }
.secondary-button { @apply inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50; }
.icon-button { @apply inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50; }
.status-badge { @apply rounded-full px-2 py-0.5 text-[10px] font-semibold; }
.error-card { @apply rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700; }
</style>
