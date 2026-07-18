<template>
  <slot v-if="block.type === 'user-text'" name="text" :block="block" :content="block.content" user>
    <div
      class="codex-chat-theme chat-message-block chat-message-block--text codex-markdown"
      v-html="renderUserText(block.content)"
    />
  </slot>
  <slot v-else-if="block.type === 'text'" name="text" :block="block" :content="block.content" :user="false">
    <div
      class="codex-chat-theme chat-message-block chat-message-block--text codex-markdown"
      v-html="renderMarkdown(block.content)"
    />
  </slot>
  <slot v-else-if="block.type === 'mermaid'" name="mermaid" :block="block" :code="block.code">
    <ChatMermaidBlock :code="block.code" />
  </slot>
  <slot v-else-if="block.type === 'media'" name="media" :block="block" :media="block.media">
    <ChatMediaBlock :media="block.media" />
  </slot>
  <slot
    v-else-if="block.type === 'attachment'"
    name="attachment"
    :attachment="block.attachment"
    :block="block"
  >
    <ChatAttachmentBlock :attachment="block.attachment" />
  </slot>
  <slot v-else-if="block.type === 'tool'" name="tool" :block="block" :tool-call="block.toolCall">
    <ChatToolCall
      :answered-client-request-ids="answeredClientRequestIds"
      :tool-call="block.toolCall"
      @cancel="emit('cancel')"
      @client-response="emit('client-response', $event)"
    />
  </slot>
  <slot v-else-if="block.type === 'tool-group'" name="tool" :block="block" :tool-calls="block.toolCalls">
    <ChatToolGroup
      :answered-client-request-ids="answeredClientRequestIds"
      :tool-calls="block.toolCalls"
      @cancel="emit('cancel')"
      @client-response="emit('client-response', $event)"
    />
  </slot>
  <ChatFollowUps
    v-else
    :disabled="followUpsDisabled"
    :prompts="block.prompts"
    @send-follow-up="emit('send-follow-up', $event)"
  />
</template>

<script setup lang="ts">
import ChatAttachmentBlock from './ChatAttachmentBlock.vue'
import ChatFollowUps from './ChatFollowUps.vue'
import ChatMediaBlock from './ChatMediaBlock.vue'
import ChatMermaidBlock from './ChatMermaidBlock.vue'
import ChatToolGroup from './ChatToolGroup.vue'
import ChatToolCall from './ChatToolCall.vue'
import { renderMarkdown, renderUserText } from './message-markdown'
import type { MessageBlock } from './message-blocks'
import type { ClientRequestResponse } from './contracts'

defineSlots<{
  attachment(props: {
    attachment: Extract<MessageBlock, { type: 'attachment' }>['attachment']
    block: Extract<MessageBlock, { type: 'attachment' }>
  }): unknown
  media(props: { block: Extract<MessageBlock, { type: 'media' }>; media: Extract<MessageBlock, { type: 'media' }>['media'] }): unknown
  mermaid(props: { block: Extract<MessageBlock, { type: 'mermaid' }>; code: string }): unknown
  text(props: { block: Extract<MessageBlock, { type: 'text' | 'user-text' }>; content: string; user: boolean }): unknown
  tool(props: {
    block: Extract<MessageBlock, { type: 'tool' | 'tool-group' }>
    toolCall?: Extract<MessageBlock, { type: 'tool' }>['toolCall']
    toolCalls?: Extract<MessageBlock, { type: 'tool-group' }>['toolCalls']
  }): unknown
}>()

defineProps<{
  block: MessageBlock
  answeredClientRequestIds?: ReadonlySet<string>
  followUpsDisabled?: boolean
}>()

const emit = defineEmits<{
  cancel: []
  'client-response': [response: ClientRequestResponse]
  'send-follow-up': [prompt: string]
}>()
</script>

<style scoped>

.chat-message-block--text {
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: var(--line-height-22);
  font-size: var(--chat-font-size, var(--font-size-15));
  opacity: 0.85;
}

.chat-message--user .chat-message-block--text {
  padding: var(--space-3) var(--space-6);
}
</style>
