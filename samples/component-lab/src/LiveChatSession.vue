<template>
  <section class="live-chat-session" aria-label="Live chat">
    <div class="live-chat-session__controls">
      <strong>Live chat · {{ status }}</strong>
      <button v-if="status === 'idle' || status === 'error'" type="button" @click="start().catch(() => undefined)">Start live chat</button>
      <template v-else>
        <button type="button" :disabled="status === 'stopping'" :aria-pressed="muted" @click="setMuted(!muted)">{{ muted ? 'Unmute microphone' : 'Mute microphone' }}</button>
        <button type="button" :disabled="status === 'stopping'" @click="stop().catch(() => undefined)">Stop live chat</button>
      </template>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <ol class="live-chat-session__transcript" aria-label="Live transcript" aria-live="polite">
      <li v-for="item in transcript" :key="item.id"><strong>{{ item.role }}:</strong> {{ item.text }}</li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { useCodexLiveChat } from '@codex-app-sdk/vue';
import type { CodexSurfaceRendererApi } from '@codex-app-sdk/core/surface';

const props = defineProps<{ api: CodexSurfaceRendererApi; conversationId: string }>();
const { status, error, muted, transcript, start, stop, setMuted } = useCodexLiveChat({
  surface: props.api,
  conversationId: props.conversationId,
  session: { version: 'v3' },
});
defineExpose({ stop });
</script>

<style scoped>
.live-chat-session { padding: 16px 24px; border-bottom: 1px solid var(--border-color, #ddd); }
.live-chat-session__controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.live-chat-session__controls strong { margin-right: auto; }
.live-chat-session button { padding: 6px 12px; border: 1px solid #ddd; border-radius: 8px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.live-chat-session button:disabled { opacity: 0.5; cursor: default; }
.live-chat-session__transcript { max-height: 160px; overflow: auto; list-style: none; padding: 0; margin: 12px 0 0; }
.live-chat-session__transcript li { margin-block: 6px; }
</style>
