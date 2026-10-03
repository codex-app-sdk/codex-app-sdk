<template>
  <section class="codex-chat-theme chat-tool-confirmation">
    <header class="chat-tool-confirmation__header">
      <span class="chat-tool-confirmation__tag">Approve tool call</span>
      <span class="chat-tool-confirmation__question">{{ summary }}</span>
      <p v-if="description" class="chat-tool-confirmation__description">{{ description }}</p>
    </header>
    <details v-if="details || $slots.details" class="chat-tool-confirmation__details">
      <summary class="chat-tool-confirmation__details-summary">Details</summary>
      <div class="chat-tool-confirmation__details-body">
        <slot name="details"><pre>{{ details }}</pre></slot>
      </div>
    </details>
    <footer class="chat-tool-confirmation__actions">
      <button
        v-for="action in actions"
        :key="action.id"
        class="codex-request-button chat-tool-confirmation__button"
        :class="{ 'codex-request-button--primary': action.primary, 'chat-tool-confirmation__button--primary': action.primary }"
        type="button"
        :disabled="disabled"
        @click="$emit('decide', action.id)"
      >{{ action.label }}</button>
    </footer>
  </section>
</template>

<script setup lang="ts" generic="Decision extends string">
// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
defineProps<{
  summary: string
  description?: string
  details?: string
  disabled?: boolean
  actions: readonly { id: Decision; label: string; primary?: boolean }[]
}>()
defineEmits<{ decide: [decision: Decision] }>()
// Stryker restore all
</script>

<style scoped src="./request-controls.css"></style>

<style scoped>
.chat-tool-confirmation {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  box-sizing: border-box;
  max-height: min(70vh, 38rem);
  overflow-y: auto;
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
  color: var(--color-text);
}

.chat-tool-confirmation__header {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.chat-tool-confirmation__tag {
  width: fit-content;
  border: 1px solid color-mix(in srgb, var(--color-primary) 24%, transparent);
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-3);
  background: var(--color-primary-container);
  color: var(--color-primary);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-16);
}

.chat-tool-confirmation__question {
  font-size: var(--font-size-16);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-24);
}

.chat-tool-confirmation__description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
}

.chat-tool-confirmation__details-body pre {
  margin: 0;
  font: inherit;
  white-space: inherit;
}

.chat-tool-confirmation__details {
  margin: 0;
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  line-height: var(--line-height-20);
}

.chat-tool-confirmation__details-summary {
  width: fit-content;
  cursor: pointer;
}

.chat-tool-confirmation__details-body {
  max-height: 12rem;
  overflow: auto;
  margin: var(--space-3) 0 0;
  padding: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-surface-low);
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-12);
  line-height: var(--line-height-20);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-tool-confirmation__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.chat-tool-confirmation__button:not(:disabled):hover {
  background: var(--color-surface-low);
}

.chat-tool-confirmation__button--primary:not(:disabled):hover {
  background: var(--color-secondary);
}

</style>
