<template>
  <OptionDialog :open="open" title="用户画像" :close-disabled="busy" @close="$emit('close')">
    <div class="settings-page portrait-content">
      <div>
        <div class="flex flex-wrap items-baseline gap-x-2">
          <strong>{{ user.name || user.username }}</strong><span class="muted">@{{ user.username }}</span>
        </div>
        <p v-if="user.bio" class="muted mt-2 whitespace-pre-wrap">{{ user.bio }}</p>
      </div>
      <label class="field">画像
        <textarea v-model="text" class="input portrait-input" rows="8" :disabled="busy || updating" />
      </label>
      <details v-if="evidence.length">
        <summary class="muted cursor-pointer">画像依据 · {{ evidence.length }} 条</summary>
        <PortraitEvidencePost v-for="post in evidence" :key="post.id" :post="post" />
      </details>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <div class="settings-page"><div class="toolbar justify-between">
        <ActionButton action="refresh" label="更新画像" :loading="updating" :disabled="busy" @click="$emit('refresh')" />
        <ActionButton action="save" label="保存画像" :loading="saving" :disabled="busy || updating || !canSave" @click="$emit('save')" />
      </div></div>
    </template>
  </OptionDialog>
</template>
<script setup lang="ts">
import type { SocialAccount, SocialPost } from '@fast-social/contracts';
import ActionButton from '../../../../components/ui/ActionButton.vue';
import OptionDialog from '../OptionDialog.vue';
import PortraitEvidencePost from './PortraitEvidencePost.vue';
defineProps<{
  open: boolean;
  user: Pick<SocialAccount, 'name' | 'username' | 'bio'>;
  evidence: SocialPost[];
  busy: boolean;
  updating: boolean;
  saving: boolean;
  canSave: boolean;
  error: string;
}>();
const text = defineModel<string>({ required: true });
defineEmits<{ close: []; refresh: []; save: [] }>();
</script>
<style scoped>
.portrait-content { display:grid; gap:16px; }
.portrait-input { min-height:180px; resize:vertical; line-height:1.75; }
</style>
