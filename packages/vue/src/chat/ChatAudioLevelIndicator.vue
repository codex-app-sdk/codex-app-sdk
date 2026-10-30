<template>
  <span class="chat-audio-level-indicator" :style="{ '--audio-level': audioLevel ?? 0 }" aria-hidden="true" />
</template>

<script setup lang="ts">
defineProps<{ audioLevel?: number }>()
</script>

<style scoped>
.chat-audio-level-indicator {
  display: inline-block;
  width: var(--space-4);
  height: var(--space-4);
  border-radius: 50%;
  background: var(--color-text-muted);
  opacity: calc(0.25 + var(--audio-level) * 0.4);
  transform: scale(calc(0.65 + var(--audio-level) * 0.65));
  transition: transform 100ms ease-out, opacity 100ms ease-out;
}
</style>
