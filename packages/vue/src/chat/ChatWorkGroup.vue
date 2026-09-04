<template>
  <section class="codex-chat-theme chat-work-group">
    <button
      type="button"
      class="chat-work-group__header"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <span
        class="chat-work-group__title"
        :class="{ 'codex-text-shimmer': active }"
        :data-label="label"
      >
        {{ label }}
      </span>
      <component :is="expanded ? ChevronDown : ChevronRightIcon" :size="15" />
    </button>

    <ChatFoldTransition :open="expanded">
      <div class="chat-work-group__body">
        <slot />
      </div>
    </ChatFoldTransition>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronRightIcon } from '../icons/app-icons'
import { useCodexChatTranslate } from './chat-i18n'
import ChatFoldTransition from './ChatFoldTransition.vue'

const props = defineProps<{
  active: boolean
  finalStarted: boolean
}>()

const t = useCodexChatTranslate()
const expanded = ref(props.active && !props.finalStarted)
const userToggled = ref(false)
const label = computed(() => {
  if (props.active) return t('chat.work.working')
  return t(expanded.value ? 'chat.work.doneHideDetails' : 'chat.work.doneViewDetails')
})

watch(
  () => props.finalStarted,
  (started, previous) => {
    if (started && !previous) expanded.value = false
  },
)

watch(
  () => props.active,
  (active) => {
    if (!userToggled.value) expanded.value = active && !props.finalStarted
  },
)

function toggle() {
  userToggled.value = true
  expanded.value = !expanded.value
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
</style>
