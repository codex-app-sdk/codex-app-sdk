<template>
  <aside class="spark-sidebar" aria-label="Chats">
    <div class="spark-brand">
      <span class="spark-brand__mark" aria-hidden="true">★</span>
      <span>Spark</span>
    </div>

    <div class="spark-sidebar__heading">
      <span>Chats</span>
      <button
        class="spark-sidebar__new"
        type="button"
        :disabled="createDisabled"
        aria-label="New chat"
        @click="emit('create')"
      >
        <span aria-hidden="true">＋</span>
        New chat
      </button>
    </div>

    <p v-if="conversations.length === 0" class="spark-sidebar__empty">
      {{ loading ? 'Finding your chats…' : 'Your next great question starts here!' }}
    </p>
    <nav v-else class="spark-sidebar__list">
      <button
        v-for="conversation in conversations"
        :key="conversation.id"
        class="spark-chat-card"
        :class="{ 'spark-chat-card--active': conversation.id === activeConversationId }"
        type="button"
        :aria-current="conversation.id === activeConversationId ? 'page' : undefined"
        @click="emit('select', conversation.id)"
      >
        <span class="spark-chat-card__icon" aria-hidden="true">{{ conversationIcon(conversation.title) }}</span>
        <span class="spark-chat-card__copy">
          <span class="spark-chat-card__title">{{ friendlyTitle(conversation.title) }}</span>
          <span class="spark-chat-card__preview">{{ conversation.preview || 'A brand-new chat' }}</span>
        </span>
      </button>
    </nav>

    <div class="spark-sidebar__bottom">
      <details class="spark-account">
        <summary class="spark-account__summary" aria-label="Grown-up account menu">
          <span class="spark-account__avatar" aria-hidden="true">👤</span>
          <span class="spark-account__copy">
            <strong>Grown-up menu</strong>
            <small>{{ accountLabel }}</small>
          </span>
          <span class="spark-account__chevron" aria-hidden="true">⌃</span>
        </summary>
        <div class="spark-account__menu" aria-label="Account actions">
          <button type="button" :disabled="logoutBusy" @click="emit('logout')">
            <span aria-hidden="true">↪</span>
            {{ logoutBusy ? 'Signing out…' : 'Sign out' }}
          </button>
          <p v-if="accountError" role="alert">{{ accountError }}</p>
        </div>
      </details>

      <div class="spark-sidebar__footer">
        <span aria-hidden="true">🛡️</span>
        A safe space to wonder
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { CodexConversationSummary } from 'codex-app-sdk/surface';

withDefaults(defineProps<{
  activeConversationId?: string | null;
  accountError?: string | null;
  accountLabel?: string;
  conversations: readonly CodexConversationSummary[];
  createDisabled?: boolean;
  loading?: boolean;
  logoutBusy?: boolean;
}>(), {
  activeConversationId: null,
  accountError: null,
  accountLabel: 'Signed in',
  createDisabled: false,
  loading: false,
  logoutBusy: false,
});

const emit = defineEmits<{
  create: [];
  logout: [];
  select: [conversationId: string];
}>();

function friendlyTitle(title: string): string {
  return title === 'Untitled conversation' ? 'New adventure' : title;
}

function conversationIcon(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized.includes('space') || normalized.includes('planet')) return '🪐';
  if (normalized.includes('ocean') || normalized.includes('sea')) return '🐬';
  if (normalized.includes('story') || normalized.includes('dragon')) return '🐉';
  if (normalized.includes('quiz') || normalized.includes('learn')) return '💡';
  return '✨';
}
</script>
