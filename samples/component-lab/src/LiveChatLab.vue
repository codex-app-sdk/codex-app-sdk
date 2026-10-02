<template>
  <section class="live-chat-lab">
    <div v-if="!conversationId" class="live-chat-lab__setup">
      <h3>Talk to Codex</h3>
      <p>This is a real session using your local Codex CLI login, not a mock. Requires a CLI/account with experimental realtime V3 access.</p>
      <p>A new read-only conversation is created. Microphone access starts only when you press Start live chat.</p>
      <button type="button" :disabled="connecting" @click="connect">{{ connecting ? 'Connecting…' : 'Create lab conversation' }}</button>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
    <template v-else>
      <LiveChatSession ref="liveSession" :api="api" :conversation-id="conversationId" />
      <CodexConversationPane :surface="surface" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { CodexConversationPane, useCodexSurface } from '@codex-app-sdk/vue';
import { createCodexBrowserWebSocketPort, createCodexWebSurfaceClient } from '@codex-app-sdk/web/client';
import LiveChatSession from './LiveChatSession.vue';

const api = createCodexWebSurfaceClient({
  createSocket: () => createCodexBrowserWebSocketPort(new WebSocket(`ws://${window.location.host}/live-chat`)),
});
const surface = useCodexSurface(api);
const liveSession = ref<InstanceType<typeof LiveChatSession> | null>(null);
const conversationId = ref<string | null>(null);
const connecting = ref(false);
const error = ref<string | null>(null);
let disposed = false;

async function connect(): Promise<void> {
  connecting.value = true;
  error.value = null;
  try {
    await surface.connect();
    if (disposed) return;
    const snapshot = await surface.createConversation();
    if (!disposed) conversationId.value = snapshot.activeConversationId;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    connecting.value = false;
  }
}

onBeforeUnmount(() => {
  disposed = true;
  // Finish signaling before closing the bridge; a late stop must not reconnect it.
  void (liveSession.value?.stop() ?? Promise.resolve()).catch(() => undefined).finally(() => api.disconnect());
});
</script>

<style scoped>
.live-chat-lab { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; }
.live-chat-lab__setup { margin: auto; max-width: 36rem; padding: 24px; }
.live-chat-lab__setup p { line-height: 1.6; }
.live-chat-lab__setup button { padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; background: transparent; color: inherit; cursor: pointer; font: inherit; }
</style>
