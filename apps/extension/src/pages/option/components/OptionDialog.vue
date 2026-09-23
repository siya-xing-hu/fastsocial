<template>
  <TransitionRoot appear :show="open" as="template">
    <Dialog
      as="div"
      class="relative z-50"
      :initial-focus="closeButton"
      @close="requestClose"
    >
      <TransitionChild
        as="template"
        enter="duration-200 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-150 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-slate-950/45 backdrop-blur-[2px]" />
      </TransitionChild>

      <div class="fixed inset-0 overflow-y-auto">
        <div class="flex min-h-full items-center justify-center p-4">
          <TransitionChild
            as="template"
            enter="duration-200 ease-out"
            enter-from="translate-y-2 opacity-0 sm:scale-95"
            enter-to="translate-y-0 opacity-100 sm:scale-100"
            leave="duration-150 ease-in"
            leave-from="translate-y-0 opacity-100 sm:scale-100"
            leave-to="translate-y-2 opacity-0 sm:scale-95"
          >
            <DialogPanel
              class="flex max-h-[92vh] w-full max-w-xl transform flex-col overflow-hidden rounded-2xl bg-white text-left align-middle shadow-2xl transition-all"
              @keydown.esc.stop.prevent="requestClose"
            >
              <header class="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
                <div>
                  <DialogTitle as="h3" class="text-lg font-semibold text-slate-900">
                    {{ title }}
                  </DialogTitle>
                  <DialogDescription v-if="description" class="mt-1 text-sm text-slate-500">
                    {{ description }}
                  </DialogDescription>
                </div>
                <button
                  ref="closeButton"
                  type="button"
                  class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="关闭"
                  :disabled="closeDisabled"
                  @click="requestClose"
                >
                  <X class="h-4 w-4" />
                </button>
              </header>

              <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <slot />
              </div>

              <footer v-if="$slots.footer" class="shrink-0 border-t border-slate-100 bg-slate-50 px-6 py-4">
                <slot name="footer" />
              </footer>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  Dialog,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import { X } from "lucide-vue-next";

const props = defineProps<{
  open: boolean;
  title: string;
  description?: string;
  closeDisabled?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const closeButton = ref<HTMLButtonElement | null>(null);

function requestClose() {
  if (!props.closeDisabled) emit("close");
}

function handleEscape(event: KeyboardEvent) {
  if (!props.open || event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  requestClose();
}

onMounted(() => document.addEventListener("keydown", handleEscape, true));
onBeforeUnmount(() => document.removeEventListener("keydown", handleEscape, true));
</script>
