<template>
  <button
    class="codex-chat-theme codex-composer-send-button"
    :class="{ 'codex-composer-send-button--busy': busy }"
    type="button"
    :disabled="disabled"
    :aria-label="busy ? interruptLabel : submitLabel"
    @click="emit('click')"
  >
    <svg v-if="!busy" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <path d="M14 8 2 2l2.5 6L2 14l12-6Z" fill="currentColor" />
    </svg>
    <svg
      v-else
      class="codex-composer-send-button__spinner"
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="28" stroke-dashoffset="10" />
    </svg>
    <svg
      v-if="busy"
      class="codex-composer-send-button__stop"
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
    >
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  busy?: boolean;
  disabled?: boolean;
  interruptLabel?: string;
  submitLabel?: string;
}>(), {
  busy: false,
  disabled: false,
  interruptLabel: 'Interrupt',
  submitLabel: 'Send',
});

const emit = defineEmits<{
  click: [];
}>();
</script>

<style scoped>
.codex-composer-send-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: var(--chat-composer-send-size, var(--chat-composer-control-size, var(--codex-composer-button-size, 32px)));
  height: var(--chat-composer-send-size, var(--chat-composer-control-size, var(--codex-composer-button-size, 32px)));
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: var(--codex-composer-button-foreground, var(--color-surface-lowest, #fff));
  background: var(--codex-composer-button-background, var(--color-text, #202124));
  cursor: pointer;
  transition: opacity 120ms ease, transform 120ms ease, background 120ms ease;
}

.codex-composer-send-button:hover:not(:disabled) {
  background: var(--codex-composer-button-hover-background, color-mix(in srgb, var(--color-text, #202124) 86%, var(--color-background, #fff)));
}

.codex-composer-send-button:active:not(:disabled) {
  transform: scale(0.94);
}

.codex-composer-send-button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.codex-composer-send-button__spinner,
.codex-composer-send-button__stop {
  position: absolute;
}

.codex-composer-send-button__spinner {
  animation: codex-composer-spin 800ms linear infinite;
}

.codex-composer-send-button__stop {
  opacity: 0;
}

.codex-composer-send-button--busy:hover .codex-composer-send-button__spinner {
  opacity: 0;
}

.codex-composer-send-button--busy:hover .codex-composer-send-button__stop {
  opacity: 1;
}

@keyframes codex-composer-spin {
  to { transform: rotate(360deg); }
}
</style>
