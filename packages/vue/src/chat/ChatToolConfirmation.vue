<template>
  <div v-if="resolved" class="codex-chat-theme chat-tool-confirmation chat-tool-confirmation--resolved">
    <ChatToolCallTitle :title="resolvedTitle" />
  </div>
  <ChatApprovalCard
    v-else
    :summary="summary"
    :details="argumentsPreview"
    :actions="actions"
    @decide="respond"
  />
</template>

<script setup lang="ts">
import type { ToolConfirmationDecision } from './contracts'
import { computed, ref } from 'vue'
import ChatToolCallTitle from './ChatToolCallTitle.vue'
import ChatApprovalCard from './ChatApprovalCard.vue'
import { parseToolStatusDescriptor } from './tool-status'
import { getMessageToolCallArgs, getMessageToolCallName, type MessageToolCall } from './types'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  answeredClientRequestIds?: ReadonlySet<string>
  toolCall: MessageToolCall
}>()

const emit = defineEmits<{
  'client-response': [response: { id: string; payload: { decision: ToolConfirmationDecision } }]
}>()
// Stryker restore all

const localDecision = ref<ToolConfirmationDecision | null>(null)

const descriptor = computed(() => parseToolStatusDescriptor(props.toolCall.status))
const descriptorParams = computed(() => (
  descriptor.value?.params && typeof descriptor.value.params === 'object'
    ? descriptor.value.params
    : {}
))
const requestId = computed(() => {
  const value = descriptorParams.value.requestId
  return typeof value === 'string' ? value : undefined
})
const summary = computed(() => {
  const value = descriptorParams.value.confirmationSummary
  return typeof value === 'string' && value.trim()
    ? value
    : `Allow tool call ${getMessageToolCallName(props.toolCall)}?`
})
const argumentsPreview = computed(() => {
  const preview = descriptorParams.value.argumentsPreview
  if (typeof preview === 'string') {
    return preview
  }

  const params = getMessageToolCallArgs(props.toolCall)
  if (!params || typeof params !== 'object') {
    return ''
  }
  return JSON.stringify(params, null, 2)
})
const externallyResolved = computed(() => (
  requestId.value ? props.answeredClientRequestIds?.has(requestId.value) === true : false
))
const resolved = computed(() => Boolean(localDecision.value) || externallyResolved.value || props.toolCall.done)
const showConversationAction = computed(() => descriptorParams.value.allowConversation === true)
const showAlwaysAction = computed(() => descriptorParams.value.allowAlways === true)
const actions = computed(() => [
  { id: 'allow' as const, label: 'Allow', primary: true },
  ...(showConversationAction.value ? [{ id: 'allow_conversation' as const, label: 'Allow for session' }] : []),
  ...(showAlwaysAction.value ? [{ id: 'always_allow' as const, label: 'Always allow' }] : []),
  { id: 'deny' as const, label: 'Deny' },
])
const resolvedTitle = computed(() => {
  const result = props.toolCall.result
  const denied = typeof result === 'object' && result !== null && 'decision' in result && result.decision === 'deny'
  if (localDecision.value === 'deny' || denied || props.toolCall.state === 'canceled') {
    return 'Denied tool call'
  }

  return 'Allowed tool call'
})

function respond(decision: ToolConfirmationDecision) {
  if (!requestId.value || resolved.value) {
    return
  }

  localDecision.value = decision
  emit('client-response', {
    id: requestId.value,
    payload: { decision },
  })
}
</script>

<style scoped>
.chat-tool-confirmation--resolved {
  width: 100%;
  color: var(--color-text-muted);
}
</style>
