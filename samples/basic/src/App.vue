<template>
  <main class="app-shell">
    <ConversationSidebar
      :active-conversation-id="surface.state.activeConversationId"
      :conversations="surface.state.conversations"
      :loading="surface.state.status === 'connecting'"
      @create="surface.createConversation()"
      @select="surface.selectConversation($event)"
    />
    <CodexConversationPane
      :surface="surface"
      autofocus
    >
      <template #empty>
        <div class="welcome">
          <div class="welcome__mark" aria-hidden="true">⌁</div>
          <h2>What should we build?</h2>
          <p>This sample asks before protected tool calls by default. Choose another approval preset when the active Codex profile allows it.</p>
        </div>
      </template>
    </CodexConversationPane>
  </main>
</template>

<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';
import ConversationSidebar from './components/ConversationSidebar.vue';

const surface = useCodexSurface(window.codexSurface);
</script>
