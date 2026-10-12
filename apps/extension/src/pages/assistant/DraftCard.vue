<template>
  <section class="draft-card" :aria-label="message.skill === 'reply' ? '回复草稿' : 'Post 草稿'">
    <div class="draft-author">
      <span class="draft-avatar" aria-hidden="true">{{ initial }}</span>
      <div class="draft-identity"><strong>{{ name }}<BadgeCheck v-if="policy.blueVerified" :size="13" class="blue-badge" aria-label="已识别蓝标" /></strong><span v-if="account?.username">@{{ account.username }}</span></div>
      <span class="draft-badge">草稿</span>
    </div>
    <div v-if="message.skill === 'reply' && message.context?.target?.author" class="reply-to">回复 {{ message.context.target.author }}</div>
    <div class="draft-text"><p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p></div>
    <footer class="draft-footer">
      <span :title="policyHint">{{ count.weightedLength }} / {{ policy.maxWeightedLength.toLocaleString() }}<small>{{ message.validation ? (policy.maxWeightedLength > 280 ? '长文预算' : '加权字符') : '权限待确认' }}</small></span>
      <div class="draft-actions"><ActionButton action="copy" label="复制文案" @click="$emit('copy')" /><ActionButton action="fill" label="填入 X 草稿" :disabled="disabled || filling" :loading="filling" @click="$emit('fill')" /></div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { BadgeCheck } from 'lucide-vue-next';
import ActionButton from '../../components/ui/ActionButton.vue';
import type { ChatMessage } from '../../assistant/conversations';
import { measurePost, postingPolicy, postingPolicyLabel } from '@fast-social/contracts';
const props = defineProps<{ message: ChatMessage; disabled: boolean; filling: boolean }>();
defineEmits<{ copy: []; fill: [] }>();
const account = computed(() => props.message.context?.account);
const name = computed(() => account.value?.displayName || account.value?.username || '你');
const initial = computed(() => Array.from(name.value)[0]?.toUpperCase() || '𝕏');
const paragraphs = computed(() => props.message.content.trim().split(/\n\s*\n/));
// Old conversations may contain a manual length budget; only detected account facts remain applicable.
const policy = computed(() => postingPolicy(props.message.validation?.policy.blueVerified ?? account.value?.blueVerified));
const count = computed(() => measurePost(props.message.content, policy.value.maxWeightedLength));
const policyHint = computed(() => postingPolicyLabel(policy.value) + '。中文通常每字计 2，链接计 23，emoji 按 X 规则计数。');
</script>

<style scoped>
.draft-card{border:1px solid #e6e6e6;border-radius:16px;padding:15px;background:#fff;overflow:hidden}.draft-author{display:flex;align-items:center;gap:9px}.draft-avatar{width:32px;height:32px;border-radius:50%;background:#f0f0f0;display:grid;place-items:center;color:#525252;font-size:14px;font-weight:600;flex-shrink:0}.draft-identity{min-width:0;display:flex;flex-direction:column;gap:2px}.draft-identity strong{font-size:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.blue-badge{display:inline-block;vertical-align:-2px;color:#1d9bf0;margin-left:4px}.draft-identity span{font-size:11px;color:#929292}.draft-badge{margin-left:auto;font-size:10px;color:#939393;flex-shrink:0}.reply-to{font-size:11px;color:#8a8a8a;margin-top:13px}.draft-text{font-size:14px;line-height:1.8;overflow-wrap:anywhere}.draft-text p{white-space:pre-wrap;margin:15px 0}.draft-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid #f0f0f0;padding-top:10px;margin-top:4px}.draft-footer>span{font-size:10px;color:#8b8b8b;display:flex;flex-direction:column;gap:3px}.draft-footer small{font-size:9px;color:#aaa}.draft-actions{display:flex;gap:6px}
</style>
