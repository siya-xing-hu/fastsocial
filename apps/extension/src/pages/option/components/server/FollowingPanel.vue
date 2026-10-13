<template>
  <section class="settings-page">
    <header class="page-heading">
      <div><h2>关注列表</h2><p class="subtitle">按账号管理关注，了解对方在分享什么。</p></div>
      <ActionButton action="add" label="添加关注" :disabled="!accounts.length || busy" @click="openAdd()" />
    </header>
    <div v-if="!accounts.length" class="panel empty">先在账号设置中添加包含 twid 的 X 账号。</div>
    <template v-else>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <article class="panel">
        <div class="panel-heading following-filters gap-3">
          <select v-model="accountId" class="input following-account-filter" aria-label="筛选我的账号" :disabled="busy">
            <option value="">全部账号</option>
            <option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.name }} · @{{ account.username }}</option>
          </select>
          <input v-model="search" class="input following-search" aria-label="搜索关注用户" placeholder="搜索名称、用户名或画像" maxlength="200" />
          <span class="muted ml-auto whitespace-nowrap">{{ entries.length }} 条记录</span>
          <ActionButton action="refresh" label="刷新关注列表" :loading="loading" :disabled="busy" @click="load" />
        </div>
        <div v-if="loading && !entries.length" class="empty">读取关注列表中…</div>
        <div v-else-if="!entries.length" class="empty">{{ search ? '没有匹配的用户。' : '暂无记录。插件关注成功后会自动收录，也可以手动添加。' }}</div>
        <div v-else class="overflow-auto">
          <table class="data-table following-table">
            <thead><tr><th>用户</th><th>我的账号</th><th>AI 画像</th><th>关注状态</th><th class="right">操作</th></tr></thead>
            <tbody><tr v-for="entry in pageEntries" :key="entryKey(entry)">
              <td>
                <a :href="`https://x.com/${entry.user.username}`" target="_blank" rel="noopener noreferrer"><strong>{{ entry.user.name || entry.user.username }}</strong><div class="muted mt-1">@{{ entry.user.username }}</div></a>
                <div class="muted mt-1">{{ sourceLabels[entry.source] }}<template v-if="entry.followedAt"> · {{ date(entry.followedAt) }}</template></div>
              </td>
              <td class="whitespace-nowrap">{{ entry.account.name }}<div class="muted mt-1">@{{ entry.account.username }}</div></td>
              <td class="portrait-cell">
                <p v-if="entry.summary" class="portrait-excerpt">{{ entry.summary }}</p>
                <p v-if="entry.summaryStatus !== 'done'" :class="entry.summaryStatus === 'failed' ? 'text-red-600 text-xs' : 'muted'">{{ summaryLabels[entry.summaryStatus] }}</p>
                <p v-else-if="!entry.summary" class="muted">暂无画像</p>
              </td>
              <td><span :class="entry.status === 'following' ? 'text-emerald-600' : entry.status === 'uncertain' ? 'text-amber-600' : 'muted'">{{ statusLabels[entry.status] }}</span>
                <div v-if="entry.status === 'following' && entry.followedBy" class="muted mt-1">互相关注</div>
                <p v-if="entry.error" class="text-red-600 text-xs mt-1 max-w-xs">{{ entry.error }}</p>
              </td>
              <td><div class="toolbar justify-end">
                <ActionButton action="refresh" :label="`核对 @${entry.user.username} 的关注关系`" :disabled="busy || entry.status === 'pending'" @click="refreshRelation(entry)" />
                <ActionButton action="profile" :label="`查看 @${entry.user.username} 的用户画像`" @click="detailId = entryKey(entry)" />
                <ActionButton v-if="entry.status === 'following'" action="unfollow" :label="`取消关注 @${entry.user.username}`" :disabled="busy" @click="removeEntry = entry" />
                <ActionButton v-else-if="entry.status === 'not_following'" action="follow" :label="`关注 @${entry.user.username}`" :disabled="busy" @click="openAdd(entry.user.username, entry.account.id)" />
              </div></td>
            </tr></tbody>
          </table>
        </div>
        <footer v-if="entries.length" class="following-pagination">
          <span class="muted" role="status">第 {{ (page - 1) * pageSize + 1 }}–{{ Math.min(page * pageSize, entries.length) }} 条，共 {{ entries.length }} 条</span>
          <div class="toolbar">
            <select v-model.number="pageSize" class="input following-page-size" aria-label="每页记录数" :disabled="busy">
              <option :value="20">20 条 / 页</option>
              <option :value="50">50 条 / 页</option>
              <option :value="100">100 条 / 页</option>
            </select>
            <ActionButton action="previous" label="上一页" :disabled="busy || page <= 1" @click="page--" />
            <span class="muted whitespace-nowrap" aria-label="当前页码">{{ page }} / {{ pageCount }}</span>
            <ActionButton action="next" label="下一页" :disabled="busy || page >= pageCount" @click="page++" />
          </div>
        </footer>
      </article>
    </template>
    <OptionDialog :open="adding" title="添加关注" :close-disabled="busy" @close="adding = false">
      <label class="field mb-3">使用账号<select v-model="addAccountId" class="input" :disabled="busy">
        <option disabled value="">选择执行账号</option>
        <option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.name }} · @{{ account.username }}</option>
      </select></label>
      <label class="field">X 用户名<input v-model="username" class="input" placeholder="@username" :disabled="busy" @keydown.enter="add" /></label>
      <p v-if="dialogError" class="error mt-3">{{ dialogError }}</p>
      <template #footer><div class="toolbar justify-end"><ActionButton action="cancel" label="取消" :disabled="busy" @click="adding = false" /><ActionButton action="follow" label="关注用户" :loading="busy" :disabled="!addAccountId || !username.trim()" @click="add" /></div></template>
    </OptionDialog>
    <OptionDialog :open="!!removeEntry" title="取消关注" :close-disabled="busy" @close="removeEntry = null">
      <p>使用「{{ removeEntry?.account.name }} · @{{ removeEntry?.account.username }}」读取最新 Profile 并取消关注 @{{ removeEntry?.user.username }}？</p><p class="muted mt-2">本地用户信息和画像会保留。</p>
      <p v-if="dialogError" class="error mt-3">{{ dialogError }}</p>
      <template #footer><div class="toolbar justify-end"><ActionButton action="cancel" label="返回" :disabled="busy" @click="removeEntry = null" /><ActionButton action="unfollow" label="取消关注" :loading="busy" @click="unfollow" /></div></template>
    </OptionDialog>
    <UserPortraitDialog v-if="detail" v-model="summaryText" :open="!!detailId" :user="detail.user"
      :evidence="detail.summaryEvidence ?? []" :busy="busy" :updating="summarySubmitting === entryKey(detail) || summaryPending(detail)"
      :saving="summarySaving" :can-save="summaryText !== detail.summary" :error="summaryRequestError || detail.summaryError || ''"
      @close="detailId = ''" @refresh="updateSummary(detail)" @save="saveSummary(detail)" />
  </section>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { FollowingEntry, ManagedAccount } from '@fast-social/contracts';
import ActionButton from '../../../../components/ui/ActionButton.vue';
import { confirmOperation } from '../../../../components/ui/confirm-operation';
import OptionDialog from '../OptionDialog.vue';
import UserPortraitDialog from './UserPortraitDialog.vue';
import { requestLocalService } from '../../../../common/local-service';
import { useServerAdminContext } from '../../use-server-admin';
const { settings, showNotice } = useServerAdminContext();
type FollowingRow = FollowingEntry & { account: Pick<ManagedAccount, 'id' | 'name' | 'username'> };
const accounts = computed(() => settings.value?.accounts?.filter(a => a.actorId) ?? []);
const accountId = ref(''), search = ref(''), entries = ref<FollowingRow[]>([]), loading = ref(false), busy = ref(false), error = ref('');
const page = ref(1), pageSize = ref(20);
const pageCount = computed(() => Math.max(1, Math.ceil(entries.value.length / pageSize.value)));
const pageEntries = computed(() => entries.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
watch(pageSize, () => { page.value = 1; });
watch(pageCount, count => { page.value = Math.min(page.value, count); });
const adding = ref(false), addAccountId = ref(''), username = ref(''), dialogError = ref(''), removeEntry = ref<FollowingRow|null>(null), detailId = ref('');
const entryKey = (entry: FollowingRow) => `${entry.account.id}:${entry.id}`;
const detail = computed(() => entries.value.find(entry => entryKey(entry) === detailId.value));
const summarySubmitting = ref(''), summaryRequestError = ref('');
const summaryText = ref(''), summaryBaseline = ref(''), summarySaving = ref(false), refreshDraft = ref('');
const summaryPending = (entry: FollowingRow) => entry.summaryStatus === 'pending' || entry.summaryStatus === 'running';
const statusLabels = { following: '已关注', not_following: '未关注', pending: '处理中', uncertain: '待核对' };
const summaryLabels = { pending: '画像待生成', running: 'AI 正在生成画像…', failed: '画像生成失败，可查看详情后重试', done: '暂无画像' };
const sourceLabels = { manual: '手动添加', workflow: '动作监听', history: '历史记录' };
let timer: ReturnType<typeof setTimeout> | undefined, searchTimer: ReturnType<typeof setTimeout> | undefined, generation = 0, disposed = false;
const base = (owner: string) => `/api/accounts/${encodeURIComponent(owner)}/following`;
function date(value: string) { return new Date(value).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }
async function load() {
  clearTimeout(timer); clearTimeout(searchTimer); const current = ++generation;
  const owners = accounts.value.filter(account => !accountId.value || account.id === accountId.value);
  if (!owners.length) { entries.value = []; loading.value = false; return; }
  loading.value = true;
  const query = encodeURIComponent(search.value.trim());
  try {
    const results = await Promise.all(owners.map(async ({id, name, username}) => {
      const result = await requestLocalService<FollowingEntry[]>(`${base(id)}?q=${query}`);
      return result.map(entry => ({...entry, account: {id, name, username}}));
    }));
    if (current === generation && !disposed) {
      entries.value = results.flat().sort((a, b) => (b.followedAt || b.updatedAt).localeCompare(a.followedAt || a.updatedAt) || entryKey(a).localeCompare(entryKey(b)));
      error.value = '';
    }
  } catch (e) { if (current === generation && !disposed) error.value = e instanceof Error ? e.message : String(e); }
  finally { if (current === generation && !disposed) { loading.value = false; timer = setTimeout(load, entries.value.some(e => ['pending','running'].includes(e.summaryStatus) || e.status === 'pending') ? 2000 : 5000); } }
}
watch([accounts, accountId], () => {
  if (accountId.value && !accounts.value.some(a => a.id === accountId.value)) { accountId.value = ''; return; }
  generation++; page.value = 1; entries.value = []; detailId.value = ''; removeEntry.value = null; adding.value = false; error.value = ''; void load();
}, {immediate:true});
watch(search, () => { generation++; page.value = 1; clearTimeout(timer); clearTimeout(searchTimer); searchTimer = setTimeout(load, 250); });
watch(removeEntry, () => { dialogError.value = ''; });
watch(() => [detailId.value, detail.value?.summary, detail.value?.summaryStatus] as const, ([id, text, status], [previousId]) => {
  if (id !== previousId) { summaryText.value = text ?? ''; summaryRequestError.value = ''; refreshDraft.value = ''; }
  else if (summaryText.value === summaryBaseline.value || (refreshDraft.value === id && status === 'done')) summaryText.value = text ?? '';
  summaryBaseline.value = text ?? '';
  if (status === 'done' || status === 'failed') refreshDraft.value = '';
});
onUnmounted(() => { disposed = true; generation++; clearTimeout(timer); clearTimeout(searchTimer); });
function openAdd(value = '', owner = accountId.value) {
  username.value = value; addAccountId.value = owner || (accounts.value.length === 1 ? accounts.value[0].id : '');
  dialogError.value = ''; adding.value = true;
}
async function add() {
  if (busy.value || !username.value.trim() || !accounts.value.some(a => a.id === addAccountId.value)) return;
  const owner = accounts.value.find(a => a.id === addAccountId.value)!;
  const target = username.value.trim();
  if (!await confirmOperation({title: '确认添加关注', message: `使用「${owner.name} · @${owner.username}」读取 ${target} 的 Profile 并关注，随后抓取近期 Post 并调用 AI 生成画像。是否继续？`})) return;
  if (busy.value) return;
  busy.value = true; dialogError.value = '';
  try { await requestLocalService(base(owner.id), {method:'POST',body:{username:target}}); adding.value = false; showNotice('已关注，画像将在后台生成'); }
  catch (e) { dialogError.value = e instanceof Error ? e.message : String(e); }
  finally { busy.value = false; await load(); }
}
async function unfollow() {
  if (!removeEntry.value || busy.value) return;
  busy.value = true; dialogError.value = '';
  try { await requestLocalService(`${base(removeEntry.value.account.id)}/${removeEntry.value.id}/unfollow`, {method:'POST'}); removeEntry.value = null; showNotice('已取消关注'); }
  catch (e) { dialogError.value = e instanceof Error ? e.message : String(e); }
  finally { busy.value = false; await load(); }
}
async function action(entry: FollowingRow, operation: 'refresh'|'summary') {
  if (busy.value || (operation === 'summary' && summaryPending(entry))) return;
  if (!await confirmOperation({title: operation === 'summary' ? '确认更新画像' : '确认核对关注关系', message: operation === 'summary'
    ? `使用「${entry.account.name} · @${entry.account.username}」读取 @${entry.user.username} 的 Profile 和近期 Post，调用 AI 重新生成画像。是否继续？`
    : `使用「${entry.account.name} · @${entry.account.username}」读取 @${entry.user.username} 的最新 Profile，核对关注关系。是否继续？`})) return;
  if (busy.value || (operation === 'summary' && (detailId.value !== entryKey(entry) || !detail.value || summaryPending(detail.value)))) return;
  busy.value = true; error.value = '';
  if (operation === 'summary') { summarySubmitting.value = entryKey(entry); summaryRequestError.value = ''; }
  try {
    await requestLocalService(`${base(entry.account.id)}/${entry.id}/${operation}`, {method:'POST'});
    if (operation === 'summary') refreshDraft.value = entryKey(entry);
    await load();
  }
  catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (operation === 'summary' && detailId.value === entryKey(entry)) summaryRequestError.value = message;
    else error.value = message;
  }
  finally { busy.value = false; if (operation === 'summary') summarySubmitting.value = ''; }
}
async function saveSummary(entry: FollowingRow) {
  if (busy.value || summaryPending(entry)) return;
  busy.value = true; summarySaving.value = true; summaryRequestError.value = '';
  const text = summaryText.value;
  try {
    const saved = await requestLocalService<FollowingEntry>(`${base(entry.account.id)}/${entry.id}/summary`, {method: 'PUT', body: {text}});
    generation++;
    entries.value = entries.value.map(row => entryKey(row) === entryKey(entry) ? {...saved, account: entry.account} : row);
    summaryText.value = summaryBaseline.value = saved.summary;
    showNotice('画像已保存');
    await load();
  } catch (e) { summaryRequestError.value = e instanceof Error ? e.message : String(e); }
  finally { busy.value = false; summarySaving.value = false; }
}
const refreshRelation = (entry: FollowingRow) => action(entry, 'refresh');
const updateSummary = (entry: FollowingRow) => action(entry, 'summary');
</script>
<style scoped>
.following-filters { flex-wrap:wrap; }
.following-account-filter { width:auto; max-width:100%; font-weight:400; }
.following-search { flex:1; min-width:180px; max-width:340px; font-weight:400; }
.following-table { min-width:860px; }
.following-pagination { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:12px 18px; border-top:1px solid #e8edf5; }
.following-page-size { width:auto; }
.portrait-cell { width:34%; max-width:420px; }
.portrait-excerpt { font-size:12px; line-height:1.7; white-space:pre-line; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
</style>
