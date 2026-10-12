<template>
  <section class="settings-page">
    <header class="page-heading"><div><h2>互动 Skills</h2><p class="subtitle">正文保存在服务端文件中，数据库管理启用状态。</p></div><ActionButton action="refresh" label="刷新 Skills" :disabled="saving || editing" :loading="loading" @click="load" /></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="muted">正在读取 Skills…</p>
    <article v-else-if="selected" class="panel skill-workspace">
      <aside class="skill-list">
        <div v-for="item in skills" :key="item.id" class="skill-list-item" :class="{ active: selectedKey === item.key }">
          <button data-ui="choice" :title="item.name" class="skill-select" :aria-current="selectedKey === item.key ? 'true' : undefined" :disabled="saving || editing" @click="selectedKey = item.key">
            <span class="skill-list-heading"><strong>{{ item.name }}</strong><code>/{{ item.key }}</code></span>
            <small :title="item.description">{{ item.description }}</small>
            <span v-if="item.error || !item.enabled" class="skill-status" :class="{ invalid: item.error }">{{ item.error ? '文件异常' : '已停用' }}</span>
          </button>
          <ToggleSwitch class="skill-enable" :model-value="item.enabled" :label="`${item.name} Skill`" :disabled="saving || editing" @update:model-value="toggle(item.key, $event)" />
        </div>
      </aside>
      <div class="panel-body">
        <div class="skill-heading">
          <div><strong>{{ selected.name }}</strong><code>{{ selected.filePath }}</code></div>
          <div class="skill-actions">
            <ActionButton v-if="!editing" action="edit" label="编辑 Skill 原文" :disabled="saving" @click="edit" />
          </div>
        </div>
        <p v-if="selected.error" class="error" role="alert">{{ selected.error }}</p>
        <textarea v-if="editing" v-model="draft" aria-label="SKILL.md 原文编辑" class="input skill-document" :disabled="saving" maxlength="32000" spellcheck="false" />
        <pre v-else class="skill-document skill-source" aria-label="SKILL.md 原文"><code>{{ selected.instructions || '文件没有可显示的内容。' }}</code></pre>
        <div v-if="editing" class="footer-actions">
          <ActionButton action="cancel" label="取消编辑" :disabled="saving" @click="editing = false" />
          <ActionButton action="save" label="保存 Skill 文件" :disabled="saving || !draft.trim()" @click="save" :loading="saving" />
        </div>
      </div>
    </article>
  </section>
</template>
<script setup lang="ts">
import ActionButton from '../../../../components/ui/ActionButton.vue';
import ToggleSwitch from '../../../../components/ui/ToggleSwitch.vue';
import { computed, onMounted, ref } from 'vue';
import type { AssistantSkill, SkillKey } from '@fast-social/contracts';
import { requestLocalService } from '../../../../common/local-service';
import { useServerAdminContext } from '../../use-server-admin';
const { showNotice } = useServerAdminContext();
const skills = ref<AssistantSkill[]>([]), loading = ref(false), saving = ref(false), error = ref('');
const selectedKey = ref<SkillKey>('summary'), editing = ref(false), draft = ref(''), revision = ref('');
const selected = computed(() => skills.value.find(s => s.key === selectedKey.value));
function accept(saved: AssistantSkill) { skills.value = skills.value.map(s => s.key === saved.key ? saved : s); }
function edit() { if (selected.value) { draft.value = selected.value.instructions; revision.value = selected.value.revision; editing.value = true; error.value = ''; } }
async function load() {
  loading.value = true; error.value = '';
  try { skills.value = await requestLocalService<AssistantSkill[]>('/api/assistant/skills'); }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { loading.value = false; }
}
async function save() {
  saving.value = true; error.value = '';
  try {
    accept(await requestLocalService<AssistantSkill>('/api/assistant/skills/' + selectedKey.value, { method: 'PUT', body: { instructions: draft.value, revision: revision.value } }));
    editing.value = false; showNotice('Skill 文件已保存');
  }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { saving.value = false; }
}
async function toggle(key: SkillKey, enabled: boolean) {
  saving.value = true; error.value = '';
  try {
    accept(await requestLocalService<AssistantSkill>('/api/assistant/skills/' + key, { method: 'PATCH', body: { enabled } }));
    showNotice(enabled ? 'Skill 已启用' : 'Skill 已停用');
  }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { saving.value = false; }
}
onMounted(load);
</script>
<style scoped>
.skill-workspace{display:grid;grid-template-columns:210px minmax(0,1fr)}
.skill-list{border-right:1px solid #edf0f5;padding:8px;min-width:0}
.skill-list-item{position:relative;border:1px solid transparent;border-radius:6px;margin-bottom:4px;min-width:0}
.skill-list-item.active{background:#f0f4ff;border-color:#dce4f7}
.skill-select{display:block;width:100%;text-align:left;padding:12px;border:0;border-radius:6px;background:transparent}
.skill-list-heading{display:flex;align-items:center;gap:6px;min-height:20px;padding-right:40px;flex-wrap:wrap}
.skill-enable{position:absolute;top:12px;right:10px}
.skill-list strong{font-size:12px}.skill-list code{font-size:10px;color:#7786a4}
.skill-list small{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:7px;font-size:10px;color:#8a94a6;line-height:1.7}
.skill-status{display:inline-block;font-size:10px;color:#8a94a6;margin-top:7px}.skill-status.invalid{color:#bd5555}
.skill-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;font-size:13px}
.skill-heading>div:first-child{min-width:0}.skill-heading code{display:block;font-size:10px;color:#7a879a;margin-top:6px;overflow-wrap:anywhere}
.skill-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.skill-document{display:block;width:100%;height:clamp(360px,58vh,640px);min-height:300px!important;line-height:1.85!important;font-family:ui-monospace,SFMono-Regular,Consolas,monospace!important;tab-size:2;font-size:12px}
.skill-source{margin:0;padding:16px;background:#fafbfd;border:1px solid #e8edf3;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;color:#374151}
.skill-source code{font:inherit}.skill-document.input{resize:vertical}.footer-actions{align-items:center}
@media(max-width:750px){.skill-workspace{grid-template-columns:1fr}.skill-list{display:flex;border-right:0;border-bottom:1px solid #edf0f5;gap:4px}.skill-list-item{flex:1}.skill-select{padding:9px}.skill-list-heading{flex-direction:column;align-items:flex-start;gap:4px}.skill-enable{top:9px;right:8px}.skill-list small{display:none}.skill-heading{flex-wrap:wrap}}
</style>
