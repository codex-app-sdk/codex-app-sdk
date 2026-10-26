<template>
  <ChatComposerDrawer v-if="prompts.length" class="chat-queued-prompts">
    <ChatQueuedPrompt
      v-for="prompt in prompts"
      :key="prompt.id"
      :edit-disabled="editDisabled"
      :steer-disabled="steerDisabled"
      :prompt="prompt"
      @delete="$emit('delete', $event)"
      @edit="$emit('edit', $event)"
      @steer="$emit('steer', $event)"
    />
  </ChatComposerDrawer>
</template>

<script setup lang="ts">
import ChatComposerDrawer from './ChatComposerDrawer.vue';
import ChatQueuedPrompt from './ChatQueuedPrompt.vue';
import type { QueuedChatPrompt } from './queued-prompts';

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
defineProps<{
  prompts: readonly QueuedChatPrompt[];
  editDisabled?: boolean;
  steerDisabled?: boolean;
}>();

defineEmits<{
  delete: [id: string];
  edit: [id: string];
  steer: [id: string];
}>();
// Stryker restore all
</script>
