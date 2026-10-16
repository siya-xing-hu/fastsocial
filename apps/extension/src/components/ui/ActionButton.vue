<template>
  <button
    ref="element"
    type="button"
    class="action-button"
    :class="{ 'action-button-danger': action === 'delete' || action === 'unfollow' }"
    :aria-label="loading ? `${label} · 处理中` : label"
    :title="loading ? `${label} · 处理中` : label"
    :aria-busy="loading || undefined"
    :disabled="disabled || loading"
  >
    <Loader2 v-if="loading" class="action-icon animate-spin motion-reduce:animate-none" aria-hidden="true" />
    <component :is="icons[action]" v-else class="action-icon" aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
  ArrowDown, ArrowLeft, ArrowUp, Bell, Braces, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardPenLine, Copy,
  FileText, FlaskConical, History, Loader2, MessageSquare, MoreHorizontal, Pencil, Play, Plus,
  RefreshCw, RotateCcw, Save, Send, Settings2, Square, Trash2, UserRound, UserRoundPlus, UserRoundMinus, X,
} from "lucide-vue-next";

const icons = {
  add: Plus, edit: Pencil, delete: Trash2, test: FlaskConical, details: FileText,
  refresh: RefreshCw, run: Play, save: Save, confirm: Check, cancel: X, close: X, back: ArrowLeft,
  reset: RotateCcw, retry: RotateCcw, copy: Copy, format: Braces, up: ArrowUp, down: ArrowDown,
  previous: ChevronLeft, next: ChevronRight,
  expand: ChevronDown, collapse: ChevronUp,
  fill: ClipboardPenLine, send: Send, settings: Settings2, chat: MessageSquare, history: History,
  profile: UserRound, follow: UserRoundPlus, unfollow: UserRoundMinus, reply: MessageSquare, notify: Bell, stop: Square, more: MoreHorizontal,
};
withDefaults(defineProps<{
  action: keyof typeof icons;
  label: string;
  disabled?: boolean;
  loading?: boolean;
}>(), { disabled: false, loading: false });

const element = ref<HTMLButtonElement | null>(null);
defineExpose({ element });
</script>

<style scoped>
.action-button {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  color: #475569;
  cursor: pointer;
  transition: background-color .15s, border-color .15s, color .15s;
}
.action-button:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; }
.action-button:focus-visible { outline: 2px solid #4263d5; outline-offset: 2px; }
.action-button:disabled { cursor: not-allowed; opacity: .5; }
.action-button-danger { color: #dc2626; }
.action-button-danger:hover:not(:disabled) { background: #fef2f2; border-color: #fecaca; }
.action-icon { width: 16px; height: 16px; flex-shrink: 0; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .action-button { transition: none; } }
</style>
