<template>
  <span
    class="codex-chat-theme chat-tool-call__title"
    :class="{ 'chat-tool-call__title--running': running, 'codex-text-shimmer': running }"
    :data-label="title"
  >
    <component v-if="icon" :is="icon" />
    <ChatToolIcon
      v-else-if="toolCall"
      :presentation="toolPresentation"
      :tool-call="toolCall"
    />
    <span
      v-if="titlePrefix && titleTarget"
      class="chat-tool-call__title-content chat-tool-call__title-text"
    >
      <span>{{ titlePrefix }}</span>{{ ' ' }}<span class="chat-tool-call__title-target-list">
        <template v-if="titleTargetParts?.length">
          <template v-for="(part, index) in titleTargetParts" :key="`${part.label}-${index}`">
            <span v-if="part.separator" class="chat-tool-call__title-target-separator">{{ part.separator }}</span><a
              v-if="part.link"
              class="chat-tool-call__title-target chat-tool-call__title-target--link"
              :href="part.link.href"
              @click.stop.prevent="emit('open-link', part.link)"
              @keydown.enter.stop.prevent="emit('open-link', part.link)"
              @keydown.space.stop.prevent="emit('open-link', part.link)"
            >{{ part.label }}</a><span v-else class="chat-tool-call__title-target">{{ part.label }}</span>
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
    <span v-else class="chat-tool-call__title-content">
      {{ title }}
    </span>
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
import ChatAnimatedDiffStat from './ChatAnimatedDiffStat.vue'
import ChatToolIcon from './ChatToolIcon.vue'
import type { CodexConversationLink } from './contracts'
import type { CodexToolDisplayTargetPart, ToolLineDiff } from './tool-status'
import type { CodexToolPresentation } from './tool-presentation'
import type { MessageToolCall } from './types'

defineProps<{
  lineDiff?: ToolLineDiff
  running?: boolean
  title: string
  titlePrefix?: string
  titleTarget?: string
  titleTargetLink?: CodexConversationLink
  titleTargetParts?: readonly CodexToolDisplayTargetPart[]
  icon?: any
  toolCall?: MessageToolCall
  toolPresentation?: CodexToolPresentation
}>()

const emit = defineEmits<{
  'open-link': [link: CodexConversationLink]
}>()
</script>

<style scoped>
.chat-tool-call__diff {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
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

.chat-tool-call__title--running {
  color: var(--color-text-muted);
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

.chat-tool-call__title-target {
  display: inline;
  color: var(--color-secondary);
  font-weight: var(--font-weight-regular);
}

.chat-tool-call__title-target--link {
  cursor: pointer;
  text-decoration: none;
}
</style>
