<template>
  <figure
    v-if="previewSource && !previewFailed"
    class="codex-chat-theme chat-attachment-block chat-attachment-block--image"
    :title="attachment.path || attachment.url || attachment.name"
  >
    <img
      class="chat-attachment-block__preview"
      :alt="attachment.name"
      :src="previewSource"
      @error="previewFailed = true"
    >
  </figure>
  <component
    :is="chipHref ? 'a' : 'span'"
    v-else
    class="codex-chat-theme chat-attachment-block chat-attachment-block--chip"
    :href="chipHref"
    :title="attachment.path || attachment.url || attachment.name"
  >
    <PhotoIcon v-if="attachment.kind === 'image'" aria-hidden="true" />
    <PaperclipIcon v-else aria-hidden="true" />
    <span class="chat-attachment-block__name">{{ attachment.name }}</span>
  </component>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PaperclipIcon, PhotoIcon } from '../icons/app-icons'
import type { MessageAttachment } from './types'

const props = defineProps<{
  attachment: MessageAttachment
}>()

const previewFailed = ref(false)
const previewSource = computed(() => (
  props.attachment.kind === 'image' && isSafeImageSource(props.attachment.url)
    ? props.attachment.url
    : undefined
))
const chipHref = computed(() => (
  safeFileHref(props.attachment.path) || safeLinkHref(props.attachment.url)
))

watch(previewSource, () => {
  previewFailed.value = false
})

function isSafeImageSource(value: string | undefined): value is string {
  if (!value) return false
  if (/^(?:\.\.?\/|\/(?!\/))/.test(value)) return true
  return /^(?:https?:|file:|blob:)/i.test(value)
    || /^data:image\/(?:avif|bmp|gif|heic|heif|jpe?g|png|webp);base64,/i.test(value)
}

function safeLinkHref(value: string | undefined): string | undefined {
  return value && /^(?:https?:|file:)/i.test(value) ? value : undefined
}

function safeFileHref(value: string | undefined): string | undefined {
  if (!value || /^(?:\\\\|\/\/)/.test(value)) return undefined
  if (/^[a-z]:[\\/]/i.test(value)) return value
  return /^[a-z][a-z\d+.-]*:/i.test(value)
    ? (/^file:/i.test(value) ? value : undefined)
    : value
}
</script>

<style scoped>
.chat-attachment-block {
  box-sizing: border-box;
  max-width: 100%;
  color: inherit;
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.chat-attachment-block--image {
  width: min(160px, 100%);
  margin: 0;
  padding: var(--space-1);
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
}

.chat-attachment-block__preview {
  display: block;
  width: 100%;
  height: 120px;
  border-radius: calc(var(--radius-lg) - var(--space-1));
  object-fit: cover;
}

.chat-attachment-block--chip {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
}

.chat-attachment-block--chip {
  width: fit-content;
  max-width: 260px;
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-lowest);
  color: var(--color-text);
  text-decoration: none;
}

a.chat-attachment-block--chip:hover {
  border-color: var(--color-border-strong, var(--color-text-muted));
  background: var(--color-surface-low);
}

.chat-attachment-block svg {
  width: var(--space-8);
  height: var(--space-8);
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

.chat-attachment-block__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

</style>
