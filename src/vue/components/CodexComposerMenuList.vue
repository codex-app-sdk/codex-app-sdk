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
  width: var(--codex-composer-menu-width, 220px);
  padding: var(--codex-composer-menu-padding, 4px);
  border: 1px solid var(--codex-border-color, #dedede);
  border-radius: var(--codex-composer-menu-radius, 12px);
  color: var(--codex-text-color, #0d0d0d);
  background: var(--codex-surface-color, #fff);
  box-shadow: var(--codex-composer-menu-shadow, 0 4px 6px rgb(0 0 0 / 8%), 0 2px 4px rgb(0 0 0 / 5%));
  box-sizing: border-box;
  font-family: var(--codex-font-family, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: var(--codex-composer-menu-font-size, 13px);
  line-height: 18px;
}

.codex-composer-menu-list__item {
  display: flex;
  align-items: center;
  gap: var(--codex-space-3, 6px);
  width: 100%;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--codex-composer-menu-item-radius, 12px);
  color: inherit;
  background: transparent;
  font-family: inherit;
  font-size: var(--codex-composer-menu-item-font-size, 14px);
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}

.codex-composer-menu-list__item:hover:not(:disabled),
.codex-composer-menu-list__item:focus-visible {
  background: var(--codex-hover-color, #f4f4f4);
  outline: none;
}

.codex-composer-menu-list__item:disabled {
  color: var(--codex-muted-text-color, #666);
  cursor: not-allowed;
  opacity: 0.58;
}

.codex-composer-menu-list__item--danger {
  color: var(--codex-danger-color, #d5351f);
}

.codex-composer-menu-list__icon,
.codex-composer-menu-list__chevron,
.codex-composer-menu-list__selection {
  width: var(--codex-composer-menu-icon-size, 16px);
  height: var(--codex-composer-menu-icon-size, 16px);
  flex: 0 0 auto;
}

.codex-composer-menu-list__icon--empty {
  visibility: hidden;
}

.codex-composer-menu-list__copy {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
}

.codex-composer-menu-list__label {
  font-weight: 500;
}

.codex-composer-menu-list__description,
.codex-composer-menu-list__value {
  color: var(--codex-muted-text-color, #666);
  font-size: var(--codex-composer-menu-description-font-size, 12px);
}

.codex-composer-menu-list__value {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-composer-menu-list__separator {
  height: 1px;
  margin: 4px 2px;
  background: var(--codex-border-color, #dedede);
}

.codex-composer-menu-list__heading {
  padding: 6px 8px 4px;
  color: var(--codex-muted-text-color, #666);
  font-size: var(--codex-composer-menu-heading-font-size, 13px);
  line-height: 18px;
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
