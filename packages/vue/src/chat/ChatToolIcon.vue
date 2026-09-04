<template>
  <component
    v-if="resolvedIcon"
    :is="resolvedIcon"
    class="chat-tool-icon"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  FileTextIcon,
  FolderIcon,
  ListDetailsIcon,
  PencilIcon,
  PhotoIcon,
  SearchIcon,
  Terminal2Icon,
  ToolIcon,
  Trash2Icon,
  WorldSearchIcon,
} from '../icons/app-icons'
import type { CodexToolPresentation } from './tool-presentation'
import { parseToolStatusDescriptor } from './tool-status'
import { isImageGenerationToolCall, type MessageToolCall } from './types'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  presentation?: CodexToolPresentation
  toolCall: MessageToolCall
}>()
// Stryker restore all

const resolvedIcon = computed<Component | undefined>(() => {
  if (props.presentation?.icon === null) return undefined
  if (props.presentation?.icon) return props.presentation.icon

  if (isImageGenerationToolCall(props.toolCall)) return PhotoIcon
  if (props.toolCall.kind === 'webSearch') return WorldSearchIcon

  const descriptor = parseToolStatusDescriptor(props.toolCall.status)
  if (descriptor) {
    switch (descriptor.action) {
      case 'create': return PencilIcon
      case 'delete': return Trash2Icon
      case 'edit': return PencilIcon
      case 'explore':
      case 'list': return FolderIcon
      case 'plan': return ListDetailsIcon
      case 'read': return FileTextIcon
      case 'run': return Terminal2Icon
      case 'search': return SearchIcon
    }
  }

  return isCommandLikeToolCall(props.toolCall) ? Terminal2Icon : ToolIcon
})

function isCommandLikeToolCall(toolCall: MessageToolCall): boolean {
  if (toolCall.kind === 'command') return true
  if (isRecord(toolCall.args) && typeof toolCall.args.command === 'string') return true

  return [toolCall.function, toolCall.status].some((value) => (
    typeof value === 'string'
    && /(?:^|\s)(?:\/bin\/)?(?:bash|cmd|fish|powershell|pwsh|sh|zsh)(?:\s|$)/i.test(value)
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
</script>

<style scoped>
.chat-tool-icon {
  width: 15px;
  height: 15px;
}
</style>
