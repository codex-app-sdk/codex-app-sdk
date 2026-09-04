<template>
  <div class="codex-chat-theme chat-composer__audio-field">
    <ChatComposerWaveform
      v-if="recording"
      :active="recording"
      :audio-recorder="recorder"
      label="Audio waveform"
    />
    <span v-else class="chat-composer__audio-status">
      Transcribing...
    </span>
  </div>
</template>

<script setup lang="ts">
import ChatComposerWaveform from './ChatComposerWaveform.vue'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
defineProps<{
  recorder: {
    getAnalyser(): AnalyserNode | null
    getBufferLength(): number
  } | null
  recording: boolean
}>()
// Stryker restore all
</script>

<style scoped>
.chat-composer__audio-field {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 28px;
  padding: 0 var(--space-2);
}

.chat-composer__audio-status {
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-20);
}
</style>
