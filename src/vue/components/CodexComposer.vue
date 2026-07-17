<template>
  <form class="codex-composer" @submit.prevent="submit">
    <slot name="before" />
    <textarea
      ref="textarea"
      class="codex-composer__input"
      :autofocus="autofocus"
      :disabled="disabled"
      :placeholder="placeholder"
      :rows="rows"
      :value="modelValue"
      @input="updateValue"
      @keydown="handleKeydown"
    />
    <slot name="after-input" />
    <CodexComposerSendButton
      :busy="busy"
      :disabled="buttonDisabled"
      :interrupt-label="interruptLabel"
      :submit-label="submitLabel"
      @click="handleAction"
    />
    <slot name="after" />
  </form>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import CodexComposerSendButton from './CodexComposerSendButton.vue';

const props = withDefaults(defineProps<{
  autofocus?: boolean;
  busy?: boolean;
  disabled?: boolean;
  interruptLabel?: string;
  modelValue: string;
  placeholder?: string;
  rows?: number;
  submitLabel?: string;
  submitOnEnter?: boolean;
}>(), {
  autofocus: false,
  busy: false,
  disabled: false,
  interruptLabel: 'Interrupt',
  placeholder: 'Ask Codex…',
  rows: 1,
  submitLabel: 'Send',
  submitOnEnter: true,
});

const emit = defineEmits<{
  interrupt: [];
  submit: [prompt: string];
  'update:modelValue': [value: string];
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);
const prompt = computed(() => props.modelValue.trim());
const buttonDisabled = computed(() => props.disabled || (!props.busy && prompt.value.length === 0));

function updateValue(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}

function handleAction(): void {
  if (props.busy) {
    if (!props.disabled) {
      emit('interrupt');
    }
    return;
  }
  submit();
}

function submit(): void {
  if (buttonDisabled.value || props.busy) {
    return;
  }
  emit('submit', prompt.value);
  emit('update:modelValue', '');
}

function handleKeydown(event: KeyboardEvent): void {
  const submitShortcut = event.key === 'Enter' && !event.shiftKey && (
    props.submitOnEnter || event.metaKey || event.ctrlKey
  );
  if (!submitShortcut || event.isComposing) {
    return;
  }
  event.preventDefault();
  submit();
}

function focus(): void {
  textarea.value?.focus();
}

defineExpose({ focus });
</script>

<style scoped>
.codex-composer {
  display: flex;
  align-items: flex-end;
  gap: var(--codex-space-2, 8px);
  width: 100%;
  padding: var(--codex-composer-padding, 10px 12px);
  border: 1px solid var(--codex-border-color, #d8dadd);
  border-radius: var(--codex-composer-radius, 16px);
  color: var(--codex-text-color, #202124);
  background: var(--codex-composer-background, #fff);
  box-sizing: border-box;
}

.codex-composer:focus-within {
  border-color: var(--codex-focus-color, #6a6f76);
  box-shadow: 0 0 0 2px var(--codex-focus-ring, rgb(0 0 0 / 8%));
}

.codex-composer__input {
  flex: 1 1 auto;
  min-width: 0;
  max-height: var(--codex-composer-max-height, 240px);
  padding: 7px 2px;
  border: 0;
  outline: 0;
  resize: none;
  color: inherit;
  background: transparent;
  font: inherit;
  line-height: 1.45;
}

.codex-composer__input::placeholder {
  color: var(--codex-muted-text-color, #777b82);
}
</style>

