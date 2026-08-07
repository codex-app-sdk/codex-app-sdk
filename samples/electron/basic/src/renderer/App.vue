<template>
  <main class="app-shell">
    <CodexConversationSidebar
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
import {
  CodexConversationPane,
  CodexConversationSidebar,
  useCodexSurface,
} from '@codex-app-sdk/vue';

const surface = useCodexSurface(window.codexSurface);
</script>
