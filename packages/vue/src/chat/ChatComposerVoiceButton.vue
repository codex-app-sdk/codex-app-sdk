<template>
  <button
    class="codex-chat-theme chat-composer__voice"
    :class="{ 'chat-composer__voice--recording': recording }"
    type="button"
    :disabled="disabled"
    :aria-pressed="recording"
    :aria-label="label"
    :title="title"
    @click="emit('toggle')"
    @pointerenter="hovered = recording && $event.pointerType !== 'touch'"
    @pointerleave="hovered = false"
  >
    <slot v-if="recording && !hovered && $slots.recording" name="recording" />
    <component :is="hovered ? MicrophoneOffIcon : MicrophoneIcon" v-else aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { MicrophoneIcon, MicrophoneOffIcon } from '../icons/app-icons'
import { ref, watch } from 'vue'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  disabled: boolean
  label: string
  recording: boolean
  title: string
}>()

const emit = defineEmits<{
  toggle: []
}>()
// Stryker restore all
const hovered = ref(false)
watch(() => props.recording, () => { hovered.value = false })
</script>

<style scoped>
.chat-composer__voice {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--chat-composer-compact-control-size, var(--chat-composer-button-size-small, 28px));
  height: var(--chat-composer-compact-control-size, var(--chat-composer-button-size-small, 28px));
  border: 0;
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.chat-composer__voice:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-surface-base);
}

.chat-composer__voice--recording,
.chat-composer__voice--recording:hover:not(:disabled) {
  color: #fff;
  background: var(--color-primary);
}

.chat-composer__voice:disabled {
  cursor: default;
  opacity: 0.42;
}

.chat-composer__voice svg {
  width: 20px;
  height: 20px;
  stroke-width: 1.8;
}

</style>
