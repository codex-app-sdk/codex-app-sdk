<template>
  <ChatToolConfirmation
    :tool-call="toolCall"
    @client-response="$emit('client-response', $event)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CodexSurfaceClientRequest, CodexSurfaceClientRequestResponse } from '@codex-app-sdk/core/surface'
import type { MessageToolCall } from './types'
import ChatToolConfirmation from './ChatToolConfirmation.vue'

const props = defineProps<{
  request: Extract<CodexSurfaceClientRequest, { kind: 'confirm_tool' }>
}>()
defineEmits<{ 'client-response': [response: CodexSurfaceClientRequestResponse] }>()

const toolCall = computed<MessageToolCall>(() => ({
  args: undefined,
  result: undefined,
  id: props.request.itemId,
  itemId: props.request.itemId,
  function: props.request.payload.confirmation.toolName,
  done: false,
  state: 'running',
  status: JSON.stringify({
    source: 'mcp',
    action: 'confirm_tool',
    phase: 'running',
    params: {
      requestId: props.request.id,
      confirmationSummary: props.request.payload.confirmation.summary,
      argumentsPreview: props.request.payload.confirmation.argumentsPreview,
      allowConversation: props.request.payload.confirmation.allowConversation,
      allowAlways: props.request.payload.confirmation.allowAlways,
    },
  }),
}))
</script>
