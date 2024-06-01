<template>
  <!-- <main-button @toggle-sidebar="toggleSidebar" />
  <div class="z-0 fixed top-0 rounded-tl-[36px] h-full flex pointer-events-none transition-right duration-500 transform-gpu shadow-[0_0_60px_#382b52c7]"
    :class="[appState.showSidebar
      ? 'right-0' : 'right-[-690px]']" :style="{ 'background-image': `url('${mainBackground}')`, backgroundSize: '100% 100%' }">
    <sidebar :view-type="appState.viewType" />
    <tabs @toggle-tab="toggleViewType" @toggle-sidebar="toggleSidebar" :view-type="appState.viewType"
      :show-sidebar="appState.showSidebar" />
  </div> -->
</template>

<script lang="ts" setup>
// import { computed } from 'vue';
// import Sidebar from "./components/Sidebar.vue";
// import Tabs from "./components/Tabs.vue";
// import MainButton from "./components/MainButton.vue";
// import { appState } from './common/app-state';
// import { toggleSidebar, toggleViewType } from './components/tabs';
// import { assets } from './common/res-util';

// const mainBackground = computed(() => {
//   return appState.value.viewType === 'profile-view' ? assets.profile_bg_png : assets.main_bg_png;
// });
</script>
