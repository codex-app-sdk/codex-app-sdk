<template>
  <span class="chat-mention-chip">
    <img v-if="iconUrl" class="chat-mention-chip__icon" :src="iconUrl" alt="">
    <FileTextIcon v-else-if="kind === 'file'" class="chat-mention-chip__icon" aria-hidden="true" />
    <SparklesIcon v-else-if="kind === 'skill'" class="chat-mention-chip__icon" aria-hidden="true" />
    <PlugIcon v-else class="chat-mention-chip__icon" aria-hidden="true" />
    <span class="chat-mention-chip__label">{{ name }}</span>
  </span>
</template>

<script setup lang="ts">
import { FileTextIcon, PlugIcon, SparklesIcon } from '../icons/app-icons';

withDefaults(defineProps<{
  iconUrl?: string | null;
  kind: 'file' | 'plugin' | 'skill';
  name: string;
}>(), {
  iconUrl: null,
});
</script>

<style scoped>
.chat-mention-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 220px;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
  font-size: var(--font-size-13);
  line-height: 1.2;
  vertical-align: baseline;
  user-select: all;
}

.chat-mention-chip__icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 var(--icon-sm);
  object-fit: contain;
}

.chat-mention-chip__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
