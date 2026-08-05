<script setup lang="ts">
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';

const surface = useCodexSurface(window.codexSurface);
</script>

<template>
  <main class="app-shell">
    <aside class="sidebar" aria-label="Conversations">
      <header class="sidebar__header">
        <strong class="sidebar__brand">{{displayName}}</strong>
      </header>
      <div class="sidebar__actions">
        <button
          type="button"
          class="sidebar__new-chat"
          :disabled="surface.state.status !== 'ready'"
          @click="surface.createConversation()"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
          </svg>
          <span>New chat</span>
        </button>
      </div>

      <section class="sidebar__recents" aria-labelledby="recent-chats-heading">
        <h2 id="recent-chats-heading" class="sidebar__section-title">Recent chats</h2>
        <p v-if="surface.state.conversations.length === 0" class="sidebar__empty">
          {{ surface.state.status === 'connecting' ? 'Loading…' : 'No conversations yet' }}
        </p>
        <nav v-else class="sidebar__list" aria-label="Recent chats">
          <button
            v-for="conversation in surface.state.conversations"
            :key="conversation.id"
            type="button"
            class="sidebar__conversation"
            :class="{ 'sidebar__conversation--active': conversation.id === surface.state.activeConversationId }"
            :title="conversation.title || 'Untitled conversation'"
            @click="surface.selectConversation(conversation.id)"
          >
            <span>{{ conversation.title || 'Untitled conversation' }}</span>
          </button>
        </nav>
      </section>
    </aside>

    <CodexConversationPane :surface="surface" autofocus />
  </main>
</template>
