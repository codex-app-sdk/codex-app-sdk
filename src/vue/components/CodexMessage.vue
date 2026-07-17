<template>
  <article
    class="codex-message"
    :class="[`codex-message--${message.role}`, `codex-message--${message.status}`]"
    :aria-busy="message.status === 'streaming' ? 'true' : undefined"
  >
    <div class="codex-message__parts">
      <template v-for="(part, index) in message.parts" :key="partKey(part, index)">
        <slot v-if="part.type === 'text'" name="text" :part="part" :index="index" :message="message">
          <p class="codex-message__text">{{ part.text }}</p>
        </slot>
        <slot v-else-if="part.type === 'status'" name="status" :part="part" :index="index" :message="message">
          <p class="codex-message__status">{{ part.text }}</p>
        </slot>
        <slot v-else name="tool" :part="part" :index="index" :message="message">
          <details class="codex-message__tool" :open="part.status === 'running'">
            <summary class="codex-message__tool-summary">
              <span>{{ part.title }}</span>
              <span class="codex-message__tool-status">{{ part.statusText ?? part.status }}</span>
            </summary>
            <pre v-if="part.body" class="codex-message__tool-body">{{ part.body }}</pre>
            <pre v-else-if="part.output !== undefined" class="codex-message__tool-body">{{ formatValue(part.output) }}</pre>
          </details>
        </slot>
      </template>
      <span v-if="message.status === 'streaming'" class="codex-message__streaming" aria-label="Streaming" />
    </div>
  </article>
</template>

<script setup lang="ts">
import type { SurfaceMessage, SurfaceMessagePart } from '../types';

defineProps<{
  message: SurfaceMessage;
}>();

function partKey(part: SurfaceMessagePart, index: number): string {
  return part.type === 'tool' ? part.id : `${part.type}-${index}`;
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
</script>

<style scoped>
.codex-message {
  display: flex;
  width: 100%;
  color: var(--codex-text-color, #202124);
}

.codex-message--user {
  justify-content: flex-end;
}

.codex-message--assistant,
.codex-message--system {
  justify-content: flex-start;
}

.codex-message__parts {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--codex-space-2, 8px);
  max-width: var(--codex-message-max-width, min(82%, 760px));
}

.codex-message--user .codex-message__parts {
  padding: var(--codex-message-user-padding, 8px 12px);
  border-radius: var(--codex-message-user-radius, 14px);
  background: var(--codex-message-user-background, #eef0f2);
}

.codex-message__text,
.codex-message__status {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.codex-message__status,
.codex-message__tool-status {
  color: var(--codex-muted-text-color, #777b82);
  font-size: 0.85em;
}

.codex-message__tool {
  width: 100%;
  border: 1px solid var(--codex-border-color, #d8dadd);
  border-radius: var(--codex-tool-radius, 10px);
  background: var(--codex-tool-background, #f7f8f9);
}

.codex-message__tool-summary {
  display: flex;
  justify-content: space-between;
  gap: var(--codex-space-4, 16px);
  padding: 8px 10px;
  cursor: pointer;
}

.codex-message__tool-body {
  margin: 0;
  padding: 10px;
  border-top: 1px solid var(--codex-border-color, #d8dadd);
  overflow-x: auto;
  white-space: pre-wrap;
  font: var(--codex-mono-font, 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace);
}

.codex-message__streaming {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--codex-working-color, #4d7cfe);
  animation: codex-message-pulse 900ms ease-in-out infinite alternate;
}

.codex-message--error {
  color: var(--codex-error-color, #b42318);
}

@keyframes codex-message-pulse {
  to { opacity: 0.28; }
}
</style>

