<template>
  <div
    class="codex-chat-theme codex-message-list"
    :aria-label="ariaLabel"
  >
    <div
      ref="scrollElement"
      class="codex-message-list__viewport message-list"
      @click.capture="handleViewportClick"
      @pointerdown="handleSelectionPointerDown"
      @scroll="handleScroll"
    >
      <div class="codex-message-list__content">
        <slot v-if="displayEntries.length === 0" name="empty">
          <p class="codex-message-list__empty">{{ emptyLabel }}</p>
        </slot>
        <CodexMessageTurn
          v-for="group in displayGroups"
          v-else
          :key="group.key"
          :entries="group.entries"
          :answered-client-request-ids="answeredClientRequestIds"
          :active="activeOverrideForGroup(group)"
          :show-tool-blocks="effectivePresentation.messages.toolBlocks"
          :status="group.turnId ? turnStatusById.get(group.turnId) : undefined"
          :turn-id="group.turnId"
        >
          <template v-for="entry in group.entries" :key="entry.key">
            <div
              class="codex-message-list__entry"
              :data-codex-message-index="entry.index"
            >
              <slot v-if="$slots.message" name="message" :message="chatMessageFromInput(displayMessage(entry.message, group.turnId))" :index="entry.index" />
              <CodexMessage
                v-else
                :activity-state="entry.activityState"
                :actions-disabled="actionsDisabled"
                :actions-always-visible="shouldKeepAssistantActionsVisible(entry.index)"
                :answered-client-request-ids="answeredClientRequestIds"
                :can-delete-turn="canDeleteTurn && isTerminalTurn(group.turnId)"
                :can-edit-turn="canEditTurn && isTerminalTurn(group.turnId)"
                :can-fork-turn="canForkTurn && isForkableTurn(group.turnId)"
                :can-retry-turn="canRetryTurn && isTerminalTurn(group.turnId)"
                :deleting-turn="group.turnId === deletingTurnId"
                :follow-ups-disabled="followUpsDisabled"
                :hidden-client-request-ids="hiddenClientRequestIds"
                :index="entry.index"
                :message="displayMessage(entry.message, group.turnId)"
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
                @delete-turn="emit('delete-turn', $event)"
                @edit-turn="emit('edit-turn', $event)"
                @fork-turn="emit('fork-turn', $event)"
                @open-link="emit('open-link', $event)"
                @open-visualization="emit('open-visualization', $event)"
                @quote-message="emit('quote-message', $event)"
                @retry-turn="emit('retry-turn', $event)"
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
            </div>
          </template>
        </CodexMessageTurn>
      </div>
    </div>
    <CodexScrollToBottom
      v-if="overflown"
      class="codex-message-list__scroll-to-bottom"
      :label="scrollToBottomLabel"
      @click="scrollToBottom"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowReactive, watch } from 'vue'
import { questionResponsesKey } from '../chat/message-work-state'
import type {
  CodexConversationRenderStrategy,
  CodexSurfacePlugin,
  CodexSurfaceSkill,
  CodexSurfaceTurn,
  SurfaceMessage,
} from '@codex-app-sdk/core/surface'
import type { ClientRequestResponse, CodexConversationLink, CodexConversationPresentation } from '../chat/contracts'
import { resolveCodexConversationPresentation } from '../chat/contracts'
import type { Message } from '../chat/types'
import type { MessageBlock } from '../chat/message-blocks'
import type { CodexMessageImageOpenHandler } from '../chat/message-image'
import type { CodexConversationVisualization } from '../chat/visualization'
import type { CodexMessageTextSelection } from '../chat/message-text-selection'
import { chatMessageFromInput } from '../chat/renderer-message-adapter'
import { filterVisibleMessageTools, type CodexToolVisibility } from '../chat/tool-visibility'
import CodexMessage from './CodexMessage.vue'
import CodexMessageTurn from './CodexMessageTurn.vue'
import CodexScrollToBottom from './CodexScrollToBottom.vue'
import type { CodexComposerMentionGroup, CodexComposerMentionItem } from '../chat/composer-mentions-custom'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  actionsDisabled?: boolean
  activeTurnId?: string | null
  ariaLabel?: string
  answeredClientRequestIds?: ReadonlySet<string>
  busy?: boolean
  bottomThreshold?: number
  canDeleteTurn?: boolean
  canEditTurn?: boolean
  canForkTurn?: boolean
  canRetryTurn?: boolean
  deletingTurnId?: string | null
  emptyLabel?: string
  followUpsDisabled?: boolean
  hasOlderMessages?: boolean
  hiddenClientRequestIds?: ReadonlySet<string>
  renderStrategy?: CodexConversationRenderStrategy
  /** @deprecated Use renderStrategy instead. */
  lazyMessages?: boolean
  initialMessageBatchSize?: number
  loadingOlderMessages?: boolean
  messageBatchSize?: number
  messageTextSelection?: boolean
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
  toolVisibility?: CodexToolVisibility
  turns?: readonly CodexSurfaceTurn[]
}>(), {
  ariaLabel: 'Conversation',
  busy: false,
  bottomThreshold: 24,
  canDeleteTurn: true,
  canEditTurn: true,
  canForkTurn: false,
  canRetryTurn: true,
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
  'delete-turn': [turnId: string]
  'edit-turn': [payload: { content: string; turnId: string }]
  'fork-turn': [turnId: string]
  'load-older-messages': []
  'message-text-selection-change': [selection: CodexMessageTextSelection | null]
  'open-link': [link: CodexConversationLink]
  'open-visualization': [visualization: CodexConversationVisualization]
  'quote-message': [index: number]
  'retry-turn': [turnId: string]
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
const questionResponses = inject(questionResponsesKey, undefined)
  ?? shallowReactive(new Map<string, ClientRequestResponse['payload']>())
provide(questionResponsesKey, questionResponses)
watch(() => props.messages, (messages) => {
  const answers: Record<string, { answers: string[] }> = {}
  const requestIds = new Set<string>()
  for (const message of messages) {
    if (!('metadata' in message)) continue
    const stored = message.metadata?.asyncQuestionAnswers
    if (!stored || typeof stored !== 'object') continue
    for (const [id, value] of Object.entries(stored)) {
      if (value && typeof value === 'object' && 'answers' in value
        && Array.isArray(value.answers) && value.answers.every((answer: unknown) => typeof answer === 'string')) {
        answers[id] = { answers: value.answers }
      }
    }
  }
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'question') continue
      requestIds.add(part.request.id)
      const restored = Object.fromEntries(part.request.payload.request.questions
        .filter((question) => answers[question.id])
        .map((question) => [question.id, answers[question.id]!]))
      if (Object.keys(restored).length > 0) questionResponses.set(part.request.id, { answers: restored })
    }
  }
  for (const id of questionResponses.keys()) {
    if (!requestIds.has(id)) questionResponses.delete(id)
  }
}, { immediate: true })

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
type ConversationScrollState = {
  renderedAnchor: MessageIdentity
  scrollTop: number
  stickToBottom: boolean
}
const conversationScrollStates = new Map<string | number, ConversationScrollState>()
let renderedAnchor = messageIdentityAt(props.messages, renderStartIndex.value)
let observedMessagesLength = props.messages.length
let observedFirstMessage = messageIdentityAt(props.messages, 0)
let observedLastMessage = messageIdentityAt(props.messages, props.messages.length - 1)
const loadingOlderMessages = ref(false)
let olderMessagesRequestPending = false
const visibleMessages = computed(() => effectiveRenderStrategy.value === 'lazy'
  ? props.messages.slice(renderStartIndex.value)
  : props.messages)
type DisplayEntry = {
  index: number
  message: Message | SurfaceMessage
  key: string | number
  activityState?: 'working'
}
const displayEntries = computed<DisplayEntry[]>(() => {
  let lastUserIndex = -1
  for (let index = props.messages.length - 1; index >= 0; index--) {
    if (props.messages[index]?.role !== 'user') continue
    lastUserIndex = index
    break
  }
  let hiddenCurrentTurnActivity = false
  const entries: DisplayEntry[] = visibleMessages.value.flatMap((message, offset) => {
    const index = effectiveRenderStrategy.value === 'lazy' ? renderStartIndex.value + offset : offset
    const transformed = props.transformMessage?.(message, index) ?? message
    const visible = filterVisibleMessageTools(transformed, props.toolVisibility)
    if (!visible && transformed.role === 'assistant' && (
      props.activeTurnId
        ? chatMessageFromInput(transformed).turnId === props.activeTurnId
        : index > lastUserIndex
    )) hiddenCurrentTurnActivity = true
    return visible ? [{ index, message: visible, key: message.id ?? index }] : []
  })
  const hasStreamingAssistant = entries.some(({ message }) => (
    message.role === 'assistant' && (
      'content' in message
        ? message.streaming === true
          || (message.type === 'compaction' && message.compactionStatus === 'running')
        : message.status === 'streaming'
    )
  ))
  if (props.busy && !hasStreamingAssistant) {
    const turnId = entries.length > 0
      ? chatMessageFromInput(entries.at(-1)!.message).turnId?.trim() || undefined
      : undefined
    entries.push({
      index: props.messages.length,
      message: turnId ? { ...thinkingPlaceholder, turnId } : thinkingPlaceholder,
      key: thinkingPlaceholder.id,
      ...(hiddenCurrentTurnActivity ? { activityState: 'working' } : {}),
    })
  }
  return entries
})
const effectivePresentation = computed(() => resolveCodexConversationPresentation(props.presentation))
const displayGroups = computed(() => {
  const groups: Array<{
    entries: typeof displayEntries.value
    key: string | number
    turnId?: string
  }> = []
  for (const entry of displayEntries.value) {
    const turnId = chatMessageFromInput(entry.message).turnId?.trim() || undefined
    const previous = groups.at(-1)
    if (turnId && previous?.turnId === turnId) {
      previous.entries.push(entry)
      continue
    }
    groups.push({
      entries: [entry],
      key: turnId ? `turn:${turnId}` : entry.key,
      ...(turnId ? { turnId } : {}),
    })
  }
  return groups
})

function activeOverrideForGroup(group: (typeof displayGroups.value)[number]): boolean | undefined {
  if (props.busy && group.entries.some(({ index, message }) => (
    index < props.messages.length
    && message.role === 'assistant'
    && chatMessageFromInput(message).streaming === true
  ))) return true
  if (props.activeTurnId === undefined) return undefined
  return group.turnId !== undefined && group.turnId === props.activeTurnId
}
const inferredActiveTurnId = computed(() => {
  if (props.activeTurnId !== undefined && props.activeTurnId !== null) return props.activeTurnId
  const streamingTurnId = props.busy
    ? [...props.messages]
        .reverse()
        .map(chatMessageFromInput)
        .find((message) => message.role === 'assistant' && message.streaming)
        ?.turnId?.trim()
    : undefined
  return streamingTurnId || null
})
const turnStatusById = computed(() => new Map(
  props.turns?.map((turn) => [turn.id, turn.status] as const) ?? [],
))

function isTerminalTurn(turnId: string | undefined): boolean {
  if (!turnId || turnId === inferredActiveTurnId.value) return false
  return turnStatusById.value.get(turnId) !== 'inProgress'
}

function displayMessage(message: Message | SurfaceMessage, turnId: string | undefined): Message | SurfaceMessage {
  const status = turnId ? turnStatusById.value.get(turnId) : undefined
  if (!status || status === 'inProgress' || turnId === inferredActiveTurnId.value) return message
  if ('content' in message) {
    return message.streaming ? { ...message, streaming: false } : message
  }
  return message.status === 'streaming'
    ? { ...message, status: 'complete' }
    : message
}

function isForkableTurn(turnId: string | undefined): boolean {
  if (!isTerminalTurn(turnId)) return false
  const status = turnStatusById.value.get(turnId!)
  return status === undefined || status === 'completed'
}
const latestAssistantIndex = computed(() => [...displayEntries.value]
  .reverse()
  .find((entry) => entry.message.role === 'assistant')
  ?.index)

function shouldKeepAssistantActionsVisible(index: number): boolean {
  return index === latestAssistantIndex.value
}

const scrollElement = ref<HTMLElement | null>(null)
const tail = ref(true)
const overflown = ref(false)
let contentResizeObserver: ResizeObserver | null = null
let scrollFrame: number | ReturnType<typeof setTimeout> | null = null
let lastScrollTop = 0
let pointerSelecting = false
let lastTextSelection: CodexMessageTextSelection | null = null

onMounted(async () => {
  document.addEventListener('pointerup', handleSelectionPointerUp)
  document.addEventListener('selectionchange', handleDocumentSelectionChange)
  await nextTick()
  scrollToBottom()
  const content = scrollElement.value?.querySelector('.codex-message-list__content')
  if (content && typeof ResizeObserver !== 'undefined') {
    contentResizeObserver = new ResizeObserver(() => {
      if (tail.value) queueScrollToBottom()
      else updateOverflow()
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
  const shouldScroll = !revealedPrependedMessages && tail.value && isAtBottom()
  await nextTick()
  if (revealedPrependedMessages && target) {
    target.scrollTop = previousTop + target.scrollHeight - previousHeight
  } else if (shouldScroll) {
    scrollToBottom()
  }
})

watch(
  [() => props.resetKey, () => props.messages.length, () => props.messages.at(-1)] as const,
  ([conversationKey, length, message], [previousConversationKey, previousLength, previousMessage]) => {
    if (conversationKey !== previousConversationKey || length !== previousLength || !message || !previousMessage) return
    if (message.id && previousMessage.id && message.id !== previousMessage.id) return
    onNewChunk()
  },
)

watch(() => props.messageTextSelection, (enabled) => {
  if (!enabled) clearMessageTextSelection()
})

watch(() => props.resetKey, async (nextKey, previousKey) => {
  clearMessageTextSelection()
  const target = scrollElement.value
  if (target && previousKey !== null && previousKey !== undefined) {
    conversationScrollStates.set(previousKey, {
      renderedAnchor,
      scrollTop: target.scrollTop,
      stickToBottom: isAtBottom(),
    })
  }
  const restoredState = nextKey === null || nextKey === undefined
    ? undefined
    : conversationScrollStates.get(nextKey)
  const restoredAnchorIndex = restoredState
    ? findMessageIndex(props.messages, restoredState.renderedAnchor)
    : -1
  setRenderStartIndex(restoredAnchorIndex >= 0
    ? restoredAnchorIndex
    : initialRenderStart(props.messages, effectiveInitialMessageBatchSize.value))
  loadingOlderMessages.value = false
  olderMessagesRequestPending = false
  setTail(restoredState?.stickToBottom ?? true)
  observeMessageBounds()
  await nextTick()
  if (restoredState && target) {
    target.scrollTop = restoredState.stickToBottom
      ? target.scrollHeight
      : restoredState.scrollTop
    updateOverflow()
  } else {
    scrollToBottom()
  }
})

watch(() => [props.loadingOlderMessages, props.hasOlderMessages] as const, () => {
  olderMessagesRequestPending = false
})

watch(() => [effectiveRenderStrategy.value, effectiveInitialMessageBatchSize.value, effectiveMessageBatchSize.value] as const, async () => {
  if (effectiveRenderStrategy.value === 'lazy') {
    setRenderStartIndex(initialRenderStart(props.messages, effectiveInitialMessageBatchSize.value))
    observeMessageBounds()
    await nextTick()
    if (tail.value) scrollToBottom()
  }
})

function handleScroll(): void {
  clearMessageTextSelection()
  const target = scrollElement.value
  const scrolledUp = target !== null && target.scrollTop < lastScrollTop
  if (target) lastScrollTop = target.scrollTop
  updateOverflow()
  if (!overflown.value) setTail(true)
  else if (scrolledUp) setTail(false)
  if (effectiveRenderStrategy.value === 'lazy' && isWithinTopPrefetchRange() && renderStartIndex.value <= 0 && props.hasOlderMessages && !props.loadingOlderMessages) {
    requestOlderMessages()
  } else if (effectiveRenderStrategy.value === 'lazy' && isWithinTopPrefetchRange()) {
    void loadOlderMessages()
  }
}

function onNewChunk(): void {
  if (tail.value) queueScrollToBottom()
  else void nextTick(updateOverflow)
}

function handleViewportClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element) || !target.closest('.chat-work-group__header')) return
  setTail(false)
}

function handleSelectionPointerDown(): void {
  if (props.messageTextSelection) pointerSelecting = true
}

function handleSelectionPointerUp(): void {
  if (!pointerSelecting) return
  pointerSelecting = false
  updateMessageTextSelection()
}

function handleDocumentSelectionChange(): void {
  if (!props.messageTextSelection || pointerSelecting) return
  updateMessageTextSelection()
}

function updateMessageTextSelection(): void {
  if (!props.messageTextSelection) {
    clearMessageTextSelection()
    return
  }
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    clearMessageTextSelection()
    return
  }
  const text = selection.toString().trim()
  const range = selection.getRangeAt(0)
  const startEntry = messageEntryForNode(range.startContainer)
  const endEntry = messageEntryForNode(range.endContainer)
  if (!text || !startEntry || startEntry !== endEntry) {
    clearMessageTextSelection()
    return
  }
  const messageIndex = Number.parseInt(startEntry.dataset.codexMessageIndex ?? '', 10)
  const entry = displayEntries.value.find((candidate) => candidate.index === messageIndex)
  if (!entry) {
    clearMessageTextSelection()
    return
  }
  const rect = range.getBoundingClientRect()
  const message = chatMessageFromInput(entry.message)
  const next: CodexMessageTextSelection = {
    anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    messageIndex,
    role: message.role,
    text,
    ...(message.id ? { messageId: message.id } : {}),
    ...(message.turnId ? { turnId: message.turnId } : {}),
  }
  if (sameTextSelection(lastTextSelection, next)) return
  lastTextSelection = next
  emit('message-text-selection-change', next)
}

function messageEntryForNode(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement
  const entry = element?.closest<HTMLElement>('[data-codex-message-index]') ?? null
  return entry && scrollElement.value?.contains(entry) ? entry : null
}

function clearMessageTextSelection(): void {
  pointerSelecting = false
  if (!lastTextSelection) return
  lastTextSelection = null
  emit('message-text-selection-change', null)
}

function sameTextSelection(
  left: CodexMessageTextSelection | null,
  right: CodexMessageTextSelection,
): boolean {
  return Boolean(left
    && left.text === right.text
    && left.messageIndex === right.messageIndex
    && left.anchor.x === right.anchor.x
    && left.anchor.y === right.anchor.y
    && left.anchor.width === right.anchor.width
    && left.anchor.height === right.anchor.height)
}

function requestOlderMessages(): void {
  if (!props.hasOlderMessages || props.loadingOlderMessages || olderMessagesRequestPending) return
  olderMessagesRequestPending = true
  emit('load-older-messages')
}

function isWithinTopPrefetchRange(): boolean {
  const target = scrollElement.value
  return target !== null && target.scrollTop <= target.clientHeight
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
  const previousTailStart = turnAlignedStart(props.messages.slice(0, previousLength), Math.max(0, previousLength - batchSize))
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
  const alignedIndex = turnAlignedStart(props.messages, nextIndex)
  renderStartIndex.value = alignedIndex
  renderedAnchor = messageIdentityAt(props.messages, alignedIndex)
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
  return turnAlignedStart(messages, Math.max(0, messages.length - batchSize))
}

function turnAlignedStart(messages: readonly (Message | SurfaceMessage)[], candidate: number): number {
  let start = Math.max(0, Math.min(messages.length, candidate))
  if (start >= messages.length) return start
  const turnId = chatMessageFromInput(messages[start]!).turnId?.trim()
  if (!turnId) return start
  while (start > 0 && chatMessageFromInput(messages[start - 1]!).turnId?.trim() === turnId) start -= 1
  return start
}

function setTail(next: boolean): void {
  if (tail.value !== next) {
    tail.value = next
    emit('stickiness-change', next)
  }
}

function updateOverflow(): void {
  overflown.value = !isAtBottom()
}

function isAtBottom(): boolean {
  const target = scrollElement.value
  return target
    ? target.scrollHeight - target.scrollTop - target.clientHeight <= props.bottomThreshold
    : tail.value
}

function scrollToBottom(): void {
  if (!scrollElement.value) {
    return
  }
  scrollElement.value.scrollTop = scrollElement.value.scrollHeight
  lastScrollTop = scrollElement.value.scrollTop
  setTail(true)
  updateOverflow()
}

function queueScrollToBottom(): void {
  if (scrollFrame !== null) return
  const callback = () => {
    scrollFrame = null
    if (tail.value) scrollToBottom()
  }
  scrollFrame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 0)
}

onBeforeUnmount(() => {
  document.removeEventListener('pointerup', handleSelectionPointerUp)
  document.removeEventListener('selectionchange', handleDocumentSelectionChange)
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

.codex-message-list__entry {
  display: contents;
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
