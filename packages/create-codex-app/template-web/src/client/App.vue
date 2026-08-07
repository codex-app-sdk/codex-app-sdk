<template>
  <main class="web-app">
    <CodexConversationSidebar
      brand="{{displayName}}"
      :active-conversation-id="surface.state.activeConversationId"
      :conversations="surface.state.conversations"
      :create-disabled="surface.state.status !== 'ready'"
      :loading="surface.state.status === 'connecting'"
      @create="surface.createConversation()"
      @delete="surface.deleteConversation($event)"
      @select="surface.selectConversation($event)"
    />
    <CodexConversationPane :surface="surface" autofocus />
  </main>
</template>

<script setup lang="ts">
import {
  CodexConversationPane,
  CodexConversationSidebar,
  useCodexSurface,
} from '@codex-app-sdk/vue';
import {
  createCodexBrowserWebSocketPort,
  createCodexWebSurfaceClient,
} from '@codex-app-sdk/web/client';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const api = createCodexWebSurfaceClient({
  createSocket: () => createCodexBrowserWebSocketPort(
    new WebSocket(`${protocol}//${window.location.host}/codex`),
  ),
  reconnect: true,
});
const surface = useCodexSurface(api);
</script>
