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
  entries: readonly TurnEntry[]
  showToolBlocks: boolean
  status?: CodexSurfaceTurnStatus
  turnId?: string
}>()
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
const stoppedWithoutFinal = computed(() => (
  !active.value
  && !finalStarted.value
  && (status.value === 'interrupted' || status.value === 'failed')
))
const completedWithoutFinal = computed(() => (
  phased.value
  && !active.value
  && !finalStarted.value
  && (status.value === undefined || status.value === 'completed')
))
const headerMessageIndex = computed(() => messages.value.find(({ message }) => (
  message.role === 'assistant' && shouldGroupMessageWork(message)
))?.entry.index)
const enabled = computed(() => Boolean(turnId.value && headerMessageIndex.value !== undefined))
const expanded = ref((active.value && !finalStarted.value) || stoppedWithoutFinal.value)
const userToggled = ref(false)

watch(finalStarted, (started, previous) => {
  if (started && !previous) expanded.value = false
})

watch([active, stoppedWithoutFinal], ([isActive, isStoppedWithoutFinal]) => {
  if (!userToggled.value) expanded.value = (isActive && !finalStarted.value) || isStoppedWithoutFinal
})

provide(assistantWorkTurnKey, {
  active,
  completedWithoutFinal,
  enabled,
  expanded,
  finalStarted,
  headerMessageIndex,
  latestStreamingAssistantIndex,
  phased,
  status,
  turnId,
  toggle() {
    userToggled.value = true
    expanded.value = !expanded.value
  },
})

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
