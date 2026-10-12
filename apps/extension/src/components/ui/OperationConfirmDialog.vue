<template>
  <dialog ref="dialog" class="operation-confirm" aria-labelledby="operation-confirm-title" aria-describedby="operation-confirm-message" @cancel.prevent="emit('answer', false)">
    <header><h3 id="operation-confirm-title">{{ title }}</h3></header>
    <p id="operation-confirm-message">{{ message }}</p>
    <footer>
      <ActionButton ref="cancelButton" action="cancel" label="取消操作" @click="emit('answer', false)" />
      <ActionButton action="confirm" label="确认执行" @click="emit('answer', true)" />
    </footer>
  </dialog>
</template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import ActionButton from './ActionButton.vue';
defineProps<{title: string; message: string}>();
const emit = defineEmits<{answer: [approved: boolean]}>();
const dialog = ref<HTMLDialogElement>();
const cancelButton = ref<InstanceType<typeof ActionButton>>();
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault(); event.stopImmediatePropagation(); emit('answer', false);
}
onMounted(() => {
  try { dialog.value!.showModal(); cancelButton.value?.element?.focus(); }
  catch { emit('answer', false); }
  window.addEventListener('keydown', escape, true);
});
onBeforeUnmount(() => { window.removeEventListener('keydown', escape, true); dialog.value?.close(); });
</script>
<style scoped>
.operation-confirm { box-sizing:border-box; width:calc(100% - 32px); max-width:440px; margin:auto; padding:0; border:1px solid #e2e8f0; border-radius:16px; background:#fff; color:#0f172a; font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; box-shadow:0 24px 64px #0f172a33; }
.operation-confirm::backdrop { background:#0f172a66; }
header { padding:20px 24px 0; }
h3 { margin:0; color:#0f172a; font-size:16px; font-weight:600; }
p { margin:0; padding:12px 24px 20px; white-space:pre-line; overflow-wrap:anywhere; color:#475569; }
footer { display:flex; justify-content:flex-end; gap:8px; padding:14px 24px; background:#f8fafc; border-top:1px solid #e2e8f0; }
</style>
