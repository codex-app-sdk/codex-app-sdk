<template>
  <div
    ref="element"
    class="codex-chat-theme codex-message-list message-list"
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
            :plugins="plugins"
            :presentation="presentation"
            :show-tool-details="showToolDetails"
            :skills="skills"
            @cancel="emit('cancel')"
            @client-response="emit('client-response', $event)"
            @copy-message="emit('copy-message', $event)"
            @delete-message="emit('delete-message', $event)"
            @edit-message="emit('edit-message', $event)"
            @quote-message="emit('quote-message', $event)"
            @retry-message="emit('retry-message', $event)"
            @send-follow-up="emit('send-follow-up', $event)"
          >
            <template v-if="$slots.actions" #actions="scope"><slot name="actions" v-bind="scope" /></template>
            <template v-if="$slots.attachment" #attachment="scope"><slot name="attachment" v-bind="scope" /></template>
            <template v-if="$slots.block" #block="scope"><slot name="block" v-bind="scope" /></template>
            <template v-if="$slots.header" #header="scope"><slot name="header" v-bind="scope" /></template>
            <template v-if="$slots.status" #status="scope"><slot name="status" v-bind="scope" /></template>
            <template v-if="$slots.text" #text="scope"><slot name="text" v-bind="scope" /></template>
            <template v-if="$slots.thinking" #thinking="scope"><slot name="thinking" v-bind="scope" /></template>
            <template v-if="$slots.tool" #tool="scope"><slot name="tool" v-bind="scope" /></template>
          </CodexMessage>
        </slot>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { CodexSurfacePlugin, CodexSurfaceSkill, SurfaceMessage } from '../../surface/types'
import type { ClientRequestResponse, CodexConversationPresentation } from '../chat/contracts'
import type { Message } from '../chat/types'
import type { MessageBlock } from '../chat/message-blocks'
import { chatMessagesFromInputs } from '../chat/renderer-message-adapter'
import CodexMessage from './CodexMessage.vue'

const props = withDefaults(defineProps<{
  actionsDisabled?: boolean
  ariaLabel?: string
  answeredClientRequestIds?: ReadonlySet<string>
  bottomThreshold?: number
  canDeleteMessage?: boolean
  canEditMessage?: boolean
  canRetryMessage?: boolean
  emptyLabel?: string
  followUpsDisabled?: boolean
  messages: readonly (Message | SurfaceMessage)[]
  plugins?: readonly CodexSurfacePlugin[]
  presentation?: CodexConversationPresentation
  resetKey?: string | number | null
  showToolDetails?: boolean
  skills?: readonly CodexSurfaceSkill[]
}>(), {
  ariaLabel: 'Conversation',
  bottomThreshold: 24,
  canDeleteMessage: true,
  canEditMessage: true,
  canRetryMessage: true,
  emptyLabel: 'No messages yet',
  showToolDetails: undefined,
})

defineSlots<{
  actions(props: { disabled: boolean; index: number; message: Message }): unknown
  attachment(props: {
    attachment: Extract<MessageBlock, { type: 'attachment' }>['attachment']
    block: Extract<MessageBlock, { type: 'attachment' }>
    index: number
    message: Message
  }): unknown
  block(props: { block: MessageBlock; blockIndex: number; index: number; message: Message }): unknown
  empty(): unknown
  header(props: { index: number; message: Message }): unknown
  message(props: { index: number; message: Message }): unknown
  status(props: { index: number; message: Message; status: 'streaming' }): unknown
  text(props: { block: Extract<MessageBlock, { type: 'text' | 'user-text' }>; content: string; index: number; message: Message; user: boolean }): unknown
  thinking(props: { index: number; message: Message }): unknown
  tool(props: {
    block: Extract<MessageBlock, { type: 'tool' | 'tool-group' }>
    index: number
    message: Message
    toolCall?: Extract<MessageBlock, { type: 'tool' }>['toolCall']
    toolCalls?: Extract<MessageBlock, { type: 'tool-group' }>['toolCalls']
  }): unknown
}>()
const emit = defineEmits<{
  cancel: []
  'client-response': [response: ClientRequestResponse]
  'copy-message': [index: number]
  'delete-message': [index: number]
  'edit-message': [payload: { content: string; index: number }]
  'quote-message': [index: number]
  'retry-message': [index: number]
  'send-follow-up': [prompt: string]
  'stickiness-change': [stuckToBottom: boolean]
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

watch(() => props.resetKey, async () => {
  stickToBottom.value = true
  await nextTick()
  scrollToBottom()
})

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
  color: var(--codex-muted-text-color, var(--color-text-muted, #777b82));
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
