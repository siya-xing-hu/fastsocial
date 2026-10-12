<template>
  <section class="settings-page">
    <header class="page-heading">
      <div>
        <h2>账号设置</h2>
        <p class="subtitle">管理账号身份、Profile、每日额度与自动翻译。</p>
      </div>
      <ActionButton action="add" label="添加账号" :disabled="!settings || busyAction !== null" @click="edit()" />
    </header>
    <p v-if="!settings" class="error">
      {{ settingsError || "配置读取失败，请重试。" }}
    </p>
    <article v-else class="panel">
      <div class="panel-heading">
        账号列表
        <span class="muted">{{ settings.accounts.length }} 个账号</span>
      </div>
      <div v-if="!settings.accounts.length" class="empty">
        添加账号，设置 Profile，并选择是否自动翻译。
      </div>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>账号</th>
            <th>平台</th>
            <th>Cookie</th>
            <th>自动翻译</th>
            <th class="right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in settings.accounts" :key="a.id">
            <td>
              <strong>{{ a.name }}</strong>
              <div class="muted">
                {{ a.username ? "@" + a.username : "待补充用户名" }}
              </div>
            </td>
            <td>X / Twitter</td>
            <td>
              <span class="badge">{{
                a.status === "invalid"
                  ? "已失效"
                  : a.status === "valid"
                  ? "已验证"
                  : a.cookieConfigured
                  ? "已配置"
                  : "未配置"
              }}</span>
            </td>
            <td><ToggleSwitch :model-value="a.autoTranslate ?? a.configIds.includes('auto-translate')" :label="`${a.name} 自动翻译`" :disabled="busyAction !== null" @update:model-value="setAccountAutoTranslate(a.id, $event)" /></td>
            <td class="right">
              <div class="toolbar justify-end">
                <ActionButton action="test" :label="`测试 ${a.name} 的首页 Post`" :disabled="busyAction !== null || !a.cookieConfigured" @click="testAccountHome(a)" :loading="busyAction === `test:account:${a.id}`" />
                <ActionButton action="edit" :label="`编辑 ${a.name}`" :disabled="busyAction !== null" @click="edit(a)" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
    <OptionDialog
      :open="open"
      :title="id ? '编辑账号' : '添加账号'"
      :close-disabled="busyAction !== null"
      @close="close"
    >
      <fieldset class="settings-page space-y-4" :disabled="busyAction !== null">
        <div class="form-grid">
          <label class="field"
            >账号名称<input
              v-model="draft.name"
              class="input"
              placeholder="海外交流" /></label
          ><label class="field"
            >平台<select class="input">
              <option>X / Twitter</option>
            </select></label
          >
        </div>
        <label class="field"
          >账号用户名<input
            v-model="draft.username"
            class="input"
            placeholder="@username"
            autocomplete="off"
        /></label>
        <label class="field"
          >Cookie<textarea
            v-model="cookie"
            class="input font-mono"
            :placeholder="
              id
                ? '已配置；留空保留原 Cookie'
                : 'auth_token=...; ct0=...; twid=...'
            "
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <section class="account-profile">
          <div class="profile-heading"><strong>每日请求额度</strong><span class="muted">北京时间 00:00 重置</span></div>
          <div class="form-grid">
            <label v-for="action in ACCOUNT_REQUEST_ACTIONS" :key="action" class="field">
              <span class="quota-heading"><span>{{ ACCOUNT_REQUEST_LABELS[action] }}</span><small class="muted">{{ usage ? `今日已用 ${usage.used[action]}` : usageError ? '用量不可用' : id ? '用量读取中…' : '今日已用 0' }}</small></span>
              <input v-model.number="dailyLimits[action]" class="input" type="number" min="0" max="100000" step="1" />
            </label>
          </div>
          <p class="muted">0 表示禁止。抓取每页计一次请求；同一账号的所有任务、测试和画像更新共用额度，已发出的失败请求也计数。</p>
          <p v-if="usageError" class="error">{{ usageError }}</p>
        </section>
        <section class="account-profile">
          <div class="profile-heading"><strong>账号 Profile</strong><span class="muted">供聊天和动作监听共同使用</span></div>
          <label class="field">主语言<input v-model="profile.primaryLanguage" class="input" placeholder="如：简体中文、English、日本語" maxlength="80" /><small class="muted">发帖与回复的默认语言；监听回复始终使用该语言。</small></label>
          <label class="field">Profile<textarea v-model="profile.description" class="input profile-description" rows="8" maxlength="12000" placeholder="身份与受众：账号定位、真实背景、主要话题、面向谁交流。&#10;&#10;表达习惯：语气、篇幅、分段、标点、表情及标签习惯。&#10;&#10;表达边界：不编造的经历、不做出的承诺、不使用的措辞。&#10;&#10;其他说明：这个账号希望长期保持的特点。" /><small class="muted">任务回复要素可调整本次表达重点，身份事实与表达边界持续生效。</small></label>
        </section>
      </fieldset>
      <template #footer
        ><div class="settings-page flex justify-between">
          <ActionButton action="delete" label="删除账号" v-if="id" :disabled="busyAction !== null" @click="remove" />
          <div class="toolbar ml-auto">
            <ActionButton action="cancel" label="取消" :disabled="busyAction !== null" @click="close" /><ActionButton action="save" label="保存账号" :disabled="busyAction !== null" @click="save" :loading="busyAction === 'configuration'" />
          </div>
        </div></template
      >
    </OptionDialog>
  </section>
</template>
<script setup lang="ts">
import ActionButton from "../../../../components/ui/ActionButton.vue";
import ToggleSwitch from "../../../../components/ui/ToggleSwitch.vue";
import { confirmOperation } from '../../../../components/ui/confirm-operation';
import { ref } from "vue";
import { ACCOUNT_REQUEST_ACTIONS, ACCOUNT_REQUEST_LABELS, DEFAULT_ACCOUNT_DAILY_LIMITS,
  type AccountInput, type ManagedAccount, type ManagedAccountProfile, type AccountRequestUsage } from "@fast-social/contracts";
import { requestLocalService } from '../../../../common/local-service';
import OptionDialog from "../OptionDialog.vue";
import { useServerAdminContext } from "../../use-server-admin";
const { settings, settingsError, busyAction, saveAccount, removeAccount, setAccountAutoTranslate, testAccountHome } =
  useServerAdminContext();
const open = ref(false),
  id = ref(""),
  cookie = ref("");
const draft = ref<AccountInput>({ name: "", username: "" });
const profile = ref<ManagedAccountProfile>({ primaryLanguage: 'zh-CN', description: '' });
const dailyLimits = ref({ ...DEFAULT_ACCOUNT_DAILY_LIMITS });
const usage = ref<AccountRequestUsage | null>(null), usageError = ref('');
function edit(a?: ManagedAccount) {
  id.value = a?.id ?? "";
  cookie.value = "";
  profile.value = a?.profile ? { ...a.profile } : { primaryLanguage: a?.assistant?.language || 'zh-CN', description: a?.assistant?.voice || '' };
  dailyLimits.value = { ...(a?.dailyLimits ?? DEFAULT_ACCOUNT_DAILY_LIMITS) };
  usage.value = null; usageError.value = '';
  if (a) void loadUsage(a.id);
  draft.value = {
    name: a?.name ?? "",
    username: a?.username ?? "",
  };
  open.value = true;
}
async function loadUsage(accountId: string) {
  try {
    const result = await requestLocalService<AccountRequestUsage>(`/api/accounts/${accountId}/usage`);
    if (id.value === accountId) usage.value = result;
  } catch (e) { if (id.value === accountId) usageError.value = e instanceof Error ? e.message : String(e); }
}
function close() {
  if (busyAction.value === null) {
    open.value = false;
    cookie.value = "";
  }
}
async function save() {
  if (
    await saveAccount(
      {
        ...draft.value,
        profile: { ...profile.value },
        dailyLimits: { ...dailyLimits.value },
        ...(cookie.value.trim() ? { cookie: cookie.value.trim() } : {}),
      },
      id.value || undefined
    )
  )
    close();
}
async function remove() {
  if (
    (await confirmOperation({title: '确认删除账号', message: '删除账号及其 Profile？'})) &&
    (await removeAccount(id.value))
  )
    close();
}
</script>

<style scoped>
.account-profile {
  display: grid;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #e8edf4;
}
.profile-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px}
.profile-description{min-height:190px;line-height:1.7}
.quota-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
</style>
