<template>
  <section
    v-if="showHeader || expanded"
    class="codex-chat-theme chat-work-group"
    :class="{ 'chat-work-group--continuation': !showHeader }"
  >
    <div v-if="showHeader && !hasDetails" class="chat-work-group__header">
      <span class="chat-work-group__title">{{ label }}</span>
    </div>
    <button
      v-else-if="showHeader"
      type="button"
      class="chat-work-group__header"
      :aria-expanded="expanded"
      :disabled="active || detailsLoading"
      :aria-busy="detailsLoading || undefined"
      @click="toggle"
    >
      <span
        class="chat-work-group__title"
        :class="{ 'codex-text-shimmer': active }"
        :data-label="label"
      >
        {{ label }}
      </span>
      <Loader2Icon v-if="detailsLoading" class="chat-work-group__spinner" :size="15" role="status" :aria-label="t('chat.work.loadingDetails')" />
      <component v-else-if="!active" :is="expanded ? ChevronDown : ChevronRightIcon" :size="15" />
    </button>

    <ChatFoldTransition v-if="showHeader && hasDetails" :open="expanded">
      <div class="chat-work-group__body">
        <div v-if="assistantWorkTurn?.detailsError?.value" role="alert">
          {{ assistantWorkTurn.detailsError.value }}
          <button type="button" @click="assistantWorkTurn.reloadDetails?.()">{{ t('chat.actions.retry') }}</button>
        </div>
        <slot v-else />
      </div>
    </ChatFoldTransition>
    <div v-else-if="expanded && hasDetails" class="chat-work-group__body chat-work-group__body--continuation">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onScopeDispose, ref, watch } from 'vue'
import { ChevronDown, ChevronRightIcon, Loader2Icon } from '../icons/app-icons'
import { useCodexChatTranslate } from './chat-i18n'
import ChatFoldTransition from './ChatFoldTransition.vue'
import { assistantWorkMessageIndexKey, assistantWorkTurnKey } from './message-work-state'
import { formatWorkDuration } from './work-duration'

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
  usesTurn.value
    ? assistantWorkTurn!.active.value
    : props.active && !props.finalStarted
))
const hasDetails = computed(() => !usesTurn.value || active.value || assistantWorkTurn!.hasDetails?.value !== false)
const detailsLoading = computed(() => assistantWorkTurn?.detailsLoading?.value === true)
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
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
watch(active, (isActive) => {
  clearInterval(ticker)
  ticker = undefined
  if (!isActive) return
  now.value = Date.now()
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
}, { immediate: true })
onScopeDispose(() => clearInterval(ticker))

const duration = computed(() => {
  if (!usesTurn.value) return ''
  if (!active.value) return formatWorkDuration(assistantWorkTurn!.durationMs?.value)
  const startedAt = assistantWorkTurn!.startedAt?.value
  return startedAt ? formatWorkDuration(now.value - Date.parse(startedAt)) : ''
})
const label = computed(() => {
  const params = { duration: duration.value }
  const timed = duration.value !== ''
  const state = active.value ? 'working'
    : assistantWorkTurn?.status.value === 'interrupted' ? 'stopped'
    : assistantWorkTurn?.status.value === 'failed' ? 'failed'
    : 'done'
  if (state === 'working') return t(timed ? 'chat.work.workingFor' : 'chat.work.working', params)
  if (!hasDetails.value) return t(`chat.work.${state}${timed ? 'For' : ''}`, params)
  const action = expanded.value ? 'HideDetails' : 'ViewDetails'
  return t(`chat.work.${state}${action}${timed ? 'For' : ''}`, params)
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

.chat-work-group__spinner {
  flex-shrink: 0;
  animation: chat-work-group-spin 800ms linear infinite;
}

@keyframes chat-work-group-spin {
  to { transform: rotate(360deg); }
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
