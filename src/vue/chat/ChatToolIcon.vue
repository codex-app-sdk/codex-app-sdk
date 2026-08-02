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
  EyeIcon,
  FileTextIcon,
  FolderIcon,
  ListDetailsIcon,
  PencilIcon,
  PlusCircleIcon,
  SearchIcon,
  TerminalIcon,
  ToolIcon,
  Trash2Icon,
} from '../icons/app-icons'
import type { CodexToolPresentation } from './tool-presentation'
import { parseToolStatusDescriptor } from './tool-status'
import type { MessageToolCall } from './types'

const props = defineProps<{
  presentation?: CodexToolPresentation
  toolCall: MessageToolCall
}>()

const resolvedIcon = computed<Component | undefined>(() => {
  if (props.presentation?.icon === null) return undefined
  if (props.presentation?.icon) return props.presentation.icon

  const descriptor = parseToolStatusDescriptor(props.toolCall.status)
  if (descriptor?.source === 'codex') {
    switch (descriptor.action) {
      case 'create': return PlusCircleIcon
      case 'delete': return Trash2Icon
      case 'edit': return PencilIcon
      case 'explore': return EyeIcon
      case 'list': return FolderIcon
      case 'plan': return ListDetailsIcon
      case 'read': return FileTextIcon
      case 'run': return TerminalIcon
      case 'search': return SearchIcon
    }
  }

  return props.toolCall.kind === 'command' ? TerminalIcon : ToolIcon
})
</script>

<style scoped>
.chat-tool-icon {
  width: 15px;
  height: 15px;
}
</style>
