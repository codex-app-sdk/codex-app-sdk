<template>
  <slot v-if="block.type === 'user-text'" name="text" :block="block" :content="block.content" user>
    <ChatUserText
      class="chat-message-block chat-message-block--text"
      :content="block.content"
      :plugins="plugins"
      :skills="skills"
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
import ChatUserText from './ChatUserText.vue'
import { renderMarkdown } from './message-markdown'
import type { MessageBlock } from './message-blocks'
import type { ClientRequestResponse, CodexConversationLink } from './contracts'
import type { CodexSurfacePlugin, CodexSurfaceSkill } from '@codex-app-sdk/core/surface'
import type { CodexMessageImageOpenHandler } from './message-image'

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

withDefaults(defineProps<{
  block: MessageBlock
  answeredClientRequestIds?: ReadonlySet<string>
  followUpsDisabled?: boolean
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
  'send-follow-up': [prompt: string]
}>()
</script>

<style scoped>

.chat-message-block--text {
  white-space: normal;
  overflow-wrap: anywhere;
}

</style>
