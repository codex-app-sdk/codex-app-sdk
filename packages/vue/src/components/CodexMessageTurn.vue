<template>
  <div class="codex-message-turn">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, provide, ref, shallowReactive, watch } from 'vue'
import type { CodexSurfaceTurnStatus, SurfaceMessage } from '@codex-app-sdk/core/surface'
import {
  computeMessageBlocks,
  hasExplicitAssistantWorkPhases,
  isAssistantWorkBlock,
} from '../chat/message-blocks'
import { chatMessageFromInput } from '../chat/renderer-message-adapter'
import type { Message } from '../chat/types'
import { assistantWorkTurnKey, questionResponsesKey } from '../chat/message-work-state'

provide(questionResponsesKey, inject(questionResponsesKey, undefined) ?? shallowReactive(new Map()))

type TurnEntry = {
  index: number
  message: Message | SurfaceMessage
}

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  active?: boolean
  answeredClientRequestIds?: ReadonlySet<string>
  durationMs?: number | null
  itemsView?: 'summary' | 'full'
  detailsLoading?: boolean
  detailsError?: string | null
  entries: readonly TurnEntry[]
  showToolBlocks: boolean
  startedAt?: string | null
  status?: CodexSurfaceTurnStatus
  turnId?: string
}>()
const emit = defineEmits<{ loadTurnHistory: [turnId: string] }>()
// Stryker restore all

const messages = computed(() => props.entries.map((entry) => ({
  entry,
  message: chatMessageFromInput(entry.message),
})))
const turnId = computed(() => props.turnId)
const phased = computed(() => messages.value.some(({ message }) => (
  message.role === 'assistant' && hasExplicitAssistantWorkPhases(message)
)))
const latestStreamingAssistantIndex = computed(() => [...messages.value]
  .reverse()
  .find(({ message }) => message.role === 'assistant' && message.streaming === true)
  ?.entry.index)
const latestStreamingWorkIndex = computed(() => props.active === false
  ? undefined
  : [...messages.value]
      .reverse()
      .find(({ message }) => (
        message.role === 'assistant'
        && message.streaming === true
        && (message.parts?.length ?? 0) > 0
      ))
      ?.entry.index)
const finalStarted = computed(() => messages.value.some(({ entry, message }) => (
  message.role === 'assistant'
  && (latestStreamingWorkIndex.value === undefined
    || entry.index >= latestStreamingWorkIndex.value)
  && (message.parts?.some((part) => (
    part.type === 'text'
      && part.phase === 'final_answer'
      && part.content.trim().length > 0
  )) ?? false)
)))
const active = computed(() => !finalStarted.value && (props.active ?? messages.value.some(({ message }) => (
  message.role === 'assistant' && message.streaming === true
))))
const status = computed(() => props.status)
const startedAt = computed(() => props.startedAt)
const durationMs = computed(() => props.durationMs)
const stoppedWithoutFinal = computed(() => (
  !active.value
  && !finalStarted.value
  && (status.value === 'interrupted' || status.value === 'failed')
))
const completedWithoutFinal = computed(() => (
  props.itemsView === undefined
  && phased.value
  && !active.value
  && !finalStarted.value
  && (status.value === undefined || status.value === 'completed')
))
const headerMessageIndex = computed(() => messages.value.find(({ message }) => (
  message.role === 'assistant' && (props.itemsView !== undefined || shouldGroupMessageWork(message))
))?.entry.index)
const hasDetails = computed(() => props.itemsView === 'summary' || messages.value.some(({ message }) => (
  (message.type === 'steer' && computeMessageBlocks(message).length > 0)
  || message.role === 'assistant' && computeMessageBlocks(message).some(block => (
    (props.showToolBlocks || (block.type !== 'tool' && block.type !== 'tool-group'))
    && isAssistantWorkBlock(block, props.answeredClientRequestIds)
  ))
)))
const enabled = computed(() => Boolean(turnId.value && headerMessageIndex.value !== undefined))
const expanded = ref((active.value && !finalStarted.value) || stoppedWithoutFinal.value)
const userToggled = ref(false)
const detailsLoading = computed(() => props.detailsLoading || (
  expanded.value && props.itemsView === 'summary' && !props.detailsError
))

watch(finalStarted, (started, previous) => {
  if (started && !previous && !userToggled.value) expanded.value = false
})

watch([active, stoppedWithoutFinal], ([isActive, isStoppedWithoutFinal]) => {
  if (!userToggled.value) expanded.value = (isActive && !finalStarted.value) || isStoppedWithoutFinal
})

provide(assistantWorkTurnKey, {
  active,
  completedWithoutFinal,
  enabled,
  expanded: computed(() => expanded.value && !detailsLoading.value && (props.itemsView !== 'summary' || Boolean(props.detailsError))),
  finalStarted,
  headerMessageIndex,
  latestStreamingAssistantIndex,
  phased,
  startedAt,
  durationMs,
  hasDetails,
  itemsView: computed(() => props.itemsView),
  detailsLoading,
  detailsError: computed(() => props.detailsError),
  reloadDetails: () => { if (props.turnId) emit('loadTurnHistory', props.turnId) },
  status,
  turnId,
  toggle() {
    userToggled.value = true
    expanded.value = !expanded.value
  },
})

watch([expanded, () => props.itemsView, () => props.detailsLoading, () => props.detailsError], () => {
  if (expanded.value && props.itemsView === 'summary' && !props.detailsLoading && !props.detailsError && props.turnId) emit('loadTurnHistory', props.turnId)
}, { immediate: true })

function shouldGroupMessageWork(message: Message): boolean {
  const blocks = computeMessageBlocks(message).filter((block) => (
    props.showToolBlocks || (block.type !== 'tool' && block.type !== 'tool-group')
  ))
  if (blocks.length === 0) return false
  if (phased.value) return blocks.some((block) => isAssistantWorkBlock(block, props.answeredClientRequestIds))
  return active.value && blocks.every((block) => block.type === 'tool' || block.type === 'tool-group')
}
</script>

<style scoped>
.codex-message-turn {
  display: contents;
}
</style>
