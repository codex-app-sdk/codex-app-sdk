<template>
  <ChatCompactionMessage
    v-if="chatMessage.type === 'compaction'"
    class="codex-chat-theme"
    :completed-title="t('chat.compaction.completed')"
    :running-title="t('chat.compaction.running')"
    :status="chatMessage.compactionStatus"
  />
  <!-- <div v-else-if="message.type === 'steer'" class="chat-message chat-message--steer">
    <div class="chat-message__steer-line" />
    <div class="chat-message__steer-body">
      <span class="chat-message__steer-title">Steered conversation</span>
      <span class="chat-message__steer-text">{{ message.content }}</span>
    </div>
  </div> -->
  <div
    v-else
    class="codex-chat-theme chat-message"
    :class="[`chat-message--${chatMessage.role}`, {
      'chat-message--actions-visible': actionsAlwaysVisible && !reserveActionSlot,
      'chat-message--editing': isEditing,
    }]"
  >
    <div class="chat-message__body">
      <div v-if="$slots.header" class="chat-message--steer chat-message--steer-above">
        <slot name="header" :index="index" :message="chatMessage" />
      </div>
      <div
        v-if="userAttachmentBlocks.length > 0"
        class="chat-message__attachments"
        aria-label="Message attachments"
      >
        <template
          v-for="({ block, blockIndex }) in userAttachmentBlocks"
          :key="`attachment-${blockIndex}`"
        >
          <slot name="block" :block="block" :block-index="blockIndex" :index="index" :message="chatMessage">
            <ChatMessageBlock :block="block" :open-image="openImage">
              <template v-if="$slots.attachment" #attachment="scope">
                <slot name="attachment" v-bind="scope" :index="index" :message="chatMessage" />
              </template>
            </ChatMessageBlock>
          </slot>
        </template>
      </div>
      <div v-if="isEditing || stackBlocks.length > 0 || showEmptyResponse || showThinkingIndicator || showStreamingDot" class="chat-message__stack">
        <ChatMessageEditor
          v-if="isEditing"
          :cancel-label="t('chat.actions.cancel')"
          :content="visibleUserContent"
          :input-label="t('chat.actions.editPrompt')"
          :save-label="t('chat.actions.resubmit')"
          @cancel="cancelEdit"
          @save="saveEdit"
        />
        <template v-else>
          <template v-for="({ block, blockIndex }) in stackBlocks" :key="block.type === 'tool' ? block.toolCall.id : `${block.type}-${blockIndex}`">
            <ChatMessageBlock
              v-if="block.type === 'work-group'"
              :answered-client-request-ids="answeredClientRequestIds"
              :block="block"
              :follow-ups-disabled="followUpsDisabled"
              :mention-groups="mentionGroups"
              :plugins="plugins"
              :open-image="openImage"
              :show-tool-details="showToolDetails"
              :skills="skills"
              @cancel="emit('cancel')"
              @client-response="emit('client-response', $event)"
              @open-link="emit('open-link', $event)"
              @open-visualization="emit('open-visualization', $event)"
              @send-follow-up="emit('send-follow-up', $event)"
            >
              <template v-if="$slots.block" #block="scope">
                <slot name="block" v-bind="scope" :index="index" :message="chatMessage" />
              </template>
              <template v-if="$slots.text" #text="scope">
                <slot name="text" v-bind="scope" :index="index" :message="chatMessage" />
              </template>
              <template v-if="$slots.tool" #tool="scope">
                <slot name="tool" v-bind="scope" :index="index" :message="chatMessage" />
              </template>
            </ChatMessageBlock>
            <slot v-else name="block" :block="block" :block-index="blockIndex" :index="index" :message="chatMessage">
              <ChatMessageBlock
                :answered-client-request-ids="answeredClientRequestIds"
                :block="block"
                :follow-ups-disabled="followUpsDisabled"
                :mention-groups="mentionGroups"
                :plugins="plugins"
                :open-image="openImage"
                :show-tool-details="showToolDetails"
                :skills="skills"
                @cancel="emit('cancel')"
                @client-response="emit('client-response', $event)"
                @open-link="emit('open-link', $event)"
                @open-visualization="emit('open-visualization', $event)"
                @send-follow-up="emit('send-follow-up', $event)"
              >
                <template v-if="$slots.attachment" #attachment="scope">
                  <slot name="attachment" v-bind="scope" :index="index" :message="chatMessage" />
                </template>
                <template v-if="$slots.text" #text="scope">
                  <slot name="text" v-bind="scope" :index="index" :message="chatMessage" />
                </template>
                <template v-if="$slots.mention" #mention="scope">
                  <slot name="mention" v-bind="scope" :index="index" :message="chatMessage" />
                </template>
                <template v-if="$slots.tool" #tool="scope">
                  <slot name="tool" v-bind="scope" :index="index" :message="chatMessage" />
                </template>
              </ChatMessageBlock>
            </slot>
          </template>
          <span v-if="showEmptyResponse" class="chat-message__empty-response">
            {{ t('chat.message.emptyResponse') }}
          </span>
          <slot v-if="showThinkingIndicator" name="thinking" :index="index" :message="chatMessage">
            <span
              class="chat-message__thinking codex-text-shimmer"
              data-label="Thinking"
            >
              Thinking
            </span>
          </slot>
          <slot v-else-if="showStreamingDot" name="status" :index="index" :message="chatMessage" status="streaming">
            <span
              class="chat-message__stream-dot"
              aria-label="Streaming"
            />
          </slot>
        </template>
      </div>
      <slot
        v-if="renderActionSlot"
        name="actions"
        :disabled="reserveActionSlot"
        :index="index"
        :message="chatMessage"
      >
        <ChatMessageActions
          class="chat-message__actions"
          :class="{ 'chat-message__actions--reserved': reserveActionSlot }"
          :aria-hidden="reserveActionSlot ? 'true' : undefined"
          :inert="reserveActionSlot ? '' : undefined"
          :can-delete="canDelete"
          :can-edit="canEdit"
          :can-fork="canFork"
          :can-retry="canRetry"
          :copied="copied"
          :message="chatMessage"
          :mutation-disabled="threadActionsDisabled"
          :presentation="effectivePresentation.messages.actions"
          @copy="copyMessage"
          @delete="deleteMessage"
          @edit="startEdit"
          @fork="forkMessage"
          @quote="emit('quote-message', index)"
          @retry="retryMessage"
        />
      </slot>
      <div v-if="chatMessage.type === 'steer'" class="chat-message--steer chat-message--steer-below">
        Steered conversation
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useCodexChatTranslate } from '../chat/chat-i18n'
import type { ClientRequestResponse, CodexConversationLink, CodexConversationPresentation } from '../chat/contracts'
import { resolveCodexConversationPresentation } from '../chat/contracts'
import type { Message } from '../chat/types'
import type { CodexSurfacePlugin, CodexSurfaceSkill, SurfaceMessage } from '@codex-app-sdk/core/surface'
import type { MessageBlock, RenderedMessageBlock } from '../chat/message-blocks'
import type {
  CodexMessageImage,
  CodexMessageImageContext,
  CodexMessageImageOpenHandler,
} from '../chat/message-image'
import type { CodexConversationVisualization } from '../chat/visualization'
import ChatMessageBlock from '../chat/ChatMessageBlock.vue'
import ChatMessageActions from '../chat/ChatMessageActions.vue'
import ChatCompactionMessage from '../chat/ChatCompactionMessage.vue'
import ChatMessageEditor from '../chat/ChatMessageEditor.vue'
import { computeMessageBlocks, groupAssistantWorkBlocks, stripMessageContext } from '../chat/message-blocks'
import { copyMessageToClipboard } from '../chat/message-actions'
import { chatMessageFromInput } from '../chat/renderer-message-adapter'
import { useCodexHostCapabilities } from '../native-capabilities'
import type { CodexComposerMentionGroup, CodexComposerMentionItem } from '../chat/composer-mentions-custom'

const props = withDefaults(defineProps<{
  actionsDisabled?: boolean
  actionsAlwaysVisible?: boolean
  answeredClientRequestIds?: ReadonlySet<string>
  canDeleteMessage?: boolean
  canEditMessage?: boolean
  canForkMessage?: boolean
  canRetryMessage?: boolean
  followUpsDisabled?: boolean
  index?: number
  message: Message | SurfaceMessage
  mentionGroups?: readonly CodexComposerMentionGroup[]
  openImage?: CodexMessageImageOpenHandler
  plugins?: readonly CodexSurfacePlugin[]
  presentation?: CodexConversationPresentation
  showToolDetails?: boolean
  skills?: readonly CodexSurfaceSkill[]
  threadActionsDisabled?: boolean
}>(), {
  canDeleteMessage: true,
  canEditMessage: true,
  canForkMessage: false,
  canRetryMessage: true,
  index: 0,
  showToolDetails: undefined,
})

defineSlots<{
  actions(props: { disabled: boolean; index: number; message: Message }): unknown
  header(props: { index: number; message: Message }): unknown
  mention(props: { group: CodexComposerMentionGroup; index: number; item: CodexComposerMentionItem; message: Message; surface: 'message' }): unknown
  attachment(props: {
    attachment: Extract<MessageBlock, { type: 'attachment' }>['attachment']
    block: Extract<MessageBlock, { type: 'attachment' }>
    index: number
    message: Message
  }): unknown
  block(props: { block: MessageBlock; blockIndex: number; index: number; message: Message }): unknown
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
  'open-link': [link: CodexConversationLink]
  'open-visualization': [visualization: CodexConversationVisualization]
  'copy-message': [index: number]
  'delete-message': [index: number]
  'edit-message': [payload: { content: string; index: number }]
  'fork-message': [index: number]
  'quote-message': [index: number]
  'retry-message': [index: number]
  'send-follow-up': [prompt: string]
}>()

const hostCapabilities = useCodexHostCapabilities()

const t = useCodexChatTranslate()
const chatMessage = computed(() => chatMessageFromInput(props.message))
const effectivePresentation = computed(() => resolveCodexConversationPresentation(props.presentation))
const allBlocks = computed(() => computeMessageBlocks(chatMessage.value))
const blocks = computed(() => groupAssistantWorkBlocks(
  chatMessage.value,
  allBlocks.value.filter((block) => (
    effectivePresentation.value.messages.toolBlocks || (block.type !== 'tool' && block.type !== 'tool-group')
  )),
))
const indexedBlocks = computed(() => blocks.value.map((block, blockIndex) => ({ block, blockIndex })))
const indexedAllBlocks = computed(() => allBlocks.value.map((block, blockIndex) => ({ block, blockIndex })))
const userAttachmentBlocks = computed(() => (
  chatMessage.value.role === 'user'
    ? indexedAllBlocks.value.filter(({ block }) => block.type === 'attachment')
    : []
))
const stackBlocks = computed(() => (
  chatMessage.value.role === 'user'
    ? indexedAllBlocks.value.filter(({ block }) => block.type !== 'attachment')
    : indexedBlocks.value
))
const visibleUserContent = computed(() => stripMessageContext(chatMessage.value.content))
const copied = ref(false)
const isEditing = ref(false)
let copyResetTimeout: ReturnType<typeof setTimeout> | null = null

const showActions = computed(() => (
  chatMessage.value.type !== 'compaction' &&
  chatMessage.value.type !== 'steer' &&
  !isEditing.value
))
const reserveActionSlot = computed(() => (
  props.actionsDisabled ||
  (chatMessage.value.role === 'assistant' && chatMessage.value.streaming === true)
))
const renderActionSlot = computed(() => showActions.value)
const canDelete = computed(() => props.canDeleteMessage && effectivePresentation.value.messages.actions.delete)
const canEdit = computed(() => props.canEditMessage && effectivePresentation.value.messages.actions.edit)
const canFork = computed(() => props.canForkMessage && effectivePresentation.value.messages.actions.fork)
const canRetry = computed(() => props.canRetryMessage && effectivePresentation.value.messages.actions.retry)
const hasVisibleAssistantActivity = computed(() => blocks.value.some(isVisibleAssistantBlock))
const showEmptyResponse = computed(() => (
  chatMessage.value.role === 'assistant' &&
  chatMessage.value.streaming !== true &&
  allBlocks.value.length === 0
))
const showThinkingIndicator = computed(() => (
  chatMessage.value.role === 'assistant' &&
  chatMessage.value.streaming === true &&
  !hasVisibleAssistantActivity.value
))
const showStreamingDot = computed(() => (
  chatMessage.value.role === 'assistant' &&
  chatMessage.value.streaming === true &&
  hasVisibleAssistantActivity.value
))
function startEdit() {
  if (chatMessage.value.role !== 'user' || !canEdit.value) {
    return
  }

  isEditing.value = true
}

function cancelEdit() {
  isEditing.value = false
}

function saveEdit(content: string) {
  emit('edit-message', { content, index: props.index })
  cancelEdit()
}

function deleteMessage() {
  if (!canDelete.value || props.threadActionsDisabled) {
    return
  }

  emit('delete-message', props.index)
}

function forkMessage() {
  if (!canFork.value || props.threadActionsDisabled) return
  emit('fork-message', props.index)
}

function retryMessage() {
  if (!canRetry.value || props.threadActionsDisabled) {
    return
  }

  emit('retry-message', props.index)
}

function openImage(image: CodexMessageImage, context?: CodexMessageImageContext) {
  return props.openImage?.(image, {
    index: props.index,
    intent: context?.intent ?? 'open',
    message: chatMessage.value,
  })
}

async function copyMessage() {
  await copyMessageToClipboard(chatMessage.value.content, hostCapabilities)
  copied.value = true
  emit('copy-message', props.index)

  if (copyResetTimeout) {
    clearTimeout(copyResetTimeout)
  }

  copyResetTimeout = setTimeout(() => {
    copied.value = false
    copyResetTimeout = null
  }, 1500)
}

function isVisibleAssistantBlock(block: RenderedMessageBlock) {
  if (block.type === 'text') {
    return block.content.trim().length > 0
  }

  return block.type === 'attachment'
    || block.type === 'media'
    || block.type === 'reasoning'
    || block.type === 'tool'
    || block.type === 'tool-group'
    || block.type === 'work-group'
}

onBeforeUnmount(() => {
  if (copyResetTimeout) {
    clearTimeout(copyResetTimeout)
  }
})
</script>

<style scoped>
.chat-message {
  display: flex;
}

.chat-message--user {
  justify-content: flex-end;
}

.chat-message--user :deep(.chat-user-text__mention) {
  padding: var(--space-2);
  background: transparent;
}

.chat-message--assistant {
  justify-content: flex-start;
}

.chat-message--steer {
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}

.chat-message--steer-above {
  margin-bottom: var(--space-1);
}

.chat-message--steer-below {
  margin-top: var(--space-1);
}

.chat-message__steer-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: 1px solid var(--color-border);
}

.chat-message__steer-body {
  z-index: 1;
  display: inline-flex;
  max-width: min(100%, 640px);
  align-items: baseline;
  gap: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: var(--space-2) var(--space-6);
  background: var(--color-surface-lowest);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.chat-message__steer-title {
  flex: 0 0 auto;
  color: var(--color-text);
  font-weight: var(--font-weight-medium);
}

.chat-message__steer-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-message__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  max-width: 100%;
}

.chat-message--user .chat-message__body {
  align-items: flex-end;
  max-width: 70%;
}

.chat-message--assistant .chat-message__body {
  align-items: flex-start;
}

.chat-message--editing .chat-message__body {
  max-width: unset;
}

.chat-message__stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 100%;
}

.chat-message__empty-response {
  color: var(--color-text-muted);
  font-style: italic;
}

.chat-message__attachments {
  display: flex;
  max-width: 100%;
  align-items: flex-start;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-4);
  margin-bottom: var(--space-3);
}

.chat-message--assistant .chat-message__stack {
  width: 100%;
}

.chat-message--user .chat-message__stack {
  background: var(--color-shell-sidebar);
  border-radius: var(--radius-xl);
}

.chat-message--editing .chat-message__stack {
  width: 100%;
  background: transparent;
  border-radius: 0;
}

.chat-message__actions {
  visibility: hidden;
}

.chat-message--actions-visible .chat-message__actions {
  visibility: visible;
}

.chat-message__actions--reserved {
  pointer-events: none;
}

.chat-message:hover .chat-message__actions,
.chat-message:focus-within .chat-message__actions {
  visibility: visible;
}

.chat-message:hover .chat-message__actions--reserved,
.chat-message:focus-within .chat-message__actions--reserved {
  visibility: hidden;
}

.chat-message__thinking {
  align-self: flex-start;
  overflow: hidden;
  padding: var(--space-3) 0;
  font-size: var(--chat-message-font-size, var(--font-size-15));
  font-weight: var(--font-weight-light);
  line-height: var(--chat-message-line-height, var(--line-height-20));
}

.chat-message__stream-dot {
  display: block;
  width: var(--space-4);
  height: var(--space-4);
  align-self: flex-start;
  margin-top: var(--space-1);
  border-radius: 999px;
  background: var(--color-text-muted);
  transform-origin: 50% 50%;
  animation: chat-message-stream-dot 1.15s ease-in-out infinite;
}

@keyframes chat-message-stream-dot {
  0%,
  100% {
    border-radius: 999px;
    opacity: 0.48;
    transform: rotate(0deg) scale(0.72);
  }

  50% {
    border-radius: var(--radius-xs);
    opacity: 1;
    transform: rotate(180deg) scale(1);
  }

  75% {
    border-radius: var(--radius-sm);
    transform: rotate(270deg) scale(0.86);
  }
}
</style>
