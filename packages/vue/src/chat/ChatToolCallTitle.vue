<template>
  <span
    class="codex-chat-theme chat-tool-call__title"
    :class="{ 'chat-tool-call__title--running': running, 'codex-text-shimmer': running,
      'chat-tool-call__title--expandable': allowExpand, 'chat-tool-call__title--expanded': expanded,
      'chat-tool-call__title--interactive': allowExpand && (truncated || expanded) }"
    :data-label="title"
    @click="onTitleClick"
  >
    <ChatCopyButton v-if="toolCall" class="chat-tool-call__copy-icon" style="background: transparent" :action="copyTitle" label="Copy full text" copied-label="Copied"
      @pointerenter="iconHovered = $event.pointerType !== 'touch'" @pointerleave="iconHovered = false"
      @focusin="iconFocused = ($event.target as HTMLElement).matches(':focus-visible')" @focusout="iconFocused = false" @click.stop v-slot="{ copied }">
      <CheckIcon v-if="copied" />
      <CopyIcon v-else-if="iconHovered || iconFocused" />
      <template v-else>
        <component v-if="icon" :is="icon" />
        <ChatToolIcon v-else-if="toolCall" :presentation="toolPresentation" :tool-call="toolCall" />
      </template>
    </ChatCopyButton>
    <component v-else-if="icon" :is="icon" />
    <span
      v-if="titlePrefix && titleTarget"
      ref="textElement"
      :id="allowExpand ? textId : undefined"
      class="chat-tool-call__title-content chat-tool-call__title-text"
    >
      <span>{{ titlePrefix }}</span>{{ ' ' }}<span class="chat-tool-call__title-target-list">
        <template v-if="visibleTargetParts?.length">
          <template v-for="(part, index) in visibleTargetParts" :key="`${part.label}-${index}`">
            <span v-if="part.separator" class="chat-tool-call__title-target-separator">{{ part.separator }}</span><a
              v-if="part.link"
              class="chat-tool-call__title-target chat-tool-call__title-target--link"
              :href="part.link.href"
              @click.stop.prevent="emit('open-link', part.link)"
              @keydown.enter.stop.prevent="emit('open-link', part.link)"
              @keydown.space.stop.prevent="emit('open-link', part.link)"
            >{{ part.label }}</a><span v-else class="chat-tool-call__title-target">{{ part.label }}</span><span v-if="part.suffix">{{ part.suffix }}</span>
          </template>
        </template>
        <a
          v-else-if="titleTargetLink"
          class="chat-tool-call__title-target chat-tool-call__title-target--link"
          :href="titleTargetLink.href"
          @click.stop.prevent="emit('open-link', titleTargetLink)"
          @keydown.enter.stop.prevent="emit('open-link', titleTargetLink)"
          @keydown.space.stop.prevent="emit('open-link', titleTargetLink)"
        >{{ titleTarget }}</a>
        <span v-else class="chat-tool-call__title-target">{{ titleTarget }}</span>
      </span>
    </span>
    <span v-else ref="textElement" :id="allowExpand ? textId : undefined" class="chat-tool-call__title-content">
      {{ title }}
    </span>
    <button
      v-if="allowExpand && (truncated || expanded)"
      class="chat-tool-call__title-toggle"
      type="button"
      :aria-label="expanded ? 'Collapse full text' : 'Expand full text'"
      :aria-expanded="expanded"
      :aria-controls="textId"
      @click.stop="toggleExpanded"
    ><component :is="expanded ? ChevronUp : ChevronDown" /></button>
  </span>
  <span v-if="lineDiff" class="codex-chat-theme chat-tool-call__diff" aria-label="Line changes">
    <ChatAnimatedDiffStat
      v-if="lineDiff.addedLines"
      kind="added"
      label="Added lines"
      :value="lineDiff.addedLines"
    />
    <ChatAnimatedDiffStat
      v-if="lineDiff.removedLines"
      kind="deleted"
      label="Removed lines"
      :value="lineDiff.removedLines"
    />
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { CheckIcon, CopyIcon, ChevronDown, ChevronUp } from '../icons/app-icons'
import ChatAnimatedDiffStat from './ChatAnimatedDiffStat.vue'
import ChatCopyButton from './ChatCopyButton.vue'
import { observeTextResize } from './text-resize'
import { useCodexHostCapabilities } from '../native-capabilities'
import ChatToolIcon from './ChatToolIcon.vue'
import type { CodexConversationLink } from './contracts'
import type { CodexToolDisplayTargetPart, ToolLineDiff } from './tool-status'
import type { CodexToolPresentation } from './tool-presentation'
import { getMessageToolCallArgs, type MessageToolCall } from './types'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  allowExpand?: boolean
  lineDiff?: ToolLineDiff
  running?: boolean
  title: string
  titlePrefix?: string
  titleTarget?: string
  titleTargetLink?: CodexConversationLink
  titleTargetParts?: readonly CodexToolDisplayTargetPart[]
  expandedTargetParts?: readonly CodexToolDisplayTargetPart[]
  icon?: any
  toolCall?: MessageToolCall
  toolPresentation?: CodexToolPresentation
}>()

const emit = defineEmits<{
  'open-link': [link: CodexConversationLink]
}>()
// Stryker restore all

const textElement = ref<HTMLElement | null>(null)
const textId = useId()
const expanded = ref(false)
const truncated = ref(false)
const iconHovered = ref(false)
const iconFocused = ref(false)
const host = useCodexHostCapabilities()
const visibleTargetParts = computed(() => expanded.value ? props.expandedTargetParts ?? props.titleTargetParts : props.titleTargetParts)
const hiddenTargets = computed(() => props.expandedTargetParts?.some((part, index) => part.label !== props.titleTargetParts?.[index]?.label) ?? false)
const fullText = computed(() => {
  const input = props.toolCall?.kind === 'command' ? getMessageToolCallArgs(props.toolCall) : undefined
  if (input && typeof input === 'object' && 'command' in input && typeof input.command === 'string') return input.command
  return props.titlePrefix && props.expandedTargetParts?.length
    ? props.titlePrefix + ' ' + props.expandedTargetParts.map(part => (part.separator ?? '') + part.label + (part.suffix ?? '')).join('')
    : props.title
})
async function copyTitle() {
  if (host?.copyToClipboard) await host.copyToClipboard({ text: fullText.value })
  else await navigator.clipboard.writeText(fullText.value)
}
function measureText() {
  if (!expanded.value && textElement.value) truncated.value = hiddenTargets.value || textElement.value.scrollWidth > textElement.value.clientWidth
}
watch([textElement, () => props.allowExpand, () => props.title, hiddenTargets], ([element, allowed], _previous, onCleanup) => {
  if (!allowed || !element) { expanded.value = false; truncated.value = false; return }
  measureText()
  onCleanup(observeTextResize(element, measureText))
}, { flush: 'post', immediate: true })
async function toggleExpanded() {
  expanded.value = !expanded.value
  await nextTick()
  measureText()
}
function onTitleClick(event: MouseEvent) {
  if (!props.allowExpand || (!truncated.value && !expanded.value)) return
  event.stopPropagation()
  void toggleExpanded()
}
</script>

<style scoped>
.chat-tool-call__diff {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--line-height-20);
}

.chat-tool-call__title {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--space-3);
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-15);
  line-height: var(--line-height-20);
  font-weight: var(--font-weight-light);
}

.chat-tool-call__title svg {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
}

.chat-tool-call__title .chat-tool-call__copy-icon {
  flex: 0 0 15px;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: var(--line-height-20);
  padding: 0;
  border-radius: 0;
  background: transparent;
}
.chat-tool-call__title .chat-tool-call__copy-icon:hover,
.chat-tool-call__title .chat-tool-call__copy-icon:focus-visible { background: transparent; }

.chat-tool-call__title--running {
  color: var(--color-text-muted);
}

.chat-tool-call__title--expandable {
  flex: 0 1 auto;
  box-sizing: border-box;
  overflow: visible;
}

.chat-tool-call__title--interactive { cursor: pointer; }

.chat-tool-call__title-toggle {
  position: absolute;
  right: 0;
  top: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: var(--line-height-20);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
}

.chat-tool-call__title--expandable:has(:focus-visible) .chat-tool-call__title-toggle {
  opacity: 1;
  pointer-events: auto;
}

.chat-tool-call__title--expanded {
  align-items: flex-start;
}
.chat-tool-call__title--expanded .chat-tool-call__title-content {
  line-height: var(--line-height-24);
  margin-block: -2px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow: visible;
}

@media (hover: none) {
  .chat-tool-call__title-toggle { opacity: 1; pointer-events: auto; }
}

.chat-tool-call__title-content {
  display: block;
  flex: 1 1 auto;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-tool-call__title-target-list {
  display: inline;
  min-width: 0;
}

.chat-tool-call__title-target-separator {
  white-space: pre;
}

.chat-tool-call__title-target--link {
  color: var(--color-secondary);
  font-weight: var(--font-weight-regular);
  cursor: pointer;
  text-decoration: none;
}
</style>
