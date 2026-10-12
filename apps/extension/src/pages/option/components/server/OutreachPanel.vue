<template>
  <section aria-labelledby="outreach-title">
    <p v-if="error || loadError" role="alert" class="error-card mb-5">{{ error || loadError }} <ActionButton action="refresh" label="重试读取列表" v-if="!list" @click="load" /></p>
    <p v-if="notice" role="status" class="mb-5 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">{{ notice }}</p>
    <OutreachRecords v-if="selectedId && detail" :view="detail" :busy="!!busy" @back="backToList" @refresh="load" @action="runAction(selectedId, $event)" />
    <template v-else>
      <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h2 id="outreach-title" class="text-2xl font-semibold tracking-tight text-slate-900">互关发现</h2><p class="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">添加你维护的 X 账户，分别浏览各自首页，由 AI 识别互关邀请，先关注再回复。</p></div>
        <ActionButton action="add" label="添加互关账户" :disabled="!!busy || !list" @click="openDialog()" />
      </header>
      <div class="mt-5 flex gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs leading-5 text-blue-800"><Workflow class="mt-0.5 h-4 w-4 shrink-0" /><p>每轮浏览首页一页、最多 20 条帖子，不搜索、不连续翻页。关注满一天后检查一次，之后手动检查。各账户分别配置，X 请求按间隔轮流执行。</p></div>
      <p v-if="!list" class="mt-5 text-sm text-slate-500">{{ error ? '账户列表暂时不可读' : '正在加载互关账户…' }}</p>
      <div v-else-if="!list.accounts.length" class="mt-5 grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center"><div><Users class="mx-auto h-7 w-7 text-slate-400" /><p class="mt-3 text-sm font-medium text-slate-700">还没有互关账户</p><p class="mt-1 text-xs text-slate-500">添加一个 X 账号开始；多个账号可以分别配置并同时维护。</p></div></div>
      <div v-else class="mt-5 space-y-3">
        <article v-for="account in list.accounts" :key="account.config.id" class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
          <div class="flex flex-col gap-4 xl:flex-row xl:items-center">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2"><h3 class="font-semibold text-slate-900">{{ account.config.name }}</h3><span class="status-badge" :class="account.config.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'">{{ account.config.enabled ? '已启用' : '已暂停' }}</span><span v-if="account.state.pauseReason" class="status-badge bg-red-50 text-red-700">请求已暂停</span></div>
              <p class="mt-1 text-sm text-slate-600">{{ cookieName(account.config.cookieId) }} · 首页推荐</p>
              <p class="mt-2 line-clamp-2 text-xs leading-5" :class="account.state.pauseReason ? 'text-red-600' : 'text-slate-500'">{{ account.state.pauseReason || account.config.prompt }}</p>
              <p class="mt-2 text-xs text-slate-500">今日关注 {{ account.todayFollowAttempts }} / {{ account.config.dailyLimit }} · 联系记录 {{ account.recordCount }} · 已互关 {{ account.mutualCount }}</p>
              <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400"><span>每 {{ account.config.intervalMinutes }} 分钟浏览</span><span>请求间隔 {{ account.config.requestGapSeconds }} 秒</span><span>{{ account.state.lastFetchedAt ? `最近浏览 ${formatTime(account.state.lastFetchedAt)}` : '尚未浏览' }}</span></div>
              <p v-if="account.state.checkJob" class="mt-2 text-xs text-blue-700">{{ checkLabel(account.state.checkJob.status) }}：{{ account.state.checkJob.completed }} / {{ account.state.checkJob.ids.length }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2 xl:justify-end">
              <ToggleSwitch class="mr-1" :model-value="account.config.enabled" :label="`启用互关账户 ${account.config.name}`" :disabled="!!busy" @update:model-value="toggle(account.config.id, $event)" />
              <ActionButton action="details" label="查看联系记录" :disabled="!!busy" @click="openRecords(account.config.id)" />
              <ActionButton action="run" label="恢复请求" v-if="account.state.pauseReason" :disabled="!!busy" @click="runAction(account.config.id, 'resume')" />
              <ActionButton action="stop" label="停止检查" v-else-if="account.state.checkJob?.status === 'running'" :disabled="!!busy" @click="runAction(account.config.id, 'check/stop')" />
              <ActionButton action="test" label="检查未回关" v-else :disabled="!!busy" @click="runAction(account.config.id, 'check')" />
              <ActionButton action="edit" :label="`编辑 ${account.config.name}`" :disabled="!!busy" @click="openDialog(account.config)" />
              <ActionButton action="delete" :label="`移除 ${account.config.name}`" :disabled="!!busy" @click="remove(account.config)" />
            </div>
          </div>
        </article>
      </div>
    </template>
    <OptionDialog :open="dialogOpen" :title="editingId ? '编辑互关账户' : '添加互关账户'" description="每个 X 账号单独配置，使用自己的 Cookie 浏览首页和执行互动。" :close-disabled="!!busy" @close="dialogOpen = false">
      <p v-if="dialogError" role="alert" class="error-card mb-4">{{ dialogError }}</p>
      <fieldset :disabled="!!busy" class="min-w-0 space-y-4 border-0 p-0 disabled:opacity-70">
        <label class="block"><span class="field-label">账户名称</span><input v-model="draft.name" maxlength="80" class="field-input" placeholder="例如：个人账号、产品账号" /></label>
        <label class="block"><span class="field-label">X Cookie</span><select v-model="draft.cookieId" class="field-input"><option value="">选择账号对应的 Cookie</option><option v-for="cookie in cookies" :key="cookie.id" :value="cookie.id" :disabled="!cookie.enabled || !cookie.cookieConfigured || cookie.status === 'invalid' || usedCookie(cookie.id)">{{ cookie.name }}{{ usedCookie(cookie.id) ? '（已添加）' : cookie.status === 'invalid' ? '（已失效）' : !cookie.enabled ? '（未启用）' : '' }}</option></select><span class="field-help">先在“连接配置”添加完整 Cookie。{{ editingId ? '只能更换同一个 X 账号的 Cookie，其他账号请另行添加。' : '不同 Cookie 若属于同一 X 账号，也只需添加一次。' }}</span></label>
        <label class="block"><span class="field-label">AI 判断条件</span><textarea v-model="draft.prompt" maxlength="2000" rows="4" class="field-input resize-y leading-6" placeholder="描述希望联系的人，以及什么样的互关邀请值得回应。" /><span class="field-help">AI 阅读首页帖子的原文后判断，条件用于进一步筛选明确的互关邀请。</span></label>
        <label class="block"><span class="field-label">关注成功后的回复</span><input v-model="draft.replyText" maxlength="100" class="field-input" placeholder="已关注，互相联系～" /></label>
        <div class="grid gap-4 sm:grid-cols-3"><label class="block"><span class="field-label">浏览间隔（分钟）</span><input v-model.number="draft.intervalMinutes" type="number" min="15" max="1440" class="field-input" /></label><label class="block"><span class="field-label">每日关注上限</span><input v-model.number="draft.dailyLimit" type="number" min="1" max="100" class="field-input" /></label><label class="block"><span class="field-label">请求间隔（秒）</span><input v-model.number="draft.requestGapSeconds" type="number" min="15" max="3600" class="field-input" /></label></div>
        <div class="flex items-center gap-2"><ToggleSwitch v-model="draft.enabled" label="启用此互关账户" :disabled="!!busy" /><span class="text-sm text-slate-700">启用此互关账户</span></div>
        <p class="text-xs leading-5 text-slate-400">额度按 UTC 日统计。默认低频执行，异常会暂停此账户；低频不保证避免账号限制。</p>
      </fieldset>
      <template #footer><div class="flex justify-end gap-3"><ActionButton action="cancel" label="取消" :disabled="!!busy" @click="dialogOpen = false" /><ActionButton action="save" label="保存账户" :disabled="!!busy" @click="save" /></div></template>
    </OptionDialog>
  </section>
</template>

<script setup lang="ts">
import ActionButton from "../../../../components/ui/ActionButton.vue";
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { OutreachAccountsView, OutreachConfig, OutreachConfigInput, OutreachView } from '@fast-social/contracts';
import { Users, Workflow } from 'lucide-vue-next';
import OptionDialog from '../OptionDialog.vue';
import ToggleSwitch from '../../../../components/ui/ToggleSwitch.vue';
import OutreachRecords from './OutreachRecords.vue';
import { requestLocalService } from '../../../../common/local-service';
import { useServerAdminContext } from '../../use-server-admin';
import { confirmOperation } from '../../../../components/ui/confirm-operation';

const { settings } = useServerAdminContext();
const cookies = computed(() => settings.value?.x.cookies ?? []);
const list = ref<OutreachAccountsView | null>(null);
const detail = ref<OutreachView | null>(null);
const selectedId = ref('');
const busy = ref('');
const error = ref('');
const loadError = ref('');
const notice = ref('');
const dialogOpen = ref(false);
const dialogError = ref('');
const editingId = ref('');
const draft = ref<OutreachConfigInput>({ name: '', enabled: false, cookieId: '', prompt: '', intervalMinutes: 60, dailyLimit: 10, requestGapSeconds: 60, replyText: '已关注，互相联系～' });
let disposed = false;
let loading = false;
let version = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const url = (id: string) => `/api/outreach/accounts/${encodeURIComponent(id)}`;
const message = (failure: unknown) => failure instanceof Error ? failure.message : '操作失败';
const cookieName = (id: string) => cookies.value.find(cookie => cookie.id === id)?.name ?? 'Cookie 已移除';
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const checkLabel = (status: string) => status === 'running' ? '正在逐条检查' : status === 'stopped' ? '检查已停止' : '检查完成';
const usedCookie = (id: string) => !!list.value?.accounts.some(account => account.config.id !== editingId.value && account.config.cookieId === id);
function openDialog(config?: OutreachConfig) {
  editingId.value = config?.id ?? ''; dialogError.value = '';
  if (config) { const { id, actorId, ...input } = config; draft.value = { ...input }; }
  else if (list.value) draft.value = { ...list.value.defaults };
  dialogOpen.value = true;
}
async function load() {
  if (loading || busy.value) return;
  loading = true; const revision = version; const id = selectedId.value;
  try {
    const result = await requestLocalService<OutreachAccountsView>('/api/outreach');
    if (disposed || revision !== version) return;
    list.value = result;
    if (id && result.accounts.some(account => account.config.id === id)) {
      const records = await requestLocalService<OutreachView>(url(id));
      if (!disposed && revision === version) detail.value = records;
    } else if (id) backToList();
    if (revision === version) loadError.value = '';
  } catch (failure) { if (!disposed && revision === version) loadError.value = message(failure); }
  finally { loading = false; }
}
function backToList() { version += 1; selectedId.value = ''; detail.value = null; }
async function openRecords(id: string) {
  version += 1; const revision = version; selectedId.value = id; detail.value = null; busy.value = 'records'; error.value = '';
  try { const result = await requestLocalService<OutreachView>(url(id)); if (!disposed && version === revision) detail.value = result; }
  catch (failure) { if (!disposed) { error.value = message(failure); selectedId.value = ''; } }
  finally { busy.value = ''; }
}
async function mutate(path: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown, success: string, key: string) {
  if (busy.value) return false;
  busy.value = key; version += 1; error.value = ''; notice.value = ''; dialogError.value = '';
  try {
    await requestLocalService(path, { method, ...(body === undefined ? {} : { body }) });
    if (disposed) return false;
    notice.value = success;
    return true;
  } catch (failure) { if (!disposed) { if (key === 'save') dialogError.value = message(failure); else error.value = message(failure); } return false; }
  finally { busy.value = ''; }
}
async function save() {
  if (draft.value.enabled && !await confirmOperation({title: '确认保存并启用任务', message: '保存后将按计划抓取首页 Post，调用 AI 筛选用户，并执行关注和回复。是否继续？'})) return;
  const saved = await mutate(editingId.value ? url(editingId.value) : '/api/outreach/accounts', editingId.value ? 'PUT' : 'POST', { ...draft.value }, '互关账户已保存', 'save');
  if (saved) { dialogOpen.value = false; await load(); }
}
async function toggle(id: string, enabled: boolean) {
  if (enabled && !await confirmOperation({title: '确认启用任务', message: '启用后将按计划抓取首页 Post，调用 AI 筛选用户，并执行关注和回复。是否继续？'})) return;
  if (await mutate(`${url(id)}/enabled`, 'PUT', { enabled }, enabled ? '此账户已启用' : '此账户已暂停自动任务', `toggle:${id}`)) await load();
}
async function runAction(id: string, action: 'check' | 'check/stop' | 'resume') {
  if (action !== 'check/stop' && !await confirmOperation({title: action === 'check' ? '确认检查关注关系' : '确认恢复任务', message: action === 'check' ? '将向 X 请求列表内用户的最新关注关系。是否继续？' : '将恢复计划任务，包括内容抓取、AI 判断和后续关注、回复。是否继续？'})) return;
  const messages = { check: '已为此账户安排逐条检查，一小时内已检查过的记录会跳过', 'check/stop': '已停止此账户的批量检查', resume: '此账户已恢复请求，待确认的操作不会自动重发' };
  if (await mutate(`${url(id)}/${action}`, 'POST', undefined, messages[action], `${action}:${id}`)) await load();
}
async function remove(config: OutreachConfig) {
  if (!await confirmOperation({title: '确认移除互关账户', message: `移除互关账户“${config.name}”？将停止其待执行任务，保留历史联系记录，不会取消 X 上的关注。`})) return;
  if (await mutate(url(config.id), 'DELETE', undefined, '互关账户已移除；重新添加同一 X 账号可查看历史记录', `delete:${config.id}`)) await load();
}
async function poll() { await load(); if (!disposed) timer = setTimeout(poll, 2000); }
onMounted(() => { void poll(); });
onBeforeUnmount(() => { disposed = true; if (timer) clearTimeout(timer); });
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
