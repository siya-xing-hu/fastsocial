<template>
  <section aria-labelledby="prompts-title">
    <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 id="prompts-title" class="text-2xl font-semibold tracking-tight text-slate-900">互动 Prompt</h2>
        <p class="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">定义 X 页面中 AI 发帖和回复的快捷模板；越靠上的模板优先显示。</p>
      </div>
      <button type="button" class="primary-button" :disabled="!settings || busyAction !== null" @click="openDialog()"><Plus class="h-4 w-4" />新建模板</button>
    </header>

    <div v-if="!settings" class="error-card mt-5">{{ settingsError || 'Prompt 配置暂时不可用，请刷新后重试。' }}</div>

    <template v-else>
      <div v-if="settings.interactionPrompts.length === 0" class="mt-5 grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
        <div><MessageSquareText class="mx-auto h-7 w-7 text-slate-400" /><p class="mt-3 text-sm font-medium text-slate-700">还没有互动 Prompt</p><p class="mt-1 text-xs text-slate-500">没有启用模板时，插件不会显示对应 AI 快捷入口。</p></div>
      </div>
      <div v-else class="mt-5 space-y-3">
        <article v-for="(prompt, index) in settings.interactionPrompts" :key="prompt.id" class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-semibold text-slate-900">{{ prompt.name }}</h3>
                <span class="status-badge bg-blue-50 text-blue-700">{{ prompt.scene === 'post' ? '发帖' : '回复' }}</span>
                <span class="status-badge" :class="prompt.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'">{{ prompt.enabled ? '已启用' : '已停用' }}</span>
              </div>
              <p class="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{{ prompt.prompt }}</p>
            </div>
            <div class="flex items-center gap-2">
              <div class="mr-1 flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                <button type="button" class="order-button" :aria-label="`上移 ${prompt.name}`" :disabled="busyAction !== null || index === 0" @click="movePrompt(index, -1)"><ArrowUp class="h-3.5 w-3.5" /></button>
                <button type="button" class="order-button" :aria-label="`下移 ${prompt.name}`" :disabled="busyAction !== null || index === settings.interactionPrompts.length - 1" @click="movePrompt(index, 1)"><ArrowDown class="h-3.5 w-3.5" /></button>
              </div>
              <label class="mr-1 inline-flex items-center gap-2 text-xs font-medium text-slate-600"><input :checked="prompt.enabled" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" :disabled="busyAction !== null" @change="togglePrompt(prompt, ($event.target as HTMLInputElement).checked)" />启用</label>
              <button type="button" class="icon-button" :aria-label="`编辑 ${prompt.name}`" :disabled="busyAction !== null" @click="openDialog(prompt)"><Pencil class="h-4 w-4" /></button>
              <button type="button" class="icon-button text-red-600 hover:bg-red-50" :aria-label="`删除 ${prompt.name}`" :disabled="busyAction !== null" @click="confirmRemove(prompt.id)"><Trash2 class="h-4 w-4" /></button>
            </div>
          </div>
        </article>
      </div>
    </template>

    <OptionDialog
      :open="dialogOpen"
      :title="draft.id ? '编辑 Prompt' : '新建 Prompt'"
      description="模板保存后会同步到插件的 X 页面快捷操作。"
      :close-disabled="busyAction !== null"
      @close="closeDialog"
    >
      <fieldset :disabled="busyAction !== null" class="min-w-0 space-y-4 border-0 p-0 disabled:opacity-70">
        <label class="block"><span class="field-label">名称</span><input v-model="draft.name" class="field-input" placeholder="英文发帖润色" /></label>
        <label class="block"><span class="field-label">使用场景</span><select v-model="draft.scene" class="field-input"><option value="post">发帖</option><option value="reply">回复</option></select></label>
        <label class="block"><span class="field-label">Prompt 内容</span><textarea v-model="draft.prompt" class="field-input min-h-40 resize-y leading-6" placeholder="可使用 {userContent}、{replyContent}" /><span class="field-help">保持描述具体，明确希望 AI 输出的语言、语气和长度。</span></label>
        <label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700"><input v-model="draft.enabled" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />启用此模板</label>
      </fieldset>
      <template #footer>
        <div class="flex justify-end gap-3">
          <button type="button" class="secondary-button" :disabled="busyAction !== null" @click="closeDialog">取消</button>
          <button type="button" class="primary-button" :disabled="busyAction !== null" @click="submitDraft">{{ busyAction === 'prompts' ? '保存中…' : '保存模板' }}</button>
        </div>
      </template>
    </OptionDialog>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { InteractionPrompt } from "@fast-social/contracts";
import { ArrowDown, ArrowUp, MessageSquareText, Pencil, Plus, Trash2 } from "lucide-vue-next";
import OptionDialog from "../OptionDialog.vue";
import { emptyPromptDraft, promptToDraft, useServerAdminContext } from "../../use-server-admin";

const { settings, settingsError, busyAction, savePrompts, savePromptDraft, removePrompt } = useServerAdminContext();
const dialogOpen = ref(false);
const draft = ref(emptyPromptDraft());

function openDialog(prompt?: InteractionPrompt) { draft.value = prompt ? promptToDraft(prompt) : emptyPromptDraft(); dialogOpen.value = true; }
function closeDialog() { if (busyAction.value === null) dialogOpen.value = false; }
async function submitDraft() { if (await savePromptDraft(draft.value)) dialogOpen.value = false; }
async function confirmRemove(id: string) { if (window.confirm("确定删除这个 Prompt？")) await removePrompt(id); }
async function movePrompt(index: number, direction: -1 | 1) {
  const prompts = settings.value?.interactionPrompts;
  const targetIndex = index + direction;
  if (!prompts || targetIndex < 0 || targetIndex >= prompts.length) return;
  [prompts[index], prompts[targetIndex]] = [prompts[targetIndex], prompts[index]];
  if (!(await savePrompts())) {
    [prompts[index], prompts[targetIndex]] = [prompts[targetIndex], prompts[index]];
  }
}
async function togglePrompt(prompt: InteractionPrompt, enabled: boolean) {
  const previous = prompt.enabled;
  prompt.enabled = enabled;
  if (!(await savePrompts())) prompt.enabled = previous;
}
</script>

<style scoped>
.field-label { @apply mb-2 block text-sm font-medium text-slate-700; }
.field-input { @apply w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100; }
.field-help { @apply mt-2 block text-xs leading-5 text-slate-500; }
.primary-button { @apply inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50; }
.secondary-button { @apply inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50; }
.icon-button { @apply inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50; }
.order-button { @apply inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30; }
.status-badge { @apply rounded-full px-2 py-0.5 text-[10px] font-semibold; }
.error-card { @apply rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700; }
</style>
