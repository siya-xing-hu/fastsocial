<template>
  <section class="settings-page">
    <header class="page-heading">
      <div>
        <h2>动作监听</h2>
        <p class="subtitle">监听 Post，判断条件，再按顺序执行动作。</p>
      </div>
      <ActionButton action="add" label="新建编排" v-if="!draft" :disabled="busy || !settings" @click="edit()" /><ActionButton action="back" label="返回列表" v-else :disabled="busy" @click="draft = null" />
    </header>
    <div v-if="error" class="error">{{ error }}</div>
    <template v-if="!draft">
      <p v-if="loading" class="empty">读取编排中…</p>
      <article v-else class="panel">
        <div class="panel-heading">
          监听编排
          <ActionButton action="refresh" label="刷新编排" :disabled="busy" @click="load" :loading="loading" />
        </div>
        <div v-if="!workflows.length" class="empty">
          创建编排，选择监听范围和命中后的动作。
        </div>
        <div v-else class="overflow-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>编排</th>
                <th>监听范围</th>
                <th>动作顺序</th>
                <th>启用</th>
                <th class="right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="w in workflows" :key="w.id">
                <td>
                  <strong>{{ w.name }}</strong>
                  <div class="muted mt-1">
                    {{ accountName(w.accountId) }} · 每
                    {{ w.intervalMinutes }} 分钟 ·
                    <span class="inline-block">上次执行：{{ lastExecutionTime(w) }}</span>
                  </div>
                  <div v-if="runs[w.id]" class="text-xs mt-1 max-w-xs whitespace-pre-line" role="status"
                    :class="runs[w.id].status === 'failed' ? 'text-red-600' : runs[w.id].status === 'running' ? 'text-blue-600' : 'text-slate-500'">
                    {{ runMessage(runs[w.id]) }}
                  </div>
                  <div
                    v-if="w.lastError && !runs[w.id]"
                    class="text-red-600 text-xs mt-1 max-w-xs"
                  >
                    {{ w.lastError }}
                  </div>
                </td>
                <td>
                  {{
                    w.source === "home"
                      ? "账号首页"
                      : "指定用户"
                  }}
                  <div class="muted">
                    {{ w.usernames.map((u) => "@" + u).join(", ") }}
                  </div>
                </td>
                <td>
                  <span v-for="(a, i) in w.actions" :key="i" class="text-xs"
                    >{{ i ? " → " : "" }}{{ labels[a.type] }}</span
                  >
                  <span v-if="!w.actions.length" class="muted">未添加动作</span>
                </td>
                <td>
                  <ToggleSwitch
                    :model-value="w.enabled"
                    :label="`启用 ${w.name}`"
                    :disabled="busy || !w.actions.length"
                    @update:model-value="toggle(w, $event)"
                  />
                </td>
                <td>
                  <div class="toolbar justify-end">
                    <ActionButton :action="needsRetry(w) ? 'retry' : 'run'" :label="`${needsRetry(w) ? '恢复本轮任务' : '立刻执行一次'} ${w.name}`" :disabled="busy || !w.actions.length || runs[w.id]?.status === 'running'" @click="needsRetry(w) ? retry(w) : runOnce(w)" :loading="runs[w.id]?.status === 'running'" />
                    <ActionButton v-if="w.source === 'user'" action="profile" :label="`查看 @${w.usernames[0]} 的画像`" :disabled="busy" @click="openProfile(w)" />
                    <ActionButton action="edit" :label="`编辑 ${w.name}`" :disabled="busy" @click="edit(w)" /><ActionButton action="details" :label="`查看 ${w.name} 的执行记录`" :disabled="busy" @click="inspect(w)" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </template>
    <fieldset v-else :disabled="busy">
      <article class="panel">
        <div class="panel-heading">
          基本信息<ToggleSwitch
            v-model="draft.enabled"
            label="启用编排"
            :disabled="busy || !draft.actions.length"
          />
        </div>
        <div class="panel-body form-grid workflow-basics">
          <label class="field"
            >编排名称<input
              v-model="draft.name"
              class="input"
              placeholder="产品发布通知" /></label
          ><label class="field"
            >执行账号<select v-model="draft.accountId" class="input">
              <option :value="RANDOM_WORKFLOW_ACCOUNT" :disabled="draft.source === 'home'">随机账号{{ draft.source === 'home' ? '（首页需指定账号）' : '' }}</option>
              <option v-for="a in settings?.accounts" :key="a.id" :value="a.id">
                {{ a.name }}
              </option>
            </select></label
          ><label class="field"
            >监听间隔（分钟）<input
              v-model.number="draft.intervalMinutes"
              class="input"
              type="number"
              min="1"
              max="1440"
          /></label>
        </div>
      </article>
      <article class="panel">
        <div class="panel-heading">1 · 监听范围</div>
        <div class="panel-body form-grid">
          <label class="field"
            >来源<select v-model="draft.source" class="input">
              <option value="user">指定用户</option>
              <option value="home">账号首页</option>
            </select></label
          ><label v-if="draft.source !== 'home'" class="field"
            >目标用户<input
              v-model="usernames"
              class="input"
              placeholder="@username"
          /></label>
          <p v-else class="muted self-end pb-2">
            使用所选账号的首页，监听其中不同用户的 Post。
          </p>
        </div>
      </article>
      <article class="panel">
        <div class="panel-heading">2 · 判断条件</div>
        <div class="panel-body">
          <label class="field"
            >AI 判断 Prompt<textarea
              v-model="draft.condition"
              class="input"
              placeholder="例如：当用户发布新产品或开放试用时。若希望每条新帖都通知，可填写“所有新帖”。"
            />
          </label>
        </div>
      </article>
      <article class="panel">
        <div class="panel-heading">
          3 · 执行动作 <span class="muted">从上到下执行</span>
        </div>
        <div class="panel-body space-y-3">
          <p v-if="!draft.actions.length" class="muted">从下方添加动作，可按需组合并调整顺序。</p>
          <div v-for="(a, i) in draft.actions" :key="i" class="action-editor">
            <div class="flex items-center justify-between gap-3 mb-3">
              <strong class="text-sm"
                >{{ i + 1 }} · {{ labels[a.type] }}</strong
              >
              <div class="toolbar">
                <ActionButton action="up" label="上移动作" :disabled="i === 0" @click="move(i, -1)" /><ActionButton action="down" label="下移动作" :disabled="i === draft.actions.length - 1" @click="move(i, 1)" /><ActionButton action="delete" label="删除动作" @click="removeAction(i)" />
              </div>
            </div>
            <p v-if="a.type === 'follow'" class="muted">
              关注命中 Post 的作者。
            </p>
            <label v-if="a.type === 'notify'" class="field"
              >Telegram 通知内容<input
                v-model="a.content"
                class="input"
                placeholder="消息标题或补充说明" /></label
            ><template v-if="a.type === 'reply'"
              ><div class="form-grid">
                <label class="field"
                  >回复方式<select
                    :value="a.mode"
                    class="input"
                    @change="
                      replyMode(i, ($event.target as HTMLSelectElement).value)
                    "
                  >
                    <option value="text">固定内容</option>
                    <option value="skill">使用回复 Skill</option>
                  </select></label
                ><label v-if="a.mode === 'text'" class="field"
                  >回复内容<input v-model="a.text" class="input" /></label
                ><p v-else-if="a.mode === 'skill'" class="muted self-end pb-2">使用本轮执行账号的 Profile 与主语言。</p>
              </div>
              <div v-if="a.mode === 'skill'" class="mt-3">
                <label class="field">回复要素（选填）<textarea v-model="a.elements" class="input" rows="3" maxlength="10000" placeholder="这次希望回应什么、补充哪些观点或提出什么问题。留空时，由原帖内容和账号 Profile 决定。" /><small class="muted">本次要素优先于默认表达偏好，账号身份与表达边界仍然生效。</small></label>
              </div></template
            >
          </div>
          <div class="action-additions">
            <ActionButton v-for="type in actionTypes" :key="type" :action="type" :label="`添加动作：${labels[type]}`" :disabled="draft.actions.length >= 10" @click="addAction(type)" />
          </div>
        </div>
      </article>
      <div class="footer-actions">
        <ActionButton action="delete" label="删除编排" v-if="draft.id" class="mr-auto" @click="remove" /><ActionButton action="save" label="保存编排" @click="save" :loading="busy" />
      </div>
    </fieldset>
    <OptionDialog
      :open="detailsOpen"
      :title="detailsTitle"
      @close="detailsOpen = false"
      ><div class="settings-page">
        <p v-if="!details.length" class="empty">暂无记录</p>
        <article v-for="(r, i) in details" :key="i" class="panel panel-body">
          <strong class="text-sm">{{ r.title }}</strong>
          <p class="text-xs whitespace-pre-wrap leading-6 mt-2">{{ r.text }}</p>
        </article>
      </div></OptionDialog
    >
    <UserPortraitDialog v-model="profileText" :open="profileOpen"
      :user="profileView?.profile?.account ?? { name: '', username: profileWorkflow?.usernames[0] ?? '', bio: '' }"
      :evidence="profileView?.evidence ?? []" :busy="busy" :updating="profileRefreshing" :saving="profileSaving"
      :can-save="!!profileView?.profile && profileText !== readProfileText(profileView)" :error="profileError"
      @close="profileOpen = false" @refresh="rebuildProfile" @save="saveProfile" />
  </section>
</template>
<script setup lang="ts">
import ActionButton from "../../../../components/ui/ActionButton.vue";
import { RANDOM_WORKFLOW_ACCOUNT, renderPrompt, replyElements } from '@fast-social/contracts';
import { onMounted, onUnmounted, ref } from "vue";
import type {
  Workflow,
  WorkflowAction,
  WorkflowInput,
  WorkflowRecord,
  WorkflowRun,
  WorkflowRetryPlan,
  AccountProfileView,
} from "@fast-social/contracts";
import ToggleSwitch from "../../../../components/ui/ToggleSwitch.vue";
import OptionDialog from "../OptionDialog.vue";
import UserPortraitDialog from "./UserPortraitDialog.vue";
import { requestLocalService } from "../../../../common/local-service";
import { confirmOperation } from '../../../../components/ui/confirm-operation';
import { useServerAdminContext } from "../../use-server-admin";
import { workflowRunMessage as runMessage } from '../../workflow-run-message';
const { settings, showNotice } = useServerAdminContext();
const workflows = ref<Workflow[]>([]),
  loading = ref(false),
  busy = ref(false),
  error = ref(""),
  draft = ref<(WorkflowInput & { id?: string }) | null>(null),
  usernames = ref("");
const actionTypes = ['follow', 'reply', 'notify'] as const;
const labels = { follow: "关注作者", reply: "回复 Post", notify: "发送通知" };
const detailsOpen = ref(false),
  detailsTitle = ref(""),
  details = ref<{ title: string; text: string }[]>([]);
const accountName = (id: string) =>
  id === RANDOM_WORKFLOW_ACCOUNT ? '随机账号' : settings.value?.accounts.find((a) => a.id === id)?.name ?? "账号已删除";
const runs = ref<Record<string, WorkflowRun>>({});
function lastExecutionTime(workflow: Workflow): string {
  const value = runs.value[workflow.id]?.finishedAt ?? workflow.lastCheckedAt;
  if (!value) return '尚未执行';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
const profileOpen = ref(false), profileWorkflow = ref<Workflow | null>(null), profileView = ref<AccountProfileView | null>(null), profileText = ref(''), profileError = ref('');
const profileRefreshing = ref(false), profileSaving = ref(false);
function readProfileText(view: AccountProfileView | null) {
  if (view?.profile?.portraitText !== undefined) return view.profile.portraitText;
  const labels = { background: '背景', topics: '主题', language: '用语', recent: '近况' };
  return (Object.keys(labels) as (keyof typeof labels)[]).flatMap(key => view?.profile?.memory[key] ? [`${labels[key]}：${view.profile.memory[key]!.text}`] : []).join('\n');
}
async function openProfile(w: Workflow) {
  await perform(async () => {
    profileView.value = await requestLocalService<AccountProfileView>(`/api/workflows/${w.id}/profile`);
    profileWorkflow.value = w; profileText.value = readProfileText(profileView.value); profileError.value = ''; profileOpen.value = true;
  });
}
async function saveProfile() {
  if (!profileWorkflow.value || busy.value) return;
  profileSaving.value = true; busy.value = true; profileError.value = '';
  try {
    profileView.value = await requestLocalService<AccountProfileView>(`/api/workflows/${profileWorkflow.value.id}/profile`, { method: 'PUT', body: { text: profileText.value } });
    profileText.value = readProfileText(profileView.value); showNotice('画像已保存');
  } catch (e) { profileError.value = e instanceof Error ? e.message : String(e); }
  finally { busy.value = false; profileSaving.value = false; }
}
async function rebuildProfile() {
  if (!profileWorkflow.value || busy.value) return;
  const workflow = profileWorkflow.value;
  if (!await confirmOperation({title: '确认更新画像', message: `使用「${accountName(workflow.accountId)}」抓取 @${workflow.usernames[0]} 的 Profile 和近期 Post，并调用 AI 重新构建画像。是否继续？`})) return;
  if (busy.value || !profileOpen.value || profileWorkflow.value?.id !== workflow.id) return;
  busy.value = true; profileRefreshing.value = true; profileError.value = '';
  try {
    profileView.value = await requestLocalService<AccountProfileView>(`/api/workflows/${workflow.id}/profile/refresh`, { method: 'POST' });
    profileText.value = readProfileText(profileView.value); showNotice('画像已重新构建');
  } catch (e) { profileError.value = e instanceof Error ? e.message : String(e); }
  finally { busy.value = false; profileRefreshing.value = false; }
}
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
function schedulePoll(delay = 2000) {
  clearTimeout(pollTimer);
  if (!disposed) pollTimer = setTimeout(pollRuns, Object.values(runs.value).some(run => run.status === "running") ? delay : 5000);
}
async function readRuns() {
  const result = await requestLocalService<WorkflowRun[]>("/api/workflows/runs");
  runs.value = Object.fromEntries(result.map(run => [run.workflowId, run]));
}
async function pollRuns() {
  if (disposed) return;
  try {
    const previous = Object.values(runs.value).filter(run => run.status === "running");
    await readRuns();
    if (previous.some(run => runs.value[run.workflowId]?.status !== "running")) {
      workflows.value = await requestLocalService("/api/workflows");
      if (previous.some(run => !runs.value[run.workflowId]))
        error.value = "执行状态已失效，服务可能已重启，请查看执行记录。";
    }
  } catch (e) {
    error.value = `读取执行状态失败：${e instanceof Error ? e.message : String(e)}。可刷新后查看。`;
  } finally {
    schedulePoll();
  }
}
async function runOnce(w: Workflow) {
  if (busy.value || !await confirmOperation({title: '确认立即执行', message: workflowEffect(w)})) return;
  if (busy.value || disposed || runs.value[w.id]?.status === 'running') return;
  await perform(async () => {
    const run = await requestLocalService<WorkflowRun>(`/api/workflows/${w.id}/run`, { method: "POST" });
    runs.value[w.id] = run;
    showNotice("已开始执行，可在记录中查看动作结果");
    schedulePoll();
  });
}
function needsRetry(w: Workflow) {
  return !!w.lastError || ['failed', 'cancelled'].includes(runs.value[w.id]?.status ?? '');
}
async function retry(w: Workflow) {
  if (busy.value || runs.value[w.id]?.status === 'running') return;
  busy.value = true;
  try {
    const plan = await requestLocalService<WorkflowRetryPlan>(`/api/workflows/${w.id}/retry`);
    const uncertain = plan.records.flatMap(r => r.actions.filter(a => a.status === 'uncertain' && a.type !== 'follow')
      .map(a => `${labels[a.type]} @${r.post.author}（Post ${r.post.id}）`));
    const remaining = plan.records.flatMap(r => r.actions.filter(a => a.status !== 'done' && a.status !== 'skipped'));
    const hasFollow = remaining.some(a => a.type === 'follow');
    const needsAIReply = w.actions.some(a => a.type === 'reply' && a.mode !== 'text')
      && remaining.some(a => a.type === 'reply' && !a.replyText);
    const message = plan.records.length
      ? `按本轮原执行账号（${[...new Set(plan.records.map(r => r.accountName || accountName(r.accountId || w.accountId)))].join('、')}）继续 ${plan.records.length} 条失败或未执行记录，跳过已完成动作。${hasFollow ? '失败的关注会先核对当前关系；未关注才重新发送。' : ''}${hasFollow || needsAIReply ? '尚未生成的回复或新关注画像可能调用 AI。' : ''}`
      : plan.analysisComplete ? '本轮动作已完成，将恢复完成状态和监听进度。' : workflowEffect(w);
    if (!await confirmOperation({ title: uncertain.length ? '核对未发送后重试' : '确认重试', message: [plan.run ? `继续原轮次：已扫描 ${plan.run.scanned} 条，AI 命中 ${plan.run.aiMatched} 条，已完成 ${plan.run.completed} 条。统计继续累计。` : '', message,
      uncertain.length ? `以下操作结果不确定：\n${uncertain.join('\n')}\n请先在 X 或通知端核对未发送。确认后将重新发送这些未确认动作；如果已经发送，请取消。` : '',
      plan.restoreEnabled ? '全部重试成功后恢复启用，继续按原间隔运行。' : '成功后清除失败状态，保持当前启用设置。',
    ].filter(Boolean).join('\n\n') })) return;
    if (disposed || runs.value[w.id]?.status === 'running') return;
    const run = await requestLocalService<WorkflowRun>(`/api/workflows/${w.id}/retry`, { method: 'POST', body: {
      runId: plan.run?.id, revision: plan.revision, configuration: plan.configuration, recordIds: plan.records.map(r => r.id), confirmUncertain: uncertain.length > 0, restoreEnabled: plan.restoreEnabled,
    } });
    runs.value[w.id] = run; error.value = '';
    showNotice('已开始恢复本轮任务'); schedulePoll();
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { busy.value = false; }
}
function workflowEffect(w: WorkflowInput) {
  return `使用「${accountName(w.accountId)}」抓取${w.source === 'home' ? '首页 Post' : ` @${w.usernames[0]} 的 Post`}，调用 AI 判断命中后执行：${w.actions.map(a => labels[a.type]).join(' → ') || '无动作'}。是否继续？`;
}
async function load() {
  loading.value = true;
  try {
    workflows.value = await requestLocalService("/api/workflows");
    await readRuns();
    schedulePoll();
    error.value = "";
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
onUnmounted(() => {
  disposed = true;
  clearTimeout(pollTimer);
});
function edit(w?: Workflow) {
  draft.value = w
    ? JSON.parse(JSON.stringify(w))
    : {
        name: "",
        accountId: RANDOM_WORKFLOW_ACCOUNT,
        source: "user",
        usernames: [],
        condition: "",
        intervalMinutes: 15,
        enabled: false,
        actions: [],
      };
  draft.value!.actions = draft.value!.actions.map(action => action.type === 'reply' && action.mode === 'prompt'
    ? { type: 'reply', mode: 'skill', elements: renderPrompt(settings.value?.interactionPrompts.find(p => p.id === action.promptId)?.prompt ?? '', { input: action.input, reply: '{reply}', targetLanguage: '{{_tl_}}' }) }
    : action.type === 'reply' && action.mode === 'skill' ? { type: 'reply', mode: 'skill', elements: replyElements(action) } : action);
  usernames.value = w?.usernames[0] ? '@' + w.usernames[0] : '';
  error.value = "";
}
async function perform(work: () => Promise<void>) {
  busy.value = true;
  error.value = "";
  try {
    await work();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
function input(): WorkflowInput {
  const d = draft.value!;
  return {
    ...d,
    usernames:
      d.source === "home"
        ? []
        : [usernames.value.trim().replace(/^@/, '')],
  };
}
async function save() {
  if (!draft.value || busy.value) return;
  if (draft.value.enabled && !await confirmOperation({title: '确认保存并启用编排', message: `保存后将按计划运行。\n${workflowEffect(input())}`})) return;
  await perform(async () => {
    const d = draft.value!;
    await requestLocalService(
      d.id ? `/api/workflows/${d.id}` : "/api/workflows",
      { method: d.id ? "PUT" : "POST", body: input() }
    );
    draft.value = null;
    await load();
    showNotice("编排已保存");
  });
}
async function toggle(w: Workflow, enabled: boolean) {
  if (busy.value || (enabled && !await confirmOperation({title: '确认启用编排', message: `启用后将按计划运行。\n${workflowEffect(w)}`}))) return;
  await perform(async () => {
    await requestLocalService(`/api/workflows/${w.id}`, {
      method: "PUT",
      body: { ...w, enabled },
    });
    await load();
  });
}
function addAction(type: WorkflowAction['type']) {
  draft.value?.actions.push(
    type === "follow"
      ? { type: "follow" }
      : type === "notify"
      ? { type: "notify", content: "" }
      : { type: "reply", mode: "skill", elements: "" }
  );
}
function move(i: number, dir: number) {
  const a = draft.value!.actions;
  [a[i], a[i + dir]] = [a[i + dir], a[i]];
}
function removeAction(i: number) {
  draft.value!.actions.splice(i, 1);
  if (!draft.value!.actions.length) draft.value!.enabled = false;
}
function replyMode(i: number, mode: string) {
  draft.value!.actions[i] =
    mode === "text"
      ? { type: "reply", mode: "text", text: "" }
      : {
          type: "reply",
          mode: "skill",
          elements: "",
        };
}
async function remove() {
  if (await confirmOperation({title: '确认删除编排', message: '删除此编排及执行记录？'}))
    await perform(async () => {
      await requestLocalService(`/api/workflows/${draft.value!.id}`, {
        method: "DELETE",
      });
      draft.value = null;
      await load();
    });
}
async function inspect(w: Workflow) {
  await perform(async () => {
    const result = await requestLocalService<WorkflowRecord[]>(
      `/api/workflows/${w.id}/records`
    );
    const status = {
      running: "执行中",
      done: "完成",
      failed: "失败",
      uncertain: "结果不确定",
      pending: "等待执行",
      skipped: "已跳过",
    };
    detailsTitle.value = w.name + " · 执行记录";
    details.value = result.map((r) => ({
      title: status[r.status] + " · @" + r.post.author + (r.accountName ? ` · 执行账号：${r.accountName}` : ''),
      text:
        r.post.text +
        "\n\n" +
        r.reason +
        "\n" +
        r.actions
          .map(
            (a) =>
              labels[a.type] +
              "：" +
              status[a.status] +
              (a.result ? " · " + a.result : "")
          )
          .join("\n"),
    }));
    detailsOpen.value = true;
  });
}
</script>
<style scoped>
.settings-page .workflow-basics{grid-template-columns:repeat(3,minmax(0,1fr))}
.action-additions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.action-additions :deep(.action-button){width:100%}
@media(max-width:700px){.settings-page .workflow-basics{grid-template-columns:1fr}.action-additions{gap:6px}}
.action-editor {
  border: 1px solid #e4e8ef;
  border-radius: 8px;
  padding: 14px;
  background: #fcfdff;
}
</style>
