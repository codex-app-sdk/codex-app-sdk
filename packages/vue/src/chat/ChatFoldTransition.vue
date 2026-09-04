<template>
  <div class="codex-chat-theme chat-fold" :class="{ 'chat-fold--open': open }">
    <div class="chat-fold__inner">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
defineProps<{
  open: boolean
}>()
// Stryker restore all
</script>

<style scoped>
.chat-fold {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 180ms ease,
    opacity 140ms ease;
}

.chat-fold--open {
  margin-top: var(--space-1);
  display: flex;
  opacity: 1;
}

.chat-fold__inner {
  min-height: 0;
  overflow: hidden;
}
</style>
