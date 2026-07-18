<template>
  <aside class="conversation-sidebar" aria-label="Conversations">
    <div class="conversation-sidebar__header">
      <span class="conversation-sidebar__brand">Codex</span>
      <button class="conversation-sidebar__new" type="button" :disabled="createDisabled" @click="emit('create')">
        <span aria-hidden="true">＋</span>
        New thread
      </button>
    </div>
    <p v-if="conversations.length === 0" class="conversation-sidebar__empty">
      {{ loading ? 'Loading threads…' : 'No conversations yet' }}
    </p>
    <nav v-else class="conversation-sidebar__list">
      <button
        v-for="conversation in conversations"
        :key="conversation.id"
        class="conversation-sidebar__item"
        :class="{ 'conversation-sidebar__item--active': conversation.id === activeConversationId }"
        type="button"
        :aria-current="conversation.id === activeConversationId ? 'page' : undefined"
        @click="emit('select', conversation.id)"
      >
        <span
          class="conversation-sidebar__status"
          :class="`conversation-sidebar__status--${conversation.status}`"
          :aria-label="`Status: ${conversation.status}`"
          :title="conversation.status"
        />
        <span class="conversation-sidebar__title">{{ conversation.title }}</span>
        <span class="conversation-sidebar__time">{{ relativeTime(conversation.updatedAt) }}</span>
      </button>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import type { CodexConversationSummary } from 'codex-app-sdk/surface';

withDefaults(defineProps<{
  activeConversationId?: string | null;
  conversations: readonly CodexConversationSummary[];
  createDisabled?: boolean;
  loading?: boolean;
}>(), {
  activeConversationId: null,
  createDisabled: false,
  loading: false,
});

const emit = defineEmits<{
  create: [];
  select: [conversationId: string];
}>();

function relativeTime(value: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (elapsedMinutes < 1) return 'now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
</script>

<style scoped>
.conversation-sidebar {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid #deded9;
  background: #f1f1ee;
}

.conversation-sidebar__header {
  display: grid;
  gap: 14px;
  padding: 24px 14px 12px;
}

.conversation-sidebar__brand {
  padding-left: 8px;
  color: #1f201e;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.conversation-sidebar__new,
.conversation-sidebar__item {
  width: 100%;
  border: 0;
  border-radius: 9px;
  color: #2a2b29;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.conversation-sidebar__new {
  padding: 9px 10px;
  font-weight: 600;
}

.conversation-sidebar__new:hover,
.conversation-sidebar__item:hover,
.conversation-sidebar__item--active {
  background: #e2e2dd;
}

.conversation-sidebar__list {
  display: flex;
  min-height: 0;
  padding: 2px 8px 12px;
  overflow-y: auto;
  flex-direction: column;
  gap: 2px;
}

.conversation-sidebar__item {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 9px 10px;
}

.conversation-sidebar__status {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a0a099;
}

.conversation-sidebar__status--active {
  background: #3b82f6;
  box-shadow: 0 0 0 3px rgb(59 130 246 / 14%);
}

.conversation-sidebar__status--error {
  background: #c2413b;
}

.conversation-sidebar__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-sidebar__time {
  color: #85857e;
  font-size: 12px;
}

.conversation-sidebar__empty {
  padding: 8px 18px;
  color: #85857e;
  font-size: 13px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
