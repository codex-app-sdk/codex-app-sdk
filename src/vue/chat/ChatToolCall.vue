<template>
  <ChatToolConfirmation
    v-if="isToolConfirmation"
    class="codex-chat-theme"
    :answered-client-request-ids="answeredClientRequestIds"
    :tool-call="toolCall"
    @client-response="emit('client-response', $event)"
  />
  <ChatToolUserInputRequest
    v-else-if="isUserInputRequest"
    class="codex-chat-theme"
    :answered-client-request-ids="answeredClientRequestIds"
    :tool-call="toolCall"
    @client-response="emit('client-response', $event)"
  />
  <section v-else class="codex-chat-theme chat-tool-call" :class="{ 'chat-tool-call--open': isOpen, [`chat-tool-call--${toolCall.state}`]: true }">
    <div v-if="summaryOnly" class="chat-tool-call__summary">
      <ChatToolCallTitle
        :line-diff="lineDiff"
        :running="isRunning"
        :title="titleParts.title"
        :title-prefix="titleParts.prefix"
        :title-target="titleParts.target"
        :title-target-link="titleTargetLink"
        :tool-call="toolCall"
        :tool-presentation="toolPresentation"
        @open-link="emit('open-link', $event)"
      />
      <component
        :is="isOpen ? ChevronUp : ChevronDown"
        v-if="expandable !== false"
        class="chat-tool-group__chevron"
        :size="15"
      />
    </div>

    <div
      v-else-if="isStaticPlanProgress || !detailsAvailable"
      class="chat-tool-call__header chat-tool-call__header--static"
    >
      <ChatToolCallTitle
        :line-diff="lineDiff"
        :running="isRunning"
        :title="titleParts.title"
        :title-prefix="titleParts.prefix"
        :title-target="titleParts.target"
        :title-target-link="titleTargetLink"
        :tool-call="toolCall"
        :tool-presentation="toolPresentation"
        @open-link="emit('open-link', $event)"
      />
    </div>

    <button v-else-if="!headerless" class="chat-tool-call__header" type="button" @click="toggleOpen">
      <ChatToolCallTitle
        :line-diff="lineDiff"
        :running="isRunning"
        :title="titleParts.title"
        :title-prefix="titleParts.prefix"
        :title-target="titleParts.target"
        :title-target-link="titleTargetLink"
        :tool-call="toolCall"
        :tool-presentation="toolPresentation"
        @open-link="emit('open-link', $event)"
      />
      <component :is="isOpen ? ChevronUp : ChevronDown" class="chat-tool-call__chevron" :size="15" />
    </button>

    <div v-if="headerless && toolDetailsEnabled" class="chat-tool-call__body">
      <div v-if="hasParams" class="chat-tool-call__section">
        <div class="chat-tool-call__section-title">Input</div>
        <pre class="chat-tool-call__json">{{ formatValue(toolCallArgs) }}</pre>
      </div>

      <div v-if="hasResult" class="chat-tool-call__section">
        <div class="chat-tool-call__section-title">Result</div>
        <pre class="chat-tool-call__json">{{ formatValue(toolCall.result) }}</pre>
      </div>
    </div>

    <ChatFoldTransition v-else-if="detailsAvailable && !isStaticPlanProgress" :open="isOpen">
      <div class="chat-tool-call__body">
        <div v-if="hasParams" class="chat-tool-call__section">
          <div class="chat-tool-call__section-title">Input</div>
          <pre class="chat-tool-call__json">{{ formatValue(toolCallArgs) }}</pre>
        </div>

        <div v-if="hasResult" class="chat-tool-call__section">
          <div class="chat-tool-call__section-title">Result</div>
          <pre class="chat-tool-call__json">{{ formatValue(toolCall.result) }}</pre>
        </div>
      </div>
    </ChatFoldTransition>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCodexChatTranslate } from './chat-i18n'
import { useCodexToolPresentation } from './tool-presentation'
import { ChevronDown, ChevronUp } from '../icons/app-icons'
import type { ClientRequestResponse, CodexConversationLink } from './contracts'
import ChatFoldTransition from './ChatFoldTransition.vue'
import ChatToolConfirmation from './ChatToolConfirmation.vue'
import ChatToolCallTitle from './ChatToolCallTitle.vue'
import ChatToolUserInputRequest from './ChatToolUserInputRequest.vue'
import { getToolDisplayTargetLink, getToolDisplayTitleParts, getToolLineDiff, parseToolStatusDescriptor } from './tool-status'
import { getMessageToolCallArgs, type MessageToolCall } from './types'
import { useCodexToolCallDetails } from './tool-call-details'

const props = withDefaults(defineProps<{
  answeredClientRequestIds?: ReadonlySet<string>
  expandable?: boolean
  headerless?: boolean
  showToolDetails?: boolean
  summaryOnly?: boolean
  toolCall: MessageToolCall
}>(), {
  showToolDetails: undefined,
})
const emit = defineEmits<{
  cancel: []
  'client-response': [response: ClientRequestResponse]
  'open-link': [link: CodexConversationLink]
}>()

const t = useCodexChatTranslate()
const resolveToolPresentation = useCodexToolPresentation()
const isOpen = ref(false)
const providedToolDetails = useCodexToolCallDetails()

const toolCallArgs = computed(() => getMessageToolCallArgs(props.toolCall))
const isRunning = computed(() => !props.toolCall.done && props.toolCall.state !== 'completed')
const statusDescriptor = computed(() => parseToolStatusDescriptor(props.toolCall.status))
const toolPresentation = computed(() => resolveToolPresentation({
  descriptor: statusDescriptor.value,
  ...(props.toolCall.kind ? { kind: props.toolCall.kind } : {}),
  ...(props.toolCall.metadata ? { metadata: props.toolCall.metadata } : {}),
  toolCall: props.toolCall,
}))
const confirmationParams = computed(() => (
  statusDescriptor.value?.params && typeof statusDescriptor.value.params === 'object'
    ? statusDescriptor.value.params
    : {}
))
const isToolConfirmation = computed(() => (
  (statusDescriptor.value?.source === 'mcp' || statusDescriptor.value?.source === 'home') &&
  typeof confirmationParams.value.requestId === 'string' &&
  props.toolCall.state === 'running'
))
const isUserInputRequest = computed(() => (
  statusDescriptor.value?.source === 'codex' &&
  statusDescriptor.value.action === 'ask_user_question' &&
  typeof confirmationParams.value.requestId === 'string' &&
  props.toolCall.state === 'running'
))
const titleParts = computed(() => {
  if (toolPresentation.value?.title !== undefined) {
    return { title: toolPresentation.value.title }
  }
  const descriptor = statusDescriptor.value
  if (props.toolCall.status && !['running', 'completed', 'failed'].includes(props.toolCall.status)) {
    return descriptor ? getToolDisplayTitleParts(props.toolCall, descriptor, t) : { title: props.toolCall.status }
  }
  return getToolDisplayTitleParts(props.toolCall, descriptor, t)
})
const titleTargetLink = computed(() => getToolDisplayTargetLink(
  props.toolCall,
  statusDescriptor.value,
  titleParts.value.target,
))
const lineDiff = computed(() => getToolLineDiff(statusDescriptor.value))
const hasParams = computed(() => toolCallArgs.value !== undefined)
const hasResult = computed(() => props.toolCall.result !== undefined && props.toolCall.result !== null)
const toolDetailsEnabled = computed(() => props.showToolDetails ?? providedToolDetails.value)
const detailsAvailable = computed(() => toolDetailsEnabled.value && (hasParams.value || hasResult.value))
const isPlanProgress = computed(() => statusDescriptor.value?.source === 'codex' && statusDescriptor.value.action === 'plan')
const isStaticPlanProgress = computed(() => isPlanProgress.value && !hasParams.value && !hasResult.value && !props.headerless && !props.summaryOnly)

function toggleOpen() {
  if (!detailsAvailable.value) return
  isOpen.value = !isOpen.value
}

function formatValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}
</script>

<style scoped>
.chat-tool-call {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
}

.chat-tool-call--canceled,
.chat-tool-call--error {
  opacity: 0.72;
}

.chat-tool-call__header,
.chat-tool-call__summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
  color: inherit;
  font: inherit;
  text-align: left;
}

.chat-tool-call__header {
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
}

.chat-tool-call__header--static {
  cursor: default;
}

.chat-tool-call__header:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: var(--space-1);
}

.chat-tool-call__chevron,
.chat-tool-group__chevron {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  color: var(--color-text-muted);
}

.chat-tool-call__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-4) 0 var(--space-4) 0;
}

.chat-tool-call__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.chat-tool-call__section-title {
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-muted);
}

.chat-tool-call__json {
  max-height: 240px;
  overflow: auto;
  margin: 0;
  padding: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-surface-low);
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-12);
  line-height: var(--line-height-20);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

</style>
