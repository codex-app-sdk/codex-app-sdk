<template>
  <ChatToolCall
    v-if="singleConfirmationToolCall"
    :answered-client-request-ids="answeredClientRequestIds"
    :tool-call="singleConfirmationToolCall"
    @cancel="emit('cancel')"
    @client-response="emit('client-response', $event)"
  />
  <section v-else class="codex-chat-theme chat-tool-group">
    <component
      :is="canExpand ? 'button' : 'div'"
      class="chat-tool-group__header"
      :class="{ 'chat-tool-group__header--static': !canExpand }"
      :type="canExpand ? 'button' : undefined"
      @click="toggleExpanded"
    >
      <ChatToolCall
        v-if="headerToolCall"
        class="chat-tool-group__active"
        summary-only
        :expandable="canExpand"
        :answered-client-request-ids="answeredClientRequestIds"
        :show-tool-details="toolDetailsEnabled"
        :tool-call="headerToolCall"
        @cancel="emit('cancel')"
        @client-response="emit('client-response', $event)"
      />
      <template v-else>
        <span
          class="chat-tool-group__title"
          :data-label="summary"
        >
          {{ summary }}
        </span>
        <span v-if="lineDiff" class="chat-tool-group__diff" aria-label="Total line changes">
          <ChatAnimatedDiffStat
            v-if="lineDiff.addedLines"
            kind="added"
            label="Total added lines"
            :value="lineDiff.addedLines"
          />
          <ChatAnimatedDiffStat
            v-if="lineDiff.removedLines"
            kind="deleted"
            label="Total removed lines"
            :value="lineDiff.removedLines"
          />
        </span>
        <component v-if="canExpand" :is="expanded ? ChevronUp : ChevronDown" class="chat-tool-group__chevron" :size="15" />
      </template>
    </component>

    <ChatFoldTransition :open="expanded">
      <div class="chat-tool-group__body">
        <ChatToolCall
          v-for="toolCall in toolCalls"
          :key="toolCall.id"
          :answered-client-request-ids="answeredClientRequestIds"
          :headerless="isSingleTool"
          :show-tool-details="toolDetailsEnabled"
          :tool-call="toolCall"
          @cancel="emit('cancel')"
          @client-response="emit('client-response', $event)"
        />
      </div>
    </ChatFoldTransition>
  </section>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronUp } from '../icons/app-icons'
import { computed, ref } from 'vue'
import type { ClientRequestResponse } from './contracts'
import ChatAnimatedDiffStat from './ChatAnimatedDiffStat.vue'
import ChatFoldTransition from './ChatFoldTransition.vue'
import ChatToolCall from './ChatToolCall.vue'
import { getToolGroupLineDiff, parseToolStatusDescriptor } from './tool-status'
import type { MessageToolCall } from './types'
import { getMessageToolCallArgs } from './types'
import { useCodexToolCallDetails } from './tool-call-details'

const props = withDefaults(defineProps<{
  answeredClientRequestIds?: ReadonlySet<string>
  showToolDetails?: boolean
  toolCalls: MessageToolCall[]
}>(), {
  showToolDetails: undefined,
})
const emit = defineEmits<{
  cancel: []
  'client-response': [response: ClientRequestResponse]
}>()

const expanded = ref(false)
const providedToolDetails = useCodexToolCallDetails()
const toolDetailsEnabled = computed(() => props.showToolDetails ?? providedToolDetails.value)

const isSingleTool = computed(() => props.toolCalls.length === 1)
const singleConfirmationToolCall = computed(() => {
  if (!isSingleTool.value || !props.toolCalls[0] || !isConfirmationTool(props.toolCalls[0])) {
    return undefined
  }

  return props.toolCalls[0]
})
const activeToolCall = computed(() => props.toolCalls.find(isActiveToolCall))
const headerToolCall = computed(() => activeToolCall.value ?? (isSingleTool.value ? props.toolCalls[0] : undefined))
const lineDiff = computed(() => getToolGroupLineDiff(props.toolCalls))
const canExpand = computed(() => (
  props.toolCalls.length > 1
  || (toolDetailsEnabled.value && props.toolCalls.some(hasToolDetails))
))
const summary = computed(() => {
  if (props.toolCalls.length > 0) {
    return `${formatActions(props.toolCalls.length)} done`
  }

  return 'No actions'
})

function toggleExpanded() {
  if (!canExpand.value) return
  expanded.value = !expanded.value
}

function formatActions(count: number) {
  return `${count} ${count === 1 ? 'action' : 'actions'}`
}

function isActiveToolCall(toolCall: MessageToolCall) {
  return !toolCall.done && toolCall.state !== 'completed'
}

function isConfirmationTool(toolCall: MessageToolCall) {
  const descriptor = parseToolStatusDescriptor(toolCall.status)
  return (
    (descriptor?.source === 'mcp' || descriptor?.source === 'home') &&
    typeof descriptor.params?.requestId === 'string' &&
    toolCall.state === 'running'
  )
}

function hasToolDetails(toolCall: MessageToolCall) {
  return getMessageToolCallArgs(toolCall) !== undefined
    || (toolCall.result !== undefined && toolCall.result !== null)
}
</script>

<style scoped>
.chat-tool-group {
  width: 100%;
  padding: var(--space-1) 0;
  color: var(--color-text-muted);
}

.chat-tool-group__header {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  max-width: 100%;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.chat-tool-group__header--static {
  cursor: default;
}

.chat-tool-group__header:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: var(--space-1);
}

.chat-tool-group__icon,
.chat-tool-group__chevron {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  color: var(--color-text-muted);
}

.chat-tool-group__icon--running {
  animation: chat-tool-group-square-pulse 1.2s ease-in-out infinite;
}

.chat-tool-group__active {
  flex: 1 1 auto;
}

.chat-tool-group__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-15);
  line-height: var(--line-height-20);
  font-weight: var(--font-weight-light);
}

.chat-tool-group__diff {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
}

.chat-tool-group__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-top: var(--space-2);
}

.chat-tool-group__body .chat-tool-call:only-of-type:deep() .chat-tool-call__body {
  padding-top: 0;
}

@keyframes chat-tool-group-square-pulse {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.88);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

</style>
