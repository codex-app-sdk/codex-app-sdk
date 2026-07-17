<template>
  <CodexComposerMenuItems
    :aria-label="ariaLabel"
    :items="items"
    @select="forwardSelection"
  >
    <template v-if="$slots.icon" #icon="scope"><slot name="icon" v-bind="scope" /></template>
    <template v-if="$slots.item" #item="scope"><slot name="item" v-bind="scope" /></template>
  </CodexComposerMenuItems>
</template>

<script setup lang="ts" generic="Payload = unknown">
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from '../composer-menu';
import CodexComposerMenuItems from './composer-menu-items';

withDefaults(defineProps<{
  ariaLabel?: string;
  items: readonly CodexComposerMenuItem<Payload>[];
}>(), {
  ariaLabel: 'Composer actions',
});

const emit = defineEmits<{
  select: [item: CodexComposerMenuSelectableItem<Payload>];
}>();

function forwardSelection(item: CodexComposerMenuSelectableItem<unknown>): void {
  emit('select', item as CodexComposerMenuSelectableItem<Payload>);
}
</script>

<style>
.codex-composer-menu-list {
  display: flex;
  flex-direction: column;
  min-width: var(--codex-composer-menu-width, 220px);
  padding: var(--codex-composer-menu-padding, 4px);
  border: 1px solid var(--codex-border-color, #d8dadd);
  border-radius: var(--codex-composer-menu-radius, 12px);
  color: var(--codex-text-color, #202124);
  background: var(--codex-surface-color, #fff);
  box-shadow: var(--codex-composer-menu-shadow, 0 12px 32px rgb(0 0 0 / 14%));
  box-sizing: border-box;
}

.codex-composer-menu-list__item {
  display: flex;
  align-items: center;
  gap: var(--codex-space-2, 8px);
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.codex-composer-menu-list__item:hover:not(:disabled),
.codex-composer-menu-list__item:focus-visible {
  background: var(--codex-hover-color, rgb(0 0 0 / 6%));
  outline: none;
}

.codex-composer-menu-list__item:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.codex-composer-menu-list__item--danger {
  color: var(--codex-danger-color, #b3261e);
}

.codex-composer-menu-list__icon,
.codex-composer-menu-list__chevron,
.codex-composer-menu-list__selection {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}

.codex-composer-menu-list__icon--empty {
  visibility: hidden;
}

.codex-composer-menu-list__copy {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.codex-composer-menu-list__label {
  font-weight: 500;
}

.codex-composer-menu-list__description,
.codex-composer-menu-list__value {
  color: var(--codex-muted-text-color, #777b82);
  font-size: 0.85em;
}

.codex-composer-menu-list__value {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-composer-menu-list__separator {
  height: 1px;
  margin: 4px;
  background: var(--codex-border-color, #d8dadd);
}

.codex-composer-menu-list__submenu {
  position: relative;
}

.codex-composer-menu-list__submenu-list {
  position: absolute;
  z-index: 2;
  top: 0;
  left: 100%;
}

.codex-composer-menu-list__submenu:not(.codex-composer-menu-list__submenu--open) > .codex-composer-menu-list__submenu-list {
  display: none;
}
</style>
