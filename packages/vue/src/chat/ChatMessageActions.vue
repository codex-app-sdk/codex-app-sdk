<template>
  <div
    class="codex-chat-theme chat-message-actions"
    :class="`chat-message-actions--${message.role}`"
    :aria-busy="deleting ? 'true' : undefined"
    :aria-label="t('chat.actions.label')"
  >
    <span
      v-if="sentAtLabel && message.role === 'user'"
      class="chat-message-actions__sent-at"
      :title="sentAtTitle"
    >
      {{ sentAtLabel }}
    </span>
    <ChatCopyButton
      v-if="showCopy"
      :action="copyMessage"
      :copied-label="t('chat.actions.copied')"
      :disabled="deleting"
      :label="t('chat.actions.copy')"
    />
    <ChatIconButton
      v-if="message.role === 'user' && canEdit && showEdit"
      :disabled="deleting"
      :label="t('chat.actions.edit')"
      @click="emit('edit')"
    >
      <PencilIcon />
    </ChatIconButton>
    <ChatIconButton
      v-if="message.role === 'user' && showQuote"
      :disabled="deleting"
      :label="t('chat.actions.quote')"
      @click="emit('quote')"
    >
      <QuoteIcon />
    </ChatIconButton>
    <ChatIconButton
      v-if="message.role === 'assistant' && canRetry && showRetry"
      :disabled="mutationDisabled || deleting"
      :label="t('chat.actions.retry')"
      @click="emit('retry')"
    >
      <RotateClockwiseIcon />
    </ChatIconButton>
    <ChatIconButton
      v-if="canFork && showFork"
      :disabled="mutationDisabled || deleting"
      :label="t('chat.actions.fork')"
      @click="emit('fork')"
    >
      <ArrowForkIcon class="chat-message-actions__fork-icon" />
    </ChatIconButton>
    <ChatIconButton
      v-if="canDelete && showDelete"
      danger
      :disabled="mutationDisabled || deleting"
      :label="deleting ? t('chat.actions.deleting') : t('chat.actions.delete')"
      @click="emit('delete')"
    >
      <Loader2Icon v-if="deleting" class="chat-message-actions__spinner" />
      <Trash2Icon v-else />
    </ChatIconButton>
    <span
      v-if="sentAtLabel && message.role === 'assistant'"
      class="chat-message-actions__sent-at"
      :title="sentAtTitle"
    >
      {{ sentAtLabel }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { ArrowForkIcon, Loader2Icon, PencilIcon, QuoteIcon, RotateClockwiseIcon, Trash2Icon } from '../icons/app-icons'
import { computed } from 'vue'
import { useCodexChatTranslate } from './chat-i18n'
import ChatCopyButton from './ChatCopyButton.vue'
import ChatIconButton from './ChatIconButton.vue'
import { formatMessageSentAt, fullMessageSentAt } from './message-time'
import type { CodexMessageActionsPresentation } from './contracts'
import type { Message } from './types'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  canDelete?: boolean
  canEdit?: boolean
  canFork?: boolean
  canRetry?: boolean
  copyAction?: () => Promise<void> | void
  deleting?: boolean
  message: Message
  mutationDisabled?: boolean
  presentation?: CodexMessageActionsPresentation
}>(), {
  canDelete: true,
  canEdit: true,
  canFork: false,
  canRetry: true,
})
// Stryker restore all

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const emit = defineEmits<{
  copy: []
  delete: []
  edit: []
  fork: []
  quote: []
  retry: []
}>()
// Stryker restore all
const t = useCodexChatTranslate()
const showCopy = computed(() => props.presentation?.copy !== false)
const showDelete = computed(() => props.presentation?.delete !== false)
const showEdit = computed(() => props.presentation?.edit !== false)
const showFork = computed(() => props.presentation?.fork !== false)
const showQuote = computed(() => props.presentation?.quote !== false)
const showRetry = computed(() => props.presentation?.retry !== false)
const sentAtLabel = computed(() => props.message.createdAt ? formatMessageSentAt(props.message.createdAt) : '')
const sentAtTitle = computed(() => props.message.createdAt ? fullMessageSentAt(props.message.createdAt) : undefined)

async function copyMessage() {
  await props.copyAction?.()
  emit('copy')
}
</script>

<style scoped>
.chat-message-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) 0;
}

.chat-message-actions--user {
  justify-content: flex-end;
}

.chat-message-actions--assistant {
  justify-content: flex-start;
}

.chat-message-actions__sent-at {
  color: var(--color-outline);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-16);
  white-space: nowrap;
}

.chat-message-actions__fork-icon {
  transform: rotate(90deg);
}

.chat-message-actions__spinner {
  animation: chat-message-actions-spin 800ms linear infinite;
}

@keyframes chat-message-actions-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
