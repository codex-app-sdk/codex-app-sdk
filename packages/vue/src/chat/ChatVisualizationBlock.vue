<template>
  <button
    v-if="path"
    class="codex-chat-theme chat-visualization-block"
    type="button"
    @click="open"
  >
    <DashboardIcon class="chat-visualization-block__icon" />
    <span>{{ title }}</span>
    <ExternalLinkIcon class="chat-visualization-block__open" />
  </button>
  <div v-else class="codex-chat-theme chat-visualization-block">
    <DashboardIcon class="chat-visualization-block__icon" />
    <span>{{ title }}</span>
  </div>
</template>

<script setup lang="ts">
import { DashboardIcon, ExternalLinkIcon } from '../icons/app-icons'
import type { CodexConversationVisualization } from './visualization'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{ path?: string; title: string }>()
const emit = defineEmits<{
  'open-visualization': [visualization: CodexConversationVisualization]
}>()
// Stryker restore all

function open() {
  if (!props.path) return
  emit('open-visualization', { path: props.path, title: props.title })
}
</script>

<style scoped>
.chat-visualization-block {
  display: flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  gap: var(--space-4);
  border: 0;
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-6);
  background: var(--color-surface-low);
  color: var(--color-text);
  font: inherit;
  overflow-wrap: anywhere;
  text-align: left;
}

button.chat-visualization-block {
  cursor: pointer;
}

button.chat-visualization-block:hover {
  background: var(--color-surface-high);
}

button.chat-visualization-block:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.chat-visualization-block__icon,
.chat-visualization-block__open {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

.chat-visualization-block__open {
  width: 15px;
  height: 15px;
}
</style>
