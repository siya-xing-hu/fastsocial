<template>
  <div class="w-80 min-w-80 box-border bg-gray-200">
    <div class="text-sm bg-white px-5 py-4 rounded-b-xl">

      <div class="mt-3 rounded-xl bg-gray-100">
        <div class="flex items-center h-11 pl-4">
          <label class="inline-block text-label mb-0 text-gray-6" style="min-width: 70px;">API-KEY：</label>
          <input type="password" v-model="apiKey" @blur="handleChange('apiKey', apiKey)" class="pl-3">
        </div>
      </div>

      <div class="mt-3 rounded-xl bg-gray-100">
        <div class="flex items-center h-11 pl-4">
          <label class="inline-block text-label mb-0 text-gray-6" style="min-width: 70px;">ORG：</label>
          <input type="password" v-model="org" @blur="handleChange('org', org)" class="pl-3">
        </div>
      </div>



      <div class="mt-3 rounded-xl bg-gray-100">
        <div class="flex items-center h-11 pl-4">
          <label class="inline-block text-label mb-0 text-gray-6" style="min-width: 70px;">Model：</label>
          <select v-model="model" @change="handleChange('model', model)" autocomplete="off" class="pl-3">
            <option value="gpt-3.5-turbo">GPT-3.5</option>
            <option value="gpt-4-turbo">GPT-4</option>
            <option value="gpt-4o">GPT-4o</option>
          </select>
        </div>
      </div>

      <div class="mt-3 text-sm px-1 text-gray-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <label class="mb-0 mr-2 shrink-0">Always translate this posts</label>
          </div>
          <input type="checkbox" v-model="alwaysTranslate" @change="handleChange('alwaysTranslate', alwaysTranslate)"
            role="switch" class="shrink-0 w-9 h-3">
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from "vue";
import { onInput } from "../config";

const apiKey = ref<string>('');
const org = ref<string>('');
const model = ref<string>('gpt-3.5-turbo');
const alwaysTranslate = ref<boolean>(false);

function handleChange(field: string, value: any) {
  onInput(field, value);
}

onMounted(async () => {
  const storage = await chrome.storage.local.get()

  apiKey.value = storage["apiKey"] ?? "";
  org.value = storage["org"] ?? "";
  model.value = storage["model"] ?? 'gpt-3.5-turbo';
  alwaysTranslate.value = storage["alwaysTranslate"] ?? false;
});
</script>

<style>
.loader {
  right: 40px;
  position: absolute;
  margin-top: -20px;
  display: grid;
}

.check-icon {
  scale: 0.4;
  right: 0;
  position: absolute;
  margin-top: -55px;
  display: grid;
}
</style>
