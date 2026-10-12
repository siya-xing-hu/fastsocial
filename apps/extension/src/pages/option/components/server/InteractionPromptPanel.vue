<template>
  <section class="settings-page">
    <header class="page-heading">
      <div>
        <h2>Prompt 模板</h2>
        <p class="subtitle">用于 AI 翻译、动作监听，以及关联账号的 Skill 写作参考。</p>
      </div>
      <ActionButton action="add" label="新建模板" :disabled="!settings || busyAction !== null" @click="create" />
    </header>
    <div class="instructions">
      <strong>使用说明</strong><span><code>{input}</code> 输入</span
      ><span><code>{reply}</code> 原帖</span
      ><span v-pre
        ><code>{{ _tl_ }}</code> 目标语言</span
      >
    </div>
    <p v-if="!settings" class="error">{{ settingsError || "模板读取失败" }}</p>
    <div v-else class="panel">
      <div class="panel-heading">
        <div class="toolbar">
          <button data-ui="choice" :title="s.label"
            v-for="s in scenes"
            :key="s.value"
            class="btn"
            :class="{ primary: filter === s.value }"
            :disabled="busyAction !== null"
            @click="changeFilter(s.value)"
          >
            {{ s.label }}
          </button>
        </div>
        <span class="muted">{{ visible.length }} 个模板</span>
      </div>
      <div class="prompt-workspace">
        <aside class="prompt-list">
          <button data-ui="choice" :title="p.name"
            v-for="p in visible"
            :key="p.id"
            class="prompt-item"
            :class="{ selected: draft.id === p.id }"
            :disabled="busyAction !== null"
            @click="select(p)"
          >
            <div class="flex justify-between gap-2">
              <strong>{{ p.name }}</strong
              ><span class="badge">{{
                p.scene === "post" ? "发帖" : "回复"
              }}</span>
            </div>
            <span class="muted">{{
              p.accountIds?.length
                ? `已选 ${p.accountIds.length} 个账号`
                : "未选择账号"
            }}</span>
          </button>
          <p v-if="!visible.length" class="empty">暂无模板</p>
        </aside>
        <fieldset class="panel-body" :disabled="busyAction !== null">
          <div class="flex justify-between mb-5">
            <strong class="text-sm">{{
              draft.id ? "编辑模板" : "新建模板"
            }}</strong
            ><span class="badge"
              >已选 {{ draft.accountIds?.length ?? 0 }} 个账号</span
            >
          </div>
          <div class="form-grid">
            <label class="field"
              >模板名称<input v-model="draft.name" class="input" /></label
            ><label class="field"
              >使用场景<select v-model="draft.scene" class="input">
                <option value="post">发帖</option>
                <option value="reply">回复</option>
              </select></label
            >
          </div>
          <label class="field mt-4"
            >Prompt 内容<textarea
              v-model="draft.prompt"
              class="input !min-h-44"
            />
          </label>
          <div class="field mt-4">
            <span>适用账号</span>
            <div class="account-choices">
              <label v-for="a in settings.accounts" :key="a.id" class="choice"
                ><input
                  v-model="draft.accountIds"
                  type="checkbox"
                  :value="a.id"
                /><span
                  >{{ a.name
                  }}<small class="muted block"
                    >@{{ a.username || "待补充" }}</small
                  ></span
                ></label
              >
            </div>
            <a
              v-if="!settings.accounts.length"
              class="text-blue-600"
              href="#server/accounts"
              >先添加账号</a
            >
          </div>
          <div class="footer-actions">
            <ActionButton action="delete" label="删除模板" v-if="draft.id" @click="remove" /><ActionButton action="up" label="置顶模板" v-if="draft.id" @click="moveTop" /><ActionButton action="save" label="保存模板" @click="save" />
          </div>
        </fieldset>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import ActionButton from "../../../../components/ui/ActionButton.vue";
import { computed, ref, watch } from "vue";
import type { InteractionPrompt } from "@fast-social/contracts";
import {
  emptyPromptDraft,
  promptToDraft,
  useServerAdminContext,
} from "../../use-server-admin";
import { reorderInteractionPrompts } from "../../interaction-prompt-order";
import { config, onInput } from "../../../../common/storage-config";
import { confirmOperation } from '../../../../components/ui/confirm-operation';
const {
  settings,
  settingsError,
  busyAction,
  savePromptDraft,
  removePrompt,
  savePrompts,
} = useServerAdminContext();
const scenes = [
  { value: "all", label: "全部" },
  { value: "post", label: "发帖" },
  { value: "reply", label: "回复" },
] as const;
const filter = ref<"all" | "post" | "reply">("all"),
  draft = ref(emptyPromptDraft());
const visible = computed(
  () =>
    settings.value?.interactionPrompts.filter(
      (p) => filter.value === "all" || p.scene === filter.value
    ) ?? []
);
function select(p: InteractionPrompt) {
  draft.value = promptToDraft(p);
}
function create() {
  draft.value = emptyPromptDraft();
}
function changeFilter(value: typeof filter.value) {
  filter.value = value;
  if (!visible.value.some((p) => p.id === draft.value.id)) {
    const first = visible.value[0];
    first ? select(first) : create();
  }
}
watch(
  () => settings.value?.interactionPrompts,
  (ps) => {
    if (!draft.value.id && !draft.value.name && !draft.value.prompt && ps?.length)
      select(ps[0]);
  },
  { immediate: true }
);
async function save() {
  const id = draft.value.id;
  if (await savePromptDraft(draft.value)) {
    const p = id
      ? settings.value?.interactionPrompts.find((p) => p.id === id)
      : settings.value?.interactionPrompts[
          settings.value.interactionPrompts.length - 1
        ];
    if (p) {
      select(p);
      filter.value = "all";
      if (config.value.translationService.promptId === p.id) {
        config.value.translationService.translatePrompt = p.prompt;
        config.value.translationService.promptName = p.name;
        onInput();
      }
    }
  }
}
async function remove() {
  if (
    (await confirmOperation({title: '确认删除模板', message: '删除模板及其账号关联？'})) &&
    (await removePrompt(draft.value.id))
  ) {
    const p = visible.value[0];
    p ? select(p) : create();
  }
}
async function moveTop() {
  if (!settings.value) return;
  const old = settings.value.interactionPrompts;
  settings.value.interactionPrompts = reorderInteractionPrompts(
    old,
    draft.value.id,
    "top"
  );
  if (!(await savePrompts())) settings.value.interactionPrompts = old;
}
</script>
<style scoped>
.instructions {
  display: flex;
  align-items: center;
  gap: 22px;
  flex-wrap: wrap;
  border: 1px solid #e3e7ef;
  border-radius: 8px;
  padding: 13px 16px;
  font-size: 11px;
  color: #7d889a;
  background: #f9faff;
}
.instructions strong {
  color: #475366;
}
.prompt-workspace {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
}
.prompt-list {
  border-right: 1px solid #e7eaf0;
  padding: 8px;
}
.prompt-item {
  width: 100%;
  text-align: left;
  padding: 14px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 12px;
}
.prompt-item.selected {
  background: #f1f5ff;
  border-color: #dbe3f7;
}
.prompt-item .muted {
  display: block;
  font-size: 10px;
  margin-top: 7px;
}
@media (max-width: 850px) {
  .prompt-workspace {
    grid-template-columns: 1fr;
  }
  .prompt-list {
    display: flex;
    overflow: auto;
    border-right: 0;
    border-bottom: 1px solid #e7eaf0;
  }
  .prompt-item {
    min-width: 170px;
  }
}
</style>
