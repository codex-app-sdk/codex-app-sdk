<template>
  <section
    v-if="showHeader || expanded"
    class="codex-chat-theme chat-work-group"
    :class="{ 'chat-work-group--continuation': !showHeader }"
  >
    <button
      v-if="showHeader"
      type="button"
      class="chat-work-group__header"
      :aria-expanded="expanded"
      :disabled="active"
      @click="toggle"
    >
      <span
        class="chat-work-group__title"
        :class="{ 'codex-text-shimmer': active }"
        :data-label="label"
      >
        {{ label }}
      </span>
      <component v-if="!active" :is="expanded ? ChevronDown : ChevronRightIcon" :size="15" />
    </button>

    <ChatFoldTransition v-if="showHeader" :open="expanded">
      <div class="chat-work-group__body">
        <slot />
      </div>
    </ChatFoldTransition>
    <div v-else class="chat-work-group__body chat-work-group__body--continuation">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { ChevronDown, ChevronRightIcon } from '../icons/app-icons'
import { useCodexChatTranslate } from './chat-i18n'
import ChatFoldTransition from './ChatFoldTransition.vue'
import { assistantWorkMessageIndexKey, assistantWorkTurnKey } from './message-work-state'

const props = defineProps<{
  active: boolean
  continuation?: boolean
  finalStarted: boolean
}>()

const t = useCodexChatTranslate()
const assistantWorkTurn = inject(assistantWorkTurnKey, undefined)
const messageIndex = inject(assistantWorkMessageIndexKey, undefined)
const usesTurn = computed(() => assistantWorkTurn?.enabled.value === true && messageIndex !== undefined)
const completedWithoutFinal = computed(() => (
  usesTurn.value
    ? assistantWorkTurn!.completedWithoutFinal.value
    : !props.active && !props.finalStarted
))
const localExpanded = ref(props.active && !props.finalStarted)
const userToggled = ref(false)
const active = computed(() => (
  (usesTurn.value ? assistantWorkTurn!.active.value : props.active) && !props.finalStarted
))
const expanded = computed(() => (
  active.value
    ? true
    : completedWithoutFinal.value
    ? true
    : usesTurn.value ? assistantWorkTurn!.expanded.value : localExpanded.value
))
const showHeader = computed(() => (
  !props.continuation
  && !completedWithoutFinal.value
  && (!usesTurn.value || assistantWorkTurn!.headerMessageIndex.value === messageIndex!.value)
))
const label = computed(() => {
  if (active.value) return t('chat.work.working')
  return t(expanded.value ? 'chat.work.doneHideDetails' : 'chat.work.doneViewDetails')
})

watch(
  () => props.finalStarted,
  (started, previous) => {
    if (!usesTurn.value && started && !previous) localExpanded.value = false
  },
)

watch(
  () => props.active,
  (isActive) => {
    if (!usesTurn.value && !userToggled.value) localExpanded.value = isActive && !props.finalStarted
  },
)

function toggle() {
  if (active.value) return
  if (usesTurn.value) {
    assistantWorkTurn!.toggle()
    return
  }
  userToggled.value = true
  localExpanded.value = !localExpanded.value
}
</script>

<style scoped>
.chat-work-group {
  width: 100%;
  min-width: 0;
  color: var(--color-text-muted);
}

.chat-work-group__header {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: var(--space-2);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.chat-work-group__header:focus-visible {
  outline: none;
}

.chat-work-group__header:disabled {
  cursor: default;
}

.chat-work-group__title {
  overflow: hidden;
  font-size: var(--font-size-15);
  font-weight: var(--font-weight-light);
  line-height: var(--line-height-20);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-work-group__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-4);
  padding-top: var(--space-3);
}

.chat-work-group__body--continuation {
  padding-top: 0;
}
</style>
