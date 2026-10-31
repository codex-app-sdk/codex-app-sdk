<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="codex-chat-theme chat-image-lightbox chat-media-block__fullscreen"
      :data-codex-theme="portalTheme.mode"
      :style="portalTheme.style"
      role="dialog"
      aria-modal="true"
      :aria-label="activeImage?.label || label"
      @click.self="emit('close')"
    >
      <ChatIconButton
        class="chat-image-lightbox__close chat-media-block__fullscreen-close"
        :label="closeLabel"
        @click="emit('close')"
      >
        <X />
      </ChatIconButton>
      <ChatIconButton v-if="images.length > 1"
        class="chat-image-lightbox__previous" label="Previous image"
        :disabled="loading || position === 0" @click="navigate(-1)"
      ><ChevronLeftIcon /></ChatIconButton>
      <img
        v-if="imageSource && !failed"
        class="chat-image-lightbox__image chat-media-block__fullscreen-image"
        :alt="activeImage?.alt || alt"
        :src="imageSource"
        @error="failed = true"
      >
      <p v-else role="status">{{ loading ? 'Loading image…' : 'Image unavailable' }}</p>
      <ChatIconButton v-if="images.length > 1"
        class="chat-image-lightbox__next" label="Next image"
        :disabled="loading || position === images.length - 1" @click="navigate(1)"
      ><ChevronRightIcon /></ChatIconButton>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronLeftIcon, ChevronRightIcon, X } from '../icons/app-icons'
import { imageGalleryKey, imageGalleryMessageKey, type GalleryImage } from './image-gallery'
import { useHostImageSource } from './host-image-previews'
import ChatIconButton from './ChatIconButton.vue'
import { captureCodexPortalTheme, type CodexPortalTheme } from './portal-theme'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  alt: string
  closeLabel?: string
  label: string
  open: boolean
  src: string
  reference?: string
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
const gallery = inject(imageGalleryKey, undefined)
const message = inject(imageGalleryMessageKey, undefined)
const images = ref<GalleryImage[]>([])
const position = ref(-1)
const initialPosition = ref(-1)
const failed = ref(false)
const loading = ref(false)
const activeImage = computed(() => images.value[position.value])
const source = useHostImageSource(() => props.open && position.value !== initialPosition.value
  ? activeImage.value?.reference || '' : '', loading)
const imageSource = computed(() => position.value === initialPosition.value ? props.src : source.value)

watch(() => props.open, (open) => {
  if (open) {
    const candidates = message?.value.role === 'assistant' ? gallery?.value || [] : []
    position.value = candidates.findIndex(image => image.messageId === message?.value.id
      && image.reference === props.reference && image.label === props.label)
    initialPosition.value = position.value
    images.value = position.value < 0 ? [] : [...candidates]
    failed.value = false
    portalTheme.value = captureCodexPortalTheme(props.themeSource)
    window.addEventListener('keydown', handleKeydown)
  } else {
    images.value = []
    window.removeEventListener('keydown', handleKeydown)
  }
}, { immediate: true })

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
  if (images.value.length < 2 || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    navigate(event.key === 'ArrowLeft' ? -1 : 1)
  }
}

function navigate(direction: number) {
  if (loading.value) return
  const next = position.value + direction
  if (next < 0 || next >= images.value.length) return
  failed.value = false
  position.value = next
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
  padding: calc(var(--space-20) + var(--space-12)) var(--space-32) var(--space-12);
  background: rgb(0 0 0 / 88%);
  color: #fff;
}

.chat-image-lightbox :deep(.chat-icon-button) {
  --color-outline: #fff;
  --color-text: #fff;
  --color-surface-low: rgb(255 255 255 / 12%);
}

.chat-image-lightbox :deep(.chat-icon-button svg) {
  width: var(--space-12);
  height: var(--space-12);
}

.chat-image-lightbox__close {
  position: absolute;
  top: var(--space-6);
  right: var(--space-6);
}

.chat-image-lightbox__previous,
.chat-image-lightbox__next {
  position: absolute;
  top: 50%;
  width: var(--space-24);
  height: var(--space-24);
  transform: translateY(-50%);
}
.chat-image-lightbox__previous { left: var(--space-6); }
.chat-image-lightbox__next { right: var(--space-6); }

.chat-image-lightbox__image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  object-fit: contain;
}
</style>
