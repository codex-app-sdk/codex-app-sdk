<template>
  <div class="codex-message-turn">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import type { SurfaceMessage } from '@codex-app-sdk/core/surface'
import {
  computeMessageBlocks,
  hasExplicitAssistantWorkPhases,
  isAssistantWorkBlock,
} from '../chat/message-blocks'
import { chatMessageFromInput } from '../chat/renderer-message-adapter'
import type { Message } from '../chat/types'
import { assistantWorkTurnKey } from '../chat/message-work-state'

type TurnEntry = {
  index: number
  message: Message | SurfaceMessage
}

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  active?: boolean
  entries: readonly TurnEntry[]
  showToolBlocks: boolean
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
const finalStarted = computed(() => messages.value.some(({ message }) => (
  message.role === 'assistant' && (message.parts?.some((part) => (
    part.type === 'text'
      && part.phase === 'final_answer'
      && part.content.trim().length > 0
  )) ?? false)
)))
const active = computed(() => !finalStarted.value && (props.active ?? messages.value.some(({ message }) => (
  message.role === 'assistant' && message.streaming === true
))))
const completedWithoutFinal = computed(() => phased.value && !active.value && !finalStarted.value)
const latestStreamingAssistantIndex = computed(() => [...messages.value]
  .reverse()
  .find(({ message }) => message.role === 'assistant' && message.streaming === true)
  ?.entry.index)
const headerMessageIndex = computed(() => messages.value.find(({ message }) => (
  message.role === 'assistant' && shouldGroupMessageWork(message)
))?.entry.index)
const enabled = computed(() => Boolean(turnId.value && headerMessageIndex.value !== undefined))
const expanded = ref(active.value && !finalStarted.value)
const userToggled = ref(false)

watch(finalStarted, (started, previous) => {
  if (started && !previous) expanded.value = false
})

watch(active, (isActive) => {
  if (!userToggled.value) expanded.value = isActive && !finalStarted.value
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
  if (phased.value) return blocks.some(isAssistantWorkBlock)
  return active.value && blocks.every((block) => block.type === 'tool' || block.type === 'tool-group')
}
</script>

<style scoped>
.codex-message-turn {
  display: contents;
}
</style>
