<template>
  <slot v-if="block.type === 'user-text'" name="text" :block="block" :content="block.content" user>
    <ChatUserText
      class="chat-message-block chat-message-block--text"
      :content="block.content"
      :mention-groups="mentionGroups"
      :plugins="plugins"
      :skills="skills"
    >
      <template v-if="$slots.mention" #mention="scope"><slot name="mention" v-bind="scope" /></template>
    </ChatUserText>
  </slot>
  <slot v-else-if="block.type === 'text'" name="text" :block="block" :content="block.content" :user="false">
    <div
      class="codex-chat-theme chat-message-block chat-message-block--text codex-markdown"
      v-html="renderMarkdown(block.content, { codeCopyLabel: t('chat.code.copy') })"
      @click="copyCodeBlock"
    />
  </slot>
  <div
    v-else-if="block.type === 'reasoning'"
    class="codex-chat-theme chat-message-block chat-message-block--reasoning codex-markdown"
    v-html="renderMarkdown(block.content, { codeCopyLabel: t('chat.code.copy') })"
    @click="copyCodeBlock"
  />
  <slot v-else-if="block.type === 'mermaid'" name="mermaid" :block="block" :code="block.code">
    <ChatMermaidBlock :code="block.code" />
  </slot>
  <slot v-else-if="block.type === 'visualization'" name="visualization" :block="block">
    <ChatVisualizationBlock
      :path="block.path"
      :title="block.title"
      @open-visualization="emit('open-visualization', $event)"
    />
  </slot>
  <slot v-else-if="block.type === 'media'" name="media" :block="block" :media="block.media">
    <ChatMediaBlock :media="block.media" :open-image="openImage" />
  </slot>
  <slot
    v-else-if="block.type === 'attachment'"
    name="attachment"
    :attachment="block.attachment"
    :block="block"
  >
    <ChatAttachmentBlock :attachment="block.attachment" :open-image="openImage" />
  </slot>
  <slot v-else-if="block.type === 'tool'" name="tool" :block="block" :tool-call="block.toolCall">
    <ChatToolCall
      :answered-client-request-ids="answeredClientRequestIds"
      :show-tool-details="showToolDetails"
      :tool-call="block.toolCall"
      @cancel="emit('cancel')"
      @client-response="emit('client-response', $event)"
      @open-link="emit('open-link', $event)"
    />
  </slot>
  <slot v-else-if="block.type === 'tool-group'" name="tool" :block="block" :tool-calls="block.toolCalls">
    <ChatToolGroup
      :answered-client-request-ids="answeredClientRequestIds"
      :show-tool-details="showToolDetails"
      :tool-calls="block.toolCalls"
      @cancel="emit('cancel')"
      @client-response="emit('client-response', $event)"
      @open-link="emit('open-link', $event)"
    />
  </slot>
  <ChatWorkGroup
    v-else-if="block.type === 'work-group'"
    :active="block.active"
    :final-started="block.finalStarted"
  >
    <template v-for="(child, index) in block.blocks" :key="child.type === 'tool' ? child.toolCall.id : `${child.type}-${index}`">
      <slot name="block" :block="child" :block-index="index">
        <ChatMessageBlock
          :answered-client-request-ids="answeredClientRequestIds"
          :block="child"
          :follow-ups-disabled="followUpsDisabled"
          :mention-groups="mentionGroups"
          :open-image="openImage"
          :plugins="plugins"
          :show-tool-details="showToolDetails"
          :skills="skills"
          @cancel="emit('cancel')"
          @client-response="emit('client-response', $event)"
          @open-link="emit('open-link', $event)"
          @open-visualization="emit('open-visualization', $event)"
          @send-follow-up="emit('send-follow-up', $event)"
        >
          <template v-if="$slots.block" #block="scope"><slot name="block" v-bind="scope" /></template>
          <template v-if="$slots.text" #text="scope"><slot name="text" v-bind="scope" /></template>
          <template v-if="$slots.tool" #tool="scope"><slot name="tool" v-bind="scope" /></template>
        </ChatMessageBlock>
      </slot>
    </template>
  </ChatWorkGroup>
  <ChatFollowUps
    v-else-if="block.type === 'follow-ups'"
    :disabled="followUpsDisabled"
    :prompts="block.prompts"
    @send-follow-up="emit('send-follow-up', $event)"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import ChatAttachmentBlock from './ChatAttachmentBlock.vue'
import ChatFollowUps from './ChatFollowUps.vue'
import ChatMediaBlock from './ChatMediaBlock.vue'
import ChatMermaidBlock from './ChatMermaidBlock.vue'
import ChatToolGroup from './ChatToolGroup.vue'
import ChatToolCall from './ChatToolCall.vue'
import ChatUserText from './ChatUserText.vue'
import ChatVisualizationBlock from './ChatVisualizationBlock.vue'
import ChatWorkGroup from './ChatWorkGroup.vue'
import { renderMarkdown } from './message-markdown'
import { copyTextToClipboard } from './message-actions'
import { useCodexChatTranslate } from './chat-i18n'
import type { MessageBlock, RenderedMessageBlock } from './message-blocks'
import type { ClientRequestResponse, CodexConversationLink } from './contracts'
import type { CodexSurfacePlugin, CodexSurfaceSkill } from '@codex-app-sdk/core/surface'
import type { CodexMessageImageOpenHandler } from './message-image'
import type { CodexConversationVisualization } from './visualization'
import type { CodexComposerMentionGroup, CodexComposerMentionItem } from './composer-mentions-custom'
import { useCodexHostCapabilities } from '../native-capabilities'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
defineSlots<{
  block(props: { block: MessageBlock; blockIndex: number }): unknown
  attachment(props: {
    attachment: Extract<MessageBlock, { type: 'attachment' }>['attachment']
    block: Extract<MessageBlock, { type: 'attachment' }>
  }): unknown
  media(props: { block: Extract<MessageBlock, { type: 'media' }>; media: Extract<MessageBlock, { type: 'media' }>['media'] }): unknown
  mermaid(props: { block: Extract<MessageBlock, { type: 'mermaid' }>; code: string }): unknown
  mention(props: { group: CodexComposerMentionGroup; item: CodexComposerMentionItem; surface: 'message' }): unknown
  visualization(props: { block: Extract<MessageBlock, { type: 'visualization' }> }): unknown
  text(props: { block: Extract<MessageBlock, { type: 'text' | 'user-text' }>; content: string; user: boolean }): unknown
  tool(props: {
    block: Extract<MessageBlock, { type: 'tool' | 'tool-group' }>
    toolCall?: Extract<MessageBlock, { type: 'tool' }>['toolCall']
    toolCalls?: Extract<MessageBlock, { type: 'tool-group' }>['toolCalls']
  }): unknown
}>()

withDefaults(defineProps<{
  block: RenderedMessageBlock
  answeredClientRequestIds?: ReadonlySet<string>
  followUpsDisabled?: boolean
  mentionGroups?: readonly CodexComposerMentionGroup[]
  openImage?: CodexMessageImageOpenHandler
  plugins?: readonly CodexSurfacePlugin[]
  showToolDetails?: boolean
  skills?: readonly CodexSurfaceSkill[]
}>(), {
  showToolDetails: undefined,
})

const emit = defineEmits<{
  cancel: []
  'client-response': [response: ClientRequestResponse]
  'open-link': [link: CodexConversationLink]
  'open-visualization': [visualization: CodexConversationVisualization]
  'send-follow-up': [prompt: string]
}>()
// Stryker restore all

const t = useCodexChatTranslate()
const hostCapabilities = useCodexHostCapabilities()
const copyResetTimers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()

async function copyCodeBlock(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null
  const button = target?.closest<HTMLButtonElement>('[data-chat-code-copy]')
  if (!button) return
  const code = button.closest('.chat-code-block')?.querySelector('pre code')?.textContent
  if (code === undefined) return

  await copyTextToClipboard(code, hostCapabilities)
  button.dataset.copied = 'true'
  button.setAttribute('aria-label', t('chat.code.copied'))
  button.title = t('chat.code.copied')
  const previousTimer = copyResetTimers.get(button)
  clearTimeout(previousTimer)
  copyResetTimers.set(button, setTimeout(() => {
    button.removeAttribute('data-copied')
    button.setAttribute('aria-label', t('chat.code.copy'))
    button.title = t('chat.code.copy')
    copyResetTimers.delete(button)
  }, 2_000))
}

onBeforeUnmount(() => {
  for (const timer of copyResetTimers.values()) clearTimeout(timer)
  copyResetTimers.clear()
})
</script>

<style scoped>

.chat-message-block--text {
  white-space: normal;
  overflow-wrap: anywhere;
}

.chat-message-block--reasoning {
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-light);
  line-height: var(--line-height-20);
}

</style>
