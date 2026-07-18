<template>
  <main class="app-shell">
    <ConversationSidebar
      :active-conversation-id="surface.state.activeConversationId"
      :conversations="surface.state.conversations"
      :loading="surface.state.status === 'connecting'"
      @create="surface.createConversation()"
      @delete="surface.deleteConversation($event)"
      @select="surface.selectConversation($event)"
    />
    <CodexConversationPane
      :surface="surface"
      autofocus
    />
  </main>
</template>

<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';
import ConversationSidebar from './components/ConversationSidebar.vue';

const surface = useCodexSurface(window.codexSurface);
</script>
