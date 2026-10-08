<template>
  <div class="codex-chat-theme chat-composer__audio-field">
    <div class="chat-composer__audio-text">
      {{ before }}<span>{{ transcript?.finalText }}</span><span class="chat-composer__audio-partial">{{ transcript?.partialText }}</span>{{ after }}<span
        v-if="recording"
        class="chat-composer__listening"
        role="status"
        aria-label="Listening"
      ><span
        class="chat-composer__listening-dot"
        :style="{ '--audio-level': audioLevel ?? 0 }"
        aria-hidden="true"
      /></span><span
        v-else-if="!hasText"
        class="chat-composer__audio-status"
        role="status"
      >{{ starting ? 'Starting microphone...' : 'Transcribing...' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CodexSpeechTranscript } from '@codex-app-sdk/core/native'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  recording: boolean
  starting?: boolean
  transcript?: CodexSpeechTranscript
  audioLevel?: number
  before?: string
  after?: string
}>()
// Stryker restore all
const hasText = computed(() => props.before || props.after || props.transcript?.finalText || props.transcript?.partialText)
</script>

<style scoped>
.chat-composer__audio-field {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: var(--chat-composer-line-height, var(--line-height-24));
  max-height: var(--chat-composer-input-max-height, 304px);
  padding: var(--space-4) 0;
  overflow-y: auto;
  font: inherit;
  font-size: var(--chat-composer-font-size, var(--font-size-15));
  line-height: var(--chat-composer-line-height, var(--line-height-24));
}

.chat-composer__audio-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-height: var(--chat-composer-line-height, var(--line-height-24));
  color: var(--color-text);
  font: inherit;
}

.chat-composer__audio-partial { opacity: 0.5; }

.chat-composer__listening {
  display: inline-block;
  margin-inline-start: var(--space-3);
}

.chat-composer__listening-dot {
  display: inline-block;
  width: var(--space-4);
  height: var(--space-4);
  border-radius: 50%;
  background: var(--color-text-muted);
  opacity: calc(0.25 + var(--audio-level) * 0.4);
  transform: scale(calc(0.65 + var(--audio-level) * 0.65));
  transition: transform 100ms ease-out, opacity 100ms ease-out;
}

.chat-composer__audio-status {
  color: var(--color-text-muted);
}
</style>
