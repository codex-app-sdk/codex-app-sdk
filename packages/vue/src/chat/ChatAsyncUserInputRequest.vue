<template>
  <ChatToolUserInputRequest
    :answered-client-request-ids="answeredClientRequestIds"
    :tool-call="toolCall"
    @client-response="respond"
  />
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { questionResponsesKey } from './message-work-state'
import type { CodexSurfaceClientRequest } from '@codex-app-sdk/core/surface'
import ChatToolUserInputRequest from './ChatToolUserInputRequest.vue'
import type { ClientRequestResponse } from './contracts'
import type { MessageToolCall } from './types'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  answeredClientRequestIds?: ReadonlySet<string>
  request: Extract<CodexSurfaceClientRequest, { kind: 'ask_user' }>
}>()

const emit = defineEmits<{
  'client-response': [response: ClientRequestResponse]
}>()
// Stryker restore all

const responses = inject(questionResponsesKey, undefined)
function respond(response: ClientRequestResponse) {
  responses?.set(response.id, response.payload)
  emit('client-response', response)
}

const toolCall = computed<MessageToolCall>(() => ({
  args: props.request.payload.request.questions,
  done: false,
  function: 'ask_user_question',
  id: props.request.itemId,
  itemId: props.request.itemId,
  result: responses?.get(props.request.id) ?? null,
  state: responses?.get(props.request.id)?.cancelled ? 'canceled' : 'running',
  status: JSON.stringify({
    source: 'codex',
    action: 'ask_user_question',
    phase: 'running',
    params: {
      requestId: props.request.id,
      questions: props.request.payload.request.questions,
    },
  }),
  turnId: props.request.turnId,
}))
</script>
