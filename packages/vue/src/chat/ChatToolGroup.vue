<template>
  <ChatToolCall
    v-if="singleConfirmationToolCall"
    :answered-client-request-ids="answeredClientRequestIds"
    :tool-call="singleConfirmationToolCall"
    @cancel="emit('cancel')"
    @client-response="emit('client-response', $event)"
    @open-link="emit('open-link', $event)"
  />
  <section v-else class="codex-chat-theme chat-tool-group">
    <component
      v-if="props.toolCalls.length === 0 || headerToolCall || completedToolCalls.length > 0"
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
        @open-link="emit('open-link', $event)"
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
          v-for="toolCall in completedToolCalls"
          :key="toolCall.id"
          :answered-client-request-ids="answeredClientRequestIds"
          :headerless="isSingleTool"
          :show-tool-details="toolDetailsEnabled"
          :tool-call="toolCall"
          @cancel="emit('cancel')"
          @client-response="emit('client-response', $event)"
          @open-link="emit('open-link', $event)"
        />
      </div>
    </ChatFoldTransition>

    <TransitionGroup
      v-if="statusContainerVisible"
      name="chat-tool-group-running"
      tag="div"
      class="chat-tool-group__running"
      :class="{ 'chat-tool-group__running--after-completed': expanded }"
      aria-live="polite"
      @after-leave="hideEmptyStatusContainer"
    >
      <div
        v-for="toolCall in statusToolCalls"
        :key="toolCall.id"
        class="chat-tool-group__running-item"
      >
        <div class="chat-tool-group__running-item-content">
          <ChatToolCall
            class="chat-tool-group__active"
            :summary-only="!toolDetailsEnabled"
            :answered-client-request-ids="answeredClientRequestIds"
            :show-tool-details="toolDetailsEnabled"
            :tool-call="toolCall"
            @cancel="emit('cancel')"
            @client-response="emit('client-response', $event)"
            @open-link="emit('open-link', $event)"
          />
        </div>
      </div>
    </TransitionGroup>
  </section>
</template>

<script setup lang="ts">
import { ChevronDown, ChevronUp } from '../icons/app-icons'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ClientRequestResponse } from './contracts'
import type { CodexConversationLink } from './contracts'
import ChatAnimatedDiffStat from './ChatAnimatedDiffStat.vue'
import ChatFoldTransition from './ChatFoldTransition.vue'
import ChatToolCall from './ChatToolCall.vue'
import { getToolGroupLineDiff, parseToolStatusDescriptor } from './tool-status'
import type { MessageToolCall } from './types'
import { getMessageToolCallArgs } from './types'
import { useCodexToolCallDetails } from './tool-call-details'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  activityTitle?: string
  answeredClientRequestIds?: ReadonlySet<string>
  showToolDetails?: boolean
  toolCalls: MessageToolCall[]
}>(), {
  showToolDetails: undefined,
})
const emit = defineEmits<{
  cancel: []
  'client-response': [response: ClientRequestResponse]
  'open-link': [link: CodexConversationLink]
}>()
// Stryker restore all

const expanded = ref(false)
const recentlyCompletedIds = ref<ReadonlySet<string>>(new Set())
const recentCompletionTimers = new Map<string, ReturnType<typeof setTimeout>>()
const recentCompletionRetentionMs = 3_000
let previousActiveIds = new Set(props.toolCalls.filter(isActiveToolCall).map((toolCall) => toolCall.id))
const providedToolDetails = useCodexToolCallDetails()
const toolDetailsEnabled = computed(() => props.showToolDetails ?? providedToolDetails.value)

const isSingleTool = computed(() => props.toolCalls.length === 1)
const singleConfirmationToolCall = computed(() => {
  if (!isSingleTool.value || !props.toolCalls[0] || !isConfirmationTool(props.toolCalls[0])) {
    return undefined
  }

  return props.toolCalls[0]
})
const completedToolCalls = computed(() => props.toolCalls.filter((toolCall) => !isActiveToolCall(toolCall)))
const headerToolCall = computed(() => (
  !props.activityTitle && isSingleTool.value && completedToolCalls.value.length === 1
    ? props.toolCalls[0]
    : undefined
))
const statusToolCalls = computed(() => props.toolCalls.filter((toolCall) => (
  isActiveToolCall(toolCall)
  || (
    !expanded.value
    && recentlyCompletedIds.value.has(toolCall.id)
    && headerToolCall.value?.id !== toolCall.id
  )
)))
const statusContainerVisible = ref(statusToolCalls.value.length > 0)
const lineDiff = computed(() => getToolGroupLineDiff(props.toolCalls))
const canExpand = computed(() => (
  Boolean(props.activityTitle)
  || props.toolCalls.length > 1
  || (toolDetailsEnabled.value && props.toolCalls.some(hasToolDetails))
))
const summary = computed(() => {
  if (completedToolCalls.value.length > 0) {
    const completed = `${formatActions(completedToolCalls.value.length)} done`
    return props.activityTitle ? `${props.activityTitle} · ${completed}` : completed
  }

  return props.activityTitle ?? 'No actions'
})

watch(
  () => props.toolCalls.map((toolCall) => ({ id: toolCall.id, active: isActiveToolCall(toolCall) })),
  (toolStates) => {
    const currentIds = new Set(toolStates.map((toolCall) => toolCall.id))
    const currentActiveIds = new Set(
      toolStates.filter((toolCall) => toolCall.active).map((toolCall) => toolCall.id),
    )

    for (const id of previousActiveIds) {
      if (!currentActiveIds.has(id) && currentIds.has(id)) retainCompletedTool(id)
    }
    for (const id of currentActiveIds) clearRecentCompletion(id)
    for (const id of recentlyCompletedIds.value) {
      if (!currentIds.has(id)) clearRecentCompletion(id)
    }

    previousActiveIds = currentActiveIds
  },
  { flush: 'sync' },
)

watch(
  [() => statusToolCalls.value.length, expanded, () => headerToolCall.value?.id],
  ([statusCount, isExpanded, headerId]) => {
    if (statusCount > 0) {
      statusContainerVisible.value = true
    } else if (isExpanded || headerId) {
      statusContainerVisible.value = false
    }
  },
  { flush: 'sync' },
)

onBeforeUnmount(() => {
  for (const timer of recentCompletionTimers.values()) clearTimeout(timer)
  recentCompletionTimers.clear()
})

function toggleExpanded() {
  if (!canExpand.value) return
  expanded.value = !expanded.value
}

function formatActions(count: number) {
  return `${count} ${count === 1 ? 'action' : 'actions'}`
}

function retainCompletedTool(id: string) {
  recentlyCompletedIds.value = new Set(recentlyCompletedIds.value).add(id)
  recentCompletionTimers.set(id, setTimeout(() => clearRecentCompletion(id), recentCompletionRetentionMs))
}

function clearRecentCompletion(id: string) {
  const timer = recentCompletionTimers.get(id)
  clearTimeout(timer)
  recentCompletionTimers.delete(id)
  if (!recentlyCompletedIds.value.has(id)) return
  const next = new Set(recentlyCompletedIds.value)
  next.delete(id)
  recentlyCompletedIds.value = next
}

function hideEmptyStatusContainer() {
  if (statusToolCalls.value.length === 0) statusContainerVisible.value = false
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
  min-width: 0;
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
  outline: none;
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
  min-width: 0;
}

.chat-tool-group__running {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  padding-top: var(--space-2);
}

.chat-tool-group__running-item {
  height: var(--line-height-20);
  overflow: hidden;
}

.chat-tool-group__running-item-content {
  min-height: var(--line-height-20);
  min-width: 0;
}

.chat-tool-group-running-leave-active {
  transition:
    height 320ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 320ms ease;
}

.chat-tool-group-running-leave-active > .chat-tool-group__running-item-content {
  transition: transform 320ms cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-tool-group-running-leave-to {
  height: 0;
  opacity: 0.3;
}

.chat-tool-group-running-leave-to > .chat-tool-group__running-item-content {
  transform: translateY(-100%);
}

.chat-tool-group__running--after-completed {
  padding-top: calc(var(--space-2) + (var(--space-1) * 2));
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
  min-width: 0;
  padding-top: var(--space-2);
}

.chat-tool-group__body .chat-tool-call:only-of-type:deep() .chat-tool-call__body {
  padding-top: 0;
}

@media (prefers-reduced-motion: reduce) {
  .chat-tool-group-running-leave-active,
  .chat-tool-group-running-leave-active > .chat-tool-group__running-item-content {
    transition: none;
  }
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
