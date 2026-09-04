<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="codex-chat-theme chat-image-lightbox chat-media-block__fullscreen"
      :data-codex-theme="portalTheme.mode"
      :style="portalTheme.style"
      role="dialog"
      aria-modal="true"
      :aria-label="label"
      @click.self="emit('close')"
    >
      <ChatIconButton
        bordered
        class="chat-image-lightbox__close chat-media-block__fullscreen-close"
        :label="closeLabel"
        @click="emit('close')"
      >
        <X />
      </ChatIconButton>
      <img
        class="chat-image-lightbox__image chat-media-block__fullscreen-image"
        :alt="alt"
        :src="src"
      >
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { X } from '../icons/app-icons'
import ChatIconButton from './ChatIconButton.vue'
import { captureCodexPortalTheme, type CodexPortalTheme } from './portal-theme'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  alt: string
  closeLabel?: string
  label: string
  open: boolean
  src: string
  themeSource?: HTMLElement | null
}>(), {
  closeLabel: 'Close fullscreen',
  themeSource: null,
})
// Stryker restore all

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const emit = defineEmits<{
  close: []
}>()
// Stryker restore all

const portalTheme = ref<CodexPortalTheme>({ mode: 'light', style: {} })

watch(() => props.open, (open) => {
  if (open) {
    portalTheme.value = captureCodexPortalTheme(props.themeSource)
    window.addEventListener('keydown', handleKeydown)
  } else {
    window.removeEventListener('keydown', handleKeydown)
  }
}, { immediate: true })

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}
</script>

<style scoped>
.chat-image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(var(--space-20) + var(--space-12)) var(--space-12) var(--space-12);
  background: var(--color-overlay);
}

.chat-image-lightbox__close {
  position: absolute;
  top: var(--space-6);
  right: var(--space-6);
}

.chat-image-lightbox__image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  object-fit: contain;
}
</style>
