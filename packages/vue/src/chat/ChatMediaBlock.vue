<template>
  <figure ref="rootElement" class="codex-chat-theme chat-media-block">
    <button
      class="chat-media-block__image-button"
      type="button"
      :aria-label="fullscreenLabel"
      @click="openFullscreen"
    >
      <img
        class="chat-media-block__image"
        :alt="media.alt || generatedAltLabel"
        :src="media.url"
      >
    </button>
    <figcaption class="chat-media-block__footer">
      <span class="chat-media-block__title">{{ media.title || generatedLabel }}</span>
      <span class="chat-media-block__actions">
        <ChatIconButton :label="fullscreenLabel" @click="openFullscreen">
          <Maximize2 />
        </ChatIconButton>
        <ChatIconButton
          :download="downloadName"
          :href="media.url"
          :label="downloadLabel"
          @click.stop
        >
          <Download />
        </ChatIconButton>
        <ChatIconButton v-if="media.prompt" :label="promptLabel" @click="toggleDetails">
          <Info />
        </ChatIconButton>
      </span>
    </figcaption>
    <ChatFoldTransition v-if="media.prompt" :open="detailsOpen">
      <div class="chat-media-block__details">
        <div class="chat-media-block__details-title">{{ promptLabel }}</div>
        <p class="chat-media-block__prompt">{{ media.prompt }}</p>
      </div>
    </ChatFoldTransition>
    <ChatImageLightbox
      :alt="media.alt || generatedAltLabel"
      :label="media.title || generatedLabel"
      :open="fullscreenOpen"
      :src="media.url"
      :theme-source="rootElement"
      @close="closeFullscreen"
    />
  </figure>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download, Info, Maximize2 } from '../icons/app-icons'
import ChatFoldTransition from './ChatFoldTransition.vue'
import ChatImageLightbox from './ChatImageLightbox.vue'
import ChatIconButton from './ChatIconButton.vue'
import type { CodexMessageImageOpenHandler } from './message-image'
import type { MessageMedia } from './types'

const props = defineProps<{
  media: MessageMedia
  openImage?: CodexMessageImageOpenHandler
}>()

const downloadLabel = 'Download media'
const fullscreenLabel = 'Open fullscreen'
const generatedAltLabel = 'Generated media'
const generatedLabel = 'Generated media'
const promptLabel = 'Prompt'
const detailsOpen = ref(false)
const fullscreenOpen = ref(false)
const rootElement = ref<HTMLElement | null>(null)
const downloadName = computed(() => mediaDownloadName(props.media))

async function openFullscreen() {
  const image = {
    alt: props.media.alt || generatedAltLabel,
    kind: 'media',
    mimeType: props.media.mimeType,
    name: props.media.title,
    src: props.media.url,
    title: props.media.title || generatedLabel,
  } as const
  if (await props.openImage?.(image) === true) return
  fullscreenOpen.value = true
}

function closeFullscreen() {
  fullscreenOpen.value = false
}

function toggleDetails() {
  detailsOpen.value = !detailsOpen.value
}

function mediaDownloadName(media: MessageMedia): string {
  const baseName = (media.title?.trim() || media.alt?.trim() || 'generated-image')
    .replace(/[\\/:*?"<>|]+/g, '-')
  if (/\.[a-z\d]{2,5}$/i.test(baseName)) return baseName
  const extension = {
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }[media.mimeType ?? '']
  return extension ? `${baseName}.${extension}` : baseName
}

</script>

<style scoped>
.chat-media-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 60%;
  margin: var(--space-3) var(--space-6);
}

.chat-media-block__image-button {
  display: block;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: none;
  border-radius: var(--radius-lg);
  appearance: none;
  background: var(--color-surface-low);
  cursor: pointer;
}

.chat-media-block__image {
  display: block;
  width: 100%;
  height: auto;
}

.chat-media-block__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
}

.chat-media-block__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-media-block__actions {
  display: inline-flex;
  align-items: center;
  gap: 0;
}

.chat-media-block__details {
  color: var(--color-text-muted);
}

.chat-media-block__details-title {
  margin-bottom: var(--space-2);
  color: var(--color-text);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-16);
}

.chat-media-block__prompt {
  margin: 0;
  font-size: var(--font-size-13);
  line-height: var(--line-height-20);
  white-space: pre-wrap;
}

</style>
