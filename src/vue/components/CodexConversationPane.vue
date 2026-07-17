<template>
  <section class="codex-conversation-pane" :aria-busy="busy">
    <header v-if="title || $slots.header" class="codex-conversation-pane__header">
      <slot name="header" :title="title">
        <h1 class="codex-conversation-pane__title">{{ title }}</h1>
      </slot>
    </header>

    <CodexMessageList :aria-label="ariaLabel" :empty-label="emptyLabel" :messages="messages">
      <template v-if="$slots.empty" #empty><slot name="empty" /></template>
      <template v-if="$slots.message" #message="scope"><slot name="message" v-bind="scope" /></template>
    </CodexMessageList>

    <p v-if="error" class="codex-conversation-pane__error" role="alert">{{ error }}</p>

    <footer class="codex-conversation-pane__footer">
      <slot name="before-composer" />
      <CodexComposer
        :autofocus="autofocus"
        :busy="busy"
        :disabled="disabled"
        :model-value="modelValue"
        :placeholder="placeholder"
        @interrupt="emit('interrupt')"
        @submit="emit('submit', $event)"
        @update:model-value="emit('update:modelValue', $event)"
      >
        <template v-if="menuItems.length > 0" #before>
          <CodexComposerMenu
            :disabled="disabled"
            :items="menuItems"
            @select="emit('menuSelect', $event)"
          >
            <template v-if="$slots['menu-icon']" #icon="scope"><slot name="menu-icon" v-bind="scope" /></template>
            <template v-if="$slots['menu-item']" #item="scope"><slot name="menu-item" v-bind="scope" /></template>
          </CodexComposerMenu>
        </template>
        <template v-if="$slots['composer-after-input']" #after-input><slot name="composer-after-input" /></template>
        <template v-if="$slots['composer-after']" #after><slot name="composer-after" /></template>
      </CodexComposer>
      <slot name="after-composer" />
    </footer>
  </section>
</template>

<script setup lang="ts" generic="Payload = unknown">
import type { SurfaceMessage } from '../../surface/types';
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from '../composer-menu';
import CodexComposer from './CodexComposer.vue';
import CodexComposerMenu from './CodexComposerMenu.vue';
import CodexMessageList from './CodexMessageList.vue';

withDefaults(defineProps<{
  ariaLabel?: string;
  autofocus?: boolean;
  busy?: boolean;
  disabled?: boolean;
  emptyLabel?: string;
  error?: string | null;
  menuItems?: readonly CodexComposerMenuItem<Payload>[];
  messages: readonly SurfaceMessage[];
  modelValue: string;
  placeholder?: string;
  title?: string;
}>(), {
  ariaLabel: 'Conversation',
  autofocus: false,
  busy: false,
  disabled: false,
  emptyLabel: 'Start a conversation with Codex',
  error: null,
  menuItems: () => [],
  placeholder: 'Ask Codex…',
  title: '',
});

const emit = defineEmits<{
  interrupt: [];
  menuSelect: [item: CodexComposerMenuSelectableItem<Payload>];
  submit: [prompt: string];
  'update:modelValue': [value: string];
}>();
</script>

<style scoped>
.codex-conversation-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  height: 100%;
  flex-direction: column;
  color: var(--codex-text-color, #202124);
  background: var(--codex-surface-color, #fff);
}

.codex-conversation-pane__header {
  flex: 0 0 auto;
  min-height: 52px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--codex-border-color, #e1e3e6);
  box-sizing: border-box;
}

.codex-conversation-pane__title {
  margin: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  line-height: 32px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-conversation-pane__error {
  margin: 0 20px 8px;
  color: var(--codex-danger-color, #b3261e);
  font-size: 13px;
}

.codex-conversation-pane__footer {
  flex: 0 0 auto;
  width: min(100%, var(--codex-composer-content-width, 900px));
  margin: 0 auto;
  padding: 12px 16px 20px;
  box-sizing: border-box;
}
</style>
