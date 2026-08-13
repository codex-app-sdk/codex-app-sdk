<template>
  <div v-if="prompts.length" class="codex-chat-theme chat-queued-prompts">
    <ChatQueuedPrompt
      v-for="prompt in prompts"
      :key="prompt.id"
      :edit-disabled="editDisabled"
      :prompt="prompt"
      @delete="$emit('delete', $event)"
      @edit="$emit('edit', $event)"
      @steer="$emit('steer', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import ChatQueuedPrompt from './ChatQueuedPrompt.vue';
import type { QueuedChatPrompt } from './queued-prompts';

defineProps<{
  prompts: readonly QueuedChatPrompt[];
  editDisabled?: boolean;
}>();

defineEmits<{
  delete: [id: string];
  edit: [id: string];
  steer: [id: string];
}>();
</script>

<style scoped>
.chat-queued-prompts {
  width: 100%;
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--color-border);
  border-bottom: 0;
  border-top-left-radius: var(--radius-xl);
  border-top-right-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-sm);
}
</style>
