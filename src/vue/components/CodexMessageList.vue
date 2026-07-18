<template>
  <div
    ref="element"
    class="codex-message-list message-list"
    :aria-label="ariaLabel"
    @scroll="updateStickiness"
  >
    <div class="codex-message-list__content">
      <slot v-if="chatMessages.length === 0" name="empty">
        <p class="codex-message-list__empty">{{ emptyLabel }}</p>
      </slot>
      <template v-for="(message, index) in chatMessages" v-else :key="message.id ?? index">
        <slot name="message" :message="message" :index="index">
          <CodexMessage
        :actions-disabled="actionsDisabled"
        :answered-client-request-ids="answeredClientRequestIds"
        :can-delete-message="canDeleteMessage"
        :can-edit-message="canEditMessage"
        :can-retry-message="canRetryMessage"
        :follow-ups-disabled="followUpsDisabled"
        :index="index"
            :message="message"
        @cancel="emit('cancel')"
        @client-response="emit('client-response', $event)"
        @copy-message="emit('copy-message', $event)"
        @delete-message="emit('delete-message', $event)"
        @edit-message="emit('edit-message', $event)"
        @quote-message="emit('quote-message', $event)"
        @review-file="emit('review-file', $event)"
        @retry-message="emit('retry-message', $event)"
        @send-follow-up="emit('send-follow-up', $event)"
        @undo-change-set="emit('undo-change-set', $event)"
          />
        </slot>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { SurfaceMessage } from '../../surface/types'
import type { ClientRequestResponse } from '../chat/contracts'
import type { Message } from '../chat/types'
import { chatMessagesFromInputs } from '../chat/renderer-message-adapter'
import CodexMessage from './CodexMessage.vue'

const props = withDefaults(defineProps<{
  actionsDisabled?: boolean
  ariaLabel?: string
  answeredClientRequestIds?: Set<string>
  bottomThreshold?: number
  canDeleteMessage?: boolean
  canEditMessage?: boolean
  canRetryMessage?: boolean
  emptyLabel?: string
  followUpsDisabled?: boolean
  messages: readonly (Message | SurfaceMessage)[]
}>(), {
  ariaLabel: 'Conversation',
  bottomThreshold: 24,
  canDeleteMessage: true,
  canEditMessage: true,
  canRetryMessage: true,
  emptyLabel: 'No messages yet',
})
const emit = defineEmits<{
  cancel: []
  'client-response': [response: ClientRequestResponse]
  'copy-message': [index: number]
  'delete-message': [index: number]
  'edit-message': [payload: { content: string; index: number }]
  'quote-message': [index: number]
  'review-file': [path: string]
  'retry-message': [index: number]
  'send-follow-up': [prompt: string]
  'stickiness-change': [stuckToBottom: boolean]
  'undo-change-set': [changeSetId: string]
}>()

const chatMessages = computed(() => chatMessagesFromInputs(props.messages))
const element = ref<HTMLElement | null>(null)
const stickToBottom = ref(true)

onMounted(async () => {
  await nextTick()
  scrollToBottom()
})

watch(() => props.messages, async () => {
  const shouldScroll = stickToBottom.value
  await nextTick()
  if (shouldScroll) {
    scrollToBottom()
  }
}, { deep: true })

function updateStickiness(): void {
  const target = element.value
  const next = target
    ? target.scrollHeight - target.scrollTop - target.clientHeight <= props.bottomThreshold
    : true
  if (stickToBottom.value !== next) {
    stickToBottom.value = next
    emit('stickiness-change', next)
  }
}

function scrollToBottom(): void {
  if (!element.value) {
    return
  }
  element.value.scrollTop = element.value.scrollHeight
  if (!stickToBottom.value) {
    stickToBottom.value = true
    emit('stickiness-change', true)
  }
}

defineExpose({ scrollToBottom })
</script>

<style scoped>
.codex-message-list {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  padding: var(--codex-message-list-padding, 24px 16px);
  overflow-y: auto;
  scrollbar-width: thin;
  box-sizing: border-box;
}

.codex-message-list__content {
  display: flex;
  flex-direction: column;
  gap: var(--codex-message-list-gap, 12px);
  width: min(100%, var(--codex-message-list-content-width, 900px));
  margin: 0 auto;
  padding: var(--codex-message-list-content-padding, 0);
  box-sizing: border-box;
}

.codex-message-list__empty {
  margin: auto;
  color: var(--codex-muted-text-color, #777b82);
  text-align: center;
}

.message-list {
  --codex-message-list-padding: var(--space-8) var(--space-16);
  --codex-message-list-gap: var(--space-8);
  --codex-message-list-content-width: var(--message-list-content-width, 100%);
  --codex-message-list-content-padding:
    calc(var(--message-list-content-padding-top, 0) + var(--space-2))
    0
    calc(var(--message-list-content-padding-bottom, 0) + var(--space-2));
}

</style>
