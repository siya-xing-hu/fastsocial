<template>
  <article class="portrait-post">
    <a :href="post.url || `https://x.com/i/status/${encodeURIComponent(post.id)}`" class="text-xs text-blue-600" target="_blank" rel="noopener noreferrer">{{ post.id }}</a>
    <p ref="body" class="portrait-post-text" :class="{ 'portrait-post-collapsed': !expanded }">{{ post.text }}</p>
    <div v-if="hasMore" class="flex justify-end mt-2">
      <ActionButton :action="expanded ? 'collapse' : 'expand'" :label="expanded ? '收起全文' : '显示全部'" :aria-expanded="expanded" @click="expanded = !expanded" />
    </div>
  </article>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SocialPost } from '@fast-social/contracts';
import ActionButton from '../../../../components/ui/ActionButton.vue';

const props = defineProps<{ post: SocialPost }>();
const body = ref<HTMLElement | null>(null), expanded = ref(false), hasMore = ref(false);
let observer: ResizeObserver | undefined;
function measure() {
  if (!body.value?.clientWidth) return;
  const lineHeight = parseFloat(getComputedStyle(body.value).lineHeight);
  hasMore.value = body.value.scrollHeight > lineHeight * 5 + 1;
}
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (body.value) observer.observe(body.value);
  measure();
});
watch([() => props.post.id, () => props.post.text], () => { expanded.value = false; measure(); }, { flush: 'post' });
onBeforeUnmount(() => observer?.disconnect());
</script>
<style scoped>
.portrait-post { margin-top:12px; padding-top:12px; border-top:1px solid #e2e8f0; }
.portrait-post-text { margin-top:8px; font-size:14px; line-height:1.75; white-space:pre-wrap; overflow-wrap:anywhere; }
.portrait-post-collapsed { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:5; overflow:hidden; }
</style>
