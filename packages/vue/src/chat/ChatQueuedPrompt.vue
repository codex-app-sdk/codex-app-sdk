<template>
  <div class="codex-chat-theme chat-queued-prompt" aria-label="Queued prompt">
    <TerminalIcon class="chat-queued-prompt__icon" aria-hidden="true" />
    <span class="chat-queued-prompt__text">{{ prompt.text }}</span>
    <div class="chat-queued-prompt__actions">
      <button
        class="chat-queued-prompt__action"
        type="button"
        aria-label="Steer queued prompt now"
        title="Steer now"
        @click="emit('steer', prompt.id)"
      >
        <SteeringWheelIcon aria-hidden="true" />
        <span>Steer</span>
      </button>
      <button
        class="chat-queued-prompt__action"
        type="button"
        aria-label="Edit queued prompt"
        title="Edit"
        :disabled="editDisabled"
        @click="emit('edit', prompt.id)"
      >
        <PencilIcon aria-hidden="true" />
      </button>
      <button
        class="chat-queued-prompt__action"
        type="button"
        aria-label="Delete queued prompt"
        title="Delete"
        @click="emit('delete', prompt.id)"
      >
        <Trash2Icon aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PencilIcon, SteeringWheelIcon, TerminalIcon, Trash2Icon } from '../icons/app-icons';
import type { QueuedChatPrompt } from './queued-prompts';

defineProps<{
  prompt: QueuedChatPrompt;
  editDisabled?: boolean;
}>();

const emit = defineEmits<{
  delete: [id: string];
  edit: [id: string];
  steer: [id: string];
}>();
</script>

<style scoped>
.chat-queued-prompt {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) max-content;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-6);
  border-bottom: 0.5px solid var(--color-border);
  color: var(--color-text-muted);
}

.chat-queued-prompt:last-of-type {
  border-bottom: none;
}

.chat-queued-prompt__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.chat-queued-prompt__text {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-xlight);
  line-height: var(--line-height-18);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-queued-prompt__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.chat-queued-prompt__action {
  width: auto;
  height: var(--space-12);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  gap: var(--space-2);
  cursor: pointer;
}

.chat-queued-prompt__action:hover:not(:disabled) {
  background: var(--color-surface-low);
  color: var(--color-text);
}

.chat-queued-prompt__action:disabled {
  opacity: 0.4;
  cursor: default;
}

.chat-queued-prompt__action svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
