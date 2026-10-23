<template>
  <article class="panel post-template-panel">
    <header class="panel-heading">
      <div><strong>发帖模板</strong><p class="muted">保存常用参考文案，发帖时按需选择。</p></div>
      <div class="toolbar">
        <ActionButton action="refresh" label="刷新发帖模板" :loading="loading" :disabled="busy || editorOpen" @click="load" />
        <ActionButton action="add" label="添加发帖模板" :disabled="busy || editorOpen" @click="create" />
      </div>
    </header>
    <p v-if="error" class="error template-error" role="alert">{{ error }}</p>
    <p v-if="loading" class="empty">正在读取发帖模板…</p>
    <div v-else-if="templates.length" class="template-workspace">
      <nav class="template-list" aria-label="发帖模板">
        <button v-for="item in templates" :key="item.id" type="button" data-ui="choice" class="template-choice"
          :class="{ active: selectedId === item.id }" :title="`查看发帖模板「${item.name}」`"
          :aria-pressed="selectedId === item.id" :disabled="busy || editorOpen" @click="selectedId = item.id">
          {{ item.name }}
        </button>
      </nav>
      <section v-if="selected" class="panel-body template-detail" :aria-label="`发帖模板「${selected.name}」`">
        <div class="template-heading">
          <strong>{{ selected.name }}</strong>
          <div class="toolbar">
            <ActionButton action="edit" :label="`编辑发帖模板「${selected.name}」`" :disabled="busy || editorOpen" @click="edit(selected)" />
            <ActionButton action="delete" :label="`删除发帖模板「${selected.name}」`" :loading="deleting" :disabled="busy || editorOpen" @click="remove(selected)" />
          </div>
        </div>
        <pre class="template-content">{{ selected.content }}</pre>
      </section>
    </div>
    <p v-else-if="!error" class="empty">还没有发帖模板，点击右上角的添加图标保存参考文案。</p>
    <OptionDialog :open="editorOpen" :title="editingId ? '编辑发帖模板' : '添加发帖模板'" :close-disabled="saving" @close="closeEditor">
      <div class="settings-page template-editor">
        <p v-if="editorError" class="error" role="alert">{{ editorError }}</p>
        <fieldset :disabled="saving">
          <label class="field">模板名称
            <input v-model="draft.name" class="input" :maxlength="POST_TEMPLATE_NAME_MAX" placeholder="例如：产品进展" autocomplete="off" />
          </label>
          <label class="field">参考正文
            <textarea v-model="draft.content" class="input template-input" :maxlength="POST_TEMPLATE_CONTENT_MAX" rows="10" placeholder="粘贴希望参考的完整文案。" />
          </label>
        </fieldset>
      </div>
      <template #footer>
        <div class="settings-page toolbar template-footer">
          <ActionButton action="cancel" :label="`取消编辑发帖模板「${draft.name.trim() || '新模板'}」`" :disabled="saving" @click="closeEditor" />
          <ActionButton action="save" :label="`保存发帖模板「${draft.name.trim() || '新模板'}」`" :loading="saving" :disabled="saving || !validDraft" @click="save" />
        </div>
      </template>
    </OptionDialog>
  </article>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { POST_TEMPLATE_CONTENT_MAX, POST_TEMPLATE_NAME_MAX, type PostTemplate, type PostTemplateInput } from '@fast-social/contracts';
import ActionButton from '../../../../components/ui/ActionButton.vue';
import { confirmOperation } from '../../../../components/ui/confirm-operation';
import { requestLocalService } from '../../../../common/local-service';
import { useServerAdminContext } from '../../use-server-admin';
import OptionDialog from '../OptionDialog.vue';

const { showNotice } = useServerAdminContext();
const basePath = '/api/assistant/post-templates';
const templates = ref<PostTemplate[]>([]), selectedId = ref('');
const loading = ref(false), saving = ref(false), deleting = ref(false), confirming = ref(false);
const error = ref(''), editorError = ref(''), editorOpen = ref(false), editingId = ref(''), revision = ref('');
const draft = ref<PostTemplateInput>({ name: '', content: '' });
const busy = computed(() => loading.value || saving.value || deleting.value || confirming.value);
const selected = computed(() => templates.value.find(item => item.id === selectedId.value));
const validDraft = computed(() => Boolean(draft.value.name.trim() && draft.value.content.trim())
  && draft.value.name.length <= POST_TEMPLATE_NAME_MAX && draft.value.content.length <= POST_TEMPLATE_CONTENT_MAX);
const message = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);

async function load() {
  if (busy.value || editorOpen.value) return;
  loading.value = true; error.value = '';
  try {
    const items = await requestLocalService<PostTemplate[]>(basePath);
    templates.value = items;
    if (!items.some(item => item.id === selectedId.value)) selectedId.value = items[0]?.id ?? '';
  } catch (failure) { error.value = message(failure); }
  finally { loading.value = false; }
}

function create() {
  if (busy.value || editorOpen.value) return;
  editingId.value = ''; revision.value = ''; draft.value = { name: '', content: '' };
  editorError.value = ''; editorOpen.value = true;
}

function edit(template: PostTemplate) {
  if (busy.value || editorOpen.value) return;
  editingId.value = template.id; revision.value = template.revision;
  draft.value = { name: template.name, content: template.content };
  editorError.value = ''; editorOpen.value = true;
}

function closeEditor() { if (!saving.value) editorOpen.value = false; }

async function save() {
  if (busy.value || !editorOpen.value || !validDraft.value) return;
  const id = editingId.value, input = { name: draft.value.name.trim(), content: draft.value.content };
  saving.value = true; editorError.value = '';
  try {
    const saved = await requestLocalService<PostTemplate>(id ? `${basePath}/${encodeURIComponent(id)}` : basePath,
      { method: id ? 'PUT' : 'POST', body: id ? { ...input, revision: revision.value } : input });
    const index = templates.value.findIndex(item => item.id === saved.id);
    if (index < 0) templates.value.push(saved);
    else templates.value[index] = saved;
    selectedId.value = saved.id; editorOpen.value = false; error.value = '';
    showNotice('发帖模板已保存');
  } catch (failure) { editorError.value = message(failure); }
  finally { saving.value = false; }
}

async function remove(template: PostTemplate) {
  if (busy.value || editorOpen.value) return;
  const target = { id: template.id, revision: template.revision, name: template.name };
  confirming.value = true;
  try {
    if (!await confirmOperation({ title: '确认删除发帖模板', message: `删除发帖模板「${target.name}」？` })) return;
    const current = templates.value.find(item => item.id === target.id);
    if (!current || current.revision !== target.revision) throw new Error('发帖模板已更新，请刷新后重新选择。');
    deleting.value = true; error.value = '';
    await requestLocalService(`${basePath}/${encodeURIComponent(target.id)}`, { method: 'DELETE', body: { revision: target.revision } });
    templates.value = templates.value.filter(item => item.id !== target.id);
    if (selectedId.value === target.id) selectedId.value = templates.value[0]?.id ?? '';
    showNotice('发帖模板已删除');
  } catch (failure) { error.value = message(failure); }
  finally { deleting.value = false; confirming.value = false; }
}

onMounted(load);
</script>

<style scoped>
.post-template-panel .panel-heading>div:first-child{min-width:0}.post-template-panel .panel-heading p{font-weight:400;margin-top:5px;line-height:1.6}
.template-workspace{display:grid;grid-template-columns:210px minmax(0,1fr)}
.template-list{display:flex;flex-direction:column;gap:4px;padding:8px;border-right:1px solid #edf0f5;max-height:300px;overflow:auto}
.template-choice{width:100%;padding:11px 12px;text-align:left;border:1px solid transparent;border-radius:6px;background:transparent;color:#4b5565;font-size:12px;overflow-wrap:anywhere}
.template-choice:hover:not(:disabled){background:#f8faff}.template-choice.active{background:#f0f4ff;border-color:#dce4f7;color:#344a8d}.template-choice:focus-visible{outline:2px solid #4263d5;outline-offset:1px}
.template-detail{min-width:0}.template-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}.template-heading>strong{min-width:0;overflow-wrap:anywhere}
.template-content{margin:12px 0 0;max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:12px;line-height:1.8;color:#4b5565}
.template-error{margin:12px 18px!important}.template-editor fieldset{display:flex;flex-direction:column;gap:16px;min-width:0}.template-input{min-height:240px!important;max-height:50vh}.template-footer{display:flex;gap:8px;justify-content:flex-end}
@media(max-width:700px){.template-workspace{grid-template-columns:1fr}.template-list{border-right:0;border-bottom:1px solid #edf0f5;max-height:160px}.post-template-panel .panel-heading{align-items:flex-start}.post-template-panel .panel-heading>.toolbar,.template-heading>.toolbar{flex-wrap:nowrap}.template-detail{padding:14px}}
</style>
