<template>
  <main class="web-app">
    <CodexConversationPane :surface="surface" autofocus />
  </main>
</template>

<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from '@codex-app-sdk/vue';
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
