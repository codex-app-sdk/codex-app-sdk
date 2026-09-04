<template>
  <div
    class="codex-chat-theme codex-message-list"
    :aria-label="ariaLabel"
  >
    <div
      ref="scrollElement"
      class="codex-message-list__viewport message-list"
      @scroll="handleScroll"
    >
      <div class="codex-message-list__content">
        <slot v-if="displayEntries.length === 0" name="empty">
          <p class="codex-message-list__empty">{{ emptyLabel }}</p>
        </slot>
        <template v-for="entry in displayEntries" v-else :key="entry.key">
          <slot v-if="$slots.message" name="message" :message="chatMessageFromInput(entry.message)" :index="entry.index" />
          <CodexMessage
            v-else
            :actions-disabled="actionsDisabled"
            :actions-always-visible="shouldKeepAssistantActionsVisible(entry.index)"
            :answered-client-request-ids="answeredClientRequestIds"
            :can-delete-message="canDeleteMessage"
            :can-edit-message="canEditMessage"
            :can-fork-message="canForkMessage"
            :can-retry-message="canRetryMessage"
            :follow-ups-disabled="followUpsDisabled"
            :index="entry.index"
            :message="entry.message"
            :mention-groups="mentionGroups"
            :open-image="openImage"
            :plugins="plugins"
            :presentation="presentation"
            :show-tool-details="showToolDetails"
            :skills="skills"
            :thread-actions-disabled="busy"
            @cancel="emit('cancel')"
            @client-response="emit('client-response', $event)"
            @copy-message="emit('copy-message', $event)"
            @delete-message="emit('delete-message', $event)"
            @edit-message="emit('edit-message', $event)"
            @fork-message="emit('fork-message', $event)"
            @open-link="emit('open-link', $event)"
            @open-visualization="emit('open-visualization', $event)"
            @quote-message="emit('quote-message', $event)"
            @retry-message="emit('retry-message', $event)"
            @send-follow-up="emit('send-follow-up', $event)"
          >
            <template v-if="$slots.actions" #actions="scope"><slot name="actions" v-bind="scope" /></template>
            <template v-if="$slots.attachment" #attachment="scope"><slot name="attachment" v-bind="scope" /></template>
            <template v-if="$slots.block" #block="scope"><slot name="block" v-bind="scope" /></template>
            <template v-if="$slots.header" #header="scope"><slot name="header" v-bind="scope" /></template>
            <template v-if="$slots.mention" #mention="scope"><slot name="mention" v-bind="scope" /></template>
            <template v-if="$slots.status" #status="scope"><slot name="status" v-bind="scope" /></template>
            <template v-if="$slots.text" #text="scope"><slot name="text" v-bind="scope" /></template>
            <template v-if="$slots.thinking" #thinking="scope"><slot name="thinking" v-bind="scope" /></template>
            <template v-if="$slots.tool" #tool="scope"><slot name="tool" v-bind="scope" /></template>
          </CodexMessage>
        </template>
      </div>
    </div>
    <CodexScrollToBottom
      v-if="!stickToBottom"
      class="codex-message-list__scroll-to-bottom"
      :label="scrollToBottomLabel"
      @click="scrollToBottom"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  CodexConversationRenderStrategy,
  CodexSurfacePlugin,
  CodexSurfaceSkill,
  SurfaceMessage,
} from '@codex-app-sdk/core/surface'
import type { ClientRequestResponse, CodexConversationLink, CodexConversationPresentation } from '../chat/contracts'
import type { Message } from '../chat/types'
import type { MessageBlock } from '../chat/message-blocks'
import type { CodexMessageImageOpenHandler } from '../chat/message-image'
import type { CodexConversationVisualization } from '../chat/visualization'
import { chatMessageFromInput } from '../chat/renderer-message-adapter'
import CodexMessage from './CodexMessage.vue'
import CodexScrollToBottom from './CodexScrollToBottom.vue'
import type { CodexComposerMentionGroup, CodexComposerMentionItem } from '../chat/composer-mentions-custom'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  actionsDisabled?: boolean
  ariaLabel?: string
  answeredClientRequestIds?: ReadonlySet<string>
  busy?: boolean
  bottomThreshold?: number
  canDeleteMessage?: boolean
  canEditMessage?: boolean
  canForkMessage?: boolean
  canRetryMessage?: boolean
  emptyLabel?: string
  followUpsDisabled?: boolean
  hasOlderMessages?: boolean
  renderStrategy?: CodexConversationRenderStrategy
  /** @deprecated Use renderStrategy instead. */
  lazyMessages?: boolean
  initialMessageBatchSize?: number
  loadingOlderMessages?: boolean
  messageBatchSize?: number
  messages: readonly (Message | SurfaceMessage)[]
  mentionGroups?: readonly CodexComposerMentionGroup[]
  openImage?: CodexMessageImageOpenHandler
  transformMessage?: (message: Message | SurfaceMessage, index: number) => Message | SurfaceMessage
  plugins?: readonly CodexSurfacePlugin[]
  presentation?: CodexConversationPresentation
  resetKey?: string | number | null
  scrollToBottomLabel?: string
  showToolDetails?: boolean
  skills?: readonly CodexSurfaceSkill[]
}>(), {
  ariaLabel: 'Conversation',
  busy: false,
  bottomThreshold: 24,
  canDeleteMessage: true,
  canEditMessage: true,
  canForkMessage: false,
  canRetryMessage: true,
  emptyLabel: 'No messages yet',
  hasOlderMessages: false,
  lazyMessages: undefined,
  loadingOlderMessages: false,
  scrollToBottomLabel: 'Scroll to bottom',
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
  mention(props: { group: CodexComposerMentionGroup; index: number; item: CodexComposerMentionItem; message: Message; surface: 'message' }): unknown
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
  'fork-message': [index: number]
  'load-older-messages': []
  'open-link': [link: CodexConversationLink]
  'open-visualization': [visualization: CodexConversationVisualization]
  'quote-message': [index: number]
  'retry-message': [index: number]
  'send-follow-up': [prompt: string]
  'stickiness-change': [stuckToBottom: boolean]
}>()
// Stryker restore all

const thinkingPlaceholder: SurfaceMessage = {
  id: 'codex-thinking-placeholder',
  role: 'assistant',
  status: 'streaming',
  parts: [],
}
const effectiveRenderStrategy = computed<CodexConversationRenderStrategy>(() => (
  props.renderStrategy ?? (props.lazyMessages === false ? 'eager' : 'lazy')
))
const effectiveInitialMessageBatchSize = computed(() => (
  props.initialMessageBatchSize ?? props.messageBatchSize ?? 50
))
const effectiveMessageBatchSize = computed(() => props.messageBatchSize ?? 25)
const renderStartIndex = ref(initialRenderStart(
  props.messages,
  effectiveInitialMessageBatchSize.value,
))
type MessageIdentity = string | object | null
let renderedAnchor = messageIdentityAt(props.messages, renderStartIndex.value)
let observedMessagesLength = props.messages.length
let observedFirstMessage = messageIdentityAt(props.messages, 0)
let observedLastMessage = messageIdentityAt(props.messages, props.messages.length - 1)
const loadingOlderMessages = ref(false)
let olderMessagesRequestPending = false
const hasStreamingAssistant = computed(() => props.messages.some((message) => (
  message.role === 'assistant' && (
    'content' in message
      ? message.streaming === true
        || (message.type === 'compaction' && message.compactionStatus === 'running')
      : message.status === 'streaming'
  )
)))
const visibleMessages = computed(() => effectiveRenderStrategy.value === 'lazy'
  ? props.messages.slice(renderStartIndex.value)
  : props.messages)
const displayEntries = computed(() => {
  const entries = visibleMessages.value.map((message, offset) => ({
    index: effectiveRenderStrategy.value === 'lazy' ? renderStartIndex.value + offset : offset,
    message: props.transformMessage?.(
      message,
      effectiveRenderStrategy.value === 'lazy' ? renderStartIndex.value + offset : offset,
    ) ?? message,
    key: message.id ?? (effectiveRenderStrategy.value === 'lazy' ? renderStartIndex.value + offset : offset),
  }))
  if (props.busy && !hasStreamingAssistant.value) {
    entries.push({ index: props.messages.length, message: thinkingPlaceholder, key: thinkingPlaceholder.id })
  }
  return entries
})
const latestAssistantIndex = computed(() => [...displayEntries.value]
  .reverse()
  .find((entry) => entry.message.role === 'assistant')
  ?.index)

function shouldKeepAssistantActionsVisible(index: number): boolean {
  return index === latestAssistantIndex.value
}

const scrollElement = ref<HTMLElement | null>(null)
const stickToBottom = ref(true)
let contentObserver: MutationObserver | null = null
let contentResizeObserver: ResizeObserver | null = null
let scrollFrame: number | ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  await nextTick()
  scrollToBottom()
  const content = scrollElement.value?.querySelector('.codex-message-list__content')
  if (content && typeof MutationObserver !== 'undefined') {
    contentObserver = new MutationObserver(() => {
      if (stickToBottom.value) queueScrollToBottom()
    })
    contentObserver.observe(content, { childList: true, characterData: true, subtree: true })
  }
  if (content && typeof ResizeObserver !== 'undefined') {
    contentResizeObserver = new ResizeObserver(() => {
      if (stickToBottom.value) queueScrollToBottom()
    })
    contentResizeObserver.observe(content)
  }
  queueScrollToBottom()
})

watch(() => props.messages.length, async (nextLength) => {
  const previousLength = observedMessagesLength
  const target = scrollElement.value!
  const previousHeight = target.scrollHeight
  const previousTop = target.scrollTop
  observedMessagesLength = nextLength
  const revealedPrependedMessages = effectiveRenderStrategy.value === 'lazy'
    ? reconcileMessageWindow(nextLength, previousLength)
    : false
  observeMessageBounds()
  const shouldScroll = !revealedPrependedMessages && isAtBottom()
  await nextTick()
  if (revealedPrependedMessages && target) {
    target.scrollTop = previousTop + target.scrollHeight - previousHeight
  } else if (shouldScroll) {
    scrollToBottom()
  }
})

watch(() => props.resetKey, async () => {
  setRenderStartIndex(initialRenderStart(props.messages, effectiveInitialMessageBatchSize.value))
  loadingOlderMessages.value = false
  olderMessagesRequestPending = false
  observeMessageBounds()
  await nextTick()
  scrollToBottom()
})

watch(() => [props.loadingOlderMessages, props.hasOlderMessages] as const, () => {
  olderMessagesRequestPending = false
})

watch(() => [effectiveRenderStrategy.value, effectiveInitialMessageBatchSize.value, effectiveMessageBatchSize.value] as const, async () => {
  if (effectiveRenderStrategy.value === 'lazy') {
    setRenderStartIndex(initialRenderStart(props.messages, effectiveInitialMessageBatchSize.value))
    observeMessageBounds()
    await nextTick()
    if (stickToBottom.value) scrollToBottom()
  }
})

function handleScroll(): void {
  updateStickiness()
  if (effectiveRenderStrategy.value === 'lazy' && isWithinTopPrefetchRange() && renderStartIndex.value <= 0 && props.hasOlderMessages && !props.loadingOlderMessages) {
    requestOlderMessages()
  } else if (effectiveRenderStrategy.value === 'lazy' && isWithinTopPrefetchRange()) {
    void loadOlderMessages()
  }
}

function requestOlderMessages(): void {
  if (!props.hasOlderMessages || props.loadingOlderMessages || olderMessagesRequestPending) return
  olderMessagesRequestPending = true
  emit('load-older-messages')
}

function isWithinTopPrefetchRange(): boolean {
  const target = scrollElement.value!
  return target.scrollTop <= target.clientHeight
}

async function loadOlderMessages(): Promise<void> {
  if (loadingOlderMessages.value || renderStartIndex.value <= 0) return
  const target = scrollElement.value!
  const previousHeight = target.scrollHeight
  const previousTop = target.scrollTop
  loadingOlderMessages.value = true
  setRenderStartIndex(Math.max(0, renderStartIndex.value - normalizedBatchSize(effectiveMessageBatchSize.value)))
  await nextTick()
  target.scrollTop = previousTop + target.scrollHeight - previousHeight
  loadingOlderMessages.value = false
  if (renderStartIndex.value <= 0) requestOlderMessages()
}

function reconcileMessageWindow(nextLength: number, previousLength: number): boolean {
  const batchSize = normalizedBatchSize(effectiveInitialMessageBatchSize.value)
  const previousTailStart = Math.max(0, previousLength - batchSize)
  const wasTailWindow = renderStartIndex.value === previousTailStart
  if (nextLength < previousLength) {
    setRenderStartIndex(initialRenderStart(props.messages, effectiveInitialMessageBatchSize.value))
    return false
  }

  const anchorIndex = findMessageIndex(props.messages, renderedAnchor)
  const hasPrependedMessages = anchorIndex >= 0 && !sameMessageIdentity(
    messageIdentityAt(props.messages, 0),
    observedFirstMessage,
  );
  if (hasPrependedMessages) {
    // Once the viewport is pinned at the rendered top, another upward gesture
    // cannot fire a scroll event. Reveal the first server-prepended batch now.
    const revealOlderBatch = renderStartIndex.value <= 0 && isWithinTopPrefetchRange()
    setRenderStartIndex(revealOlderBatch
      ? Math.max(0, anchorIndex - normalizedBatchSize(effectiveMessageBatchSize.value))
      : isAtBottom()
        ? Math.max(0, nextLength - batchSize)
        : anchorIndex)
    return revealOlderBatch
  }

  const hasAppendedMessages = sameMessageIdentity(
    messageIdentityAt(props.messages, 0),
    observedFirstMessage,
  ) && !sameMessageIdentity(
    messageIdentityAt(props.messages, nextLength - 1),
    observedLastMessage,
  );
  if (hasAppendedMessages && isAtBottom() && wasTailWindow) {
    setRenderStartIndex(Math.max(0, nextLength - batchSize))
  }
  return false
}

function setRenderStartIndex(nextIndex: number): void {
  renderStartIndex.value = nextIndex
  renderedAnchor = messageIdentityAt(props.messages, nextIndex)
}

function observeMessageBounds(): void {
  observedMessagesLength = props.messages.length
  observedFirstMessage = messageIdentityAt(props.messages, 0)
  observedLastMessage = messageIdentityAt(props.messages, props.messages.length - 1)
}

function messageIdentityAt(messages: readonly (Message | SurfaceMessage)[], index: number): MessageIdentity {
  const message = messages[index]
  return message ? message.id ?? message : null
}

function sameMessageIdentity(left: MessageIdentity, right: MessageIdentity): boolean {
  return left === right
}

function findMessageIndex(messages: readonly (Message | SurfaceMessage)[], identity: MessageIdentity): number {
  return messages.findIndex((message) => sameMessageIdentity(message.id ?? message, identity))
}

function normalizedBatchSize(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? 25))
}

function initialRenderStart(
  messages: readonly (Message | SurfaceMessage)[],
  batchSize: number | undefined,
): number {
  return tailRenderStart(messages, normalizedBatchSize(batchSize))
}

function tailRenderStart(messages: readonly (Message | SurfaceMessage)[], batchSize: number): number {
  return Math.max(0, messages.length - batchSize)
}

function updateStickiness(): void {
  const next = isAtBottom()
  if (stickToBottom.value !== next) {
    stickToBottom.value = next
    emit('stickiness-change', next)
  }
}

function isAtBottom(): boolean {
  const target = scrollElement.value
  return target
    ? target.scrollHeight - target.scrollTop - target.clientHeight <= props.bottomThreshold
    : stickToBottom.value
}

function scrollToBottom(): void {
  if (!scrollElement.value) {
    return
  }
  scrollElement.value.scrollTop = scrollElement.value.scrollHeight
  if (!stickToBottom.value) {
    stickToBottom.value = true
    emit('stickiness-change', true)
  }
}

function queueScrollToBottom(): void {
  if (scrollFrame !== null) return
  const callback = () => {
    scrollFrame = null
    scrollToBottom()
  }
  scrollFrame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 0)
}

onBeforeUnmount(() => {
  contentObserver?.disconnect()
  contentObserver = null
  contentResizeObserver?.disconnect()
  contentResizeObserver = null
  if (scrollFrame !== null) {
    if (typeof scrollFrame === 'number' && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(scrollFrame)
    } else {
      clearTimeout(scrollFrame)
    }
  }
})

defineExpose({ scrollToBottom })
</script>

<style scoped>
.codex-message-list {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
}

.codex-message-list__viewport {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  padding: var(--codex-message-list-padding, 24px 16px);
  overflow-y: auto;
  scrollbar-width: thin;
  box-sizing: border-box;
}

.codex-message-list__scroll-to-bottom {
  position: absolute;
  right: 50%;
  bottom: var(--codex-scroll-to-bottom-offset, var(--space-8));
  z-index: 1;
  transform: translateX(50%);
}

.codex-message-list__scroll-to-bottom:active {
  transform: translateX(50%) scale(0.96);
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

.codex-message-list__content :deep(.chat-message),
.codex-message-list__content :deep(.chat-compaction-message) {
  content-visibility: auto;
  contain-intrinsic-size: auto 120px;
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
