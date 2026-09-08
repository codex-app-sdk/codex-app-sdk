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

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
withDefaults(defineProps<{
  ariaLabel?: string;
  items: readonly CodexComposerMenuItem<Payload>[];
}>(), {
  ariaLabel: 'Composer actions',
});

const emit = defineEmits<{
  select: [item: CodexComposerMenuSelectableItem<Payload>];
}>();
// Stryker restore all

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
  border: 1px solid var(--codex-border-color, var(--color-border, #dedede));
  border-radius: var(--codex-composer-menu-radius, 12px);
  color: var(--codex-text-color, var(--color-text, #0d0d0d));
  background: var(--codex-surface-color, var(--color-surface-lowest, #fff));
  box-shadow: var(--codex-composer-menu-shadow, var(--shadow-menu, 0 4px 6px rgb(0 0 0 / 8%), 0 2px 4px rgb(0 0 0 / 5%)));
  box-sizing: border-box;
  font-family: var(--codex-font-family, var(--font-family-base, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif));
  font-size: var(--codex-composer-menu-font-size, 13px);
  line-height: 18px;
}

.codex-composer-menu-list__item {
  display: flex;
  align-items: center;
  gap: var(--codex-space-3, 6px);
  width: 100%;
  min-height: var(--chat-menu-control-min-height, 26px);
  padding: 4px 8px;
  border: 0;
  border-radius: var(--codex-composer-menu-item-radius, 12px);
  color: inherit;
  background: transparent;
  font-family: inherit;
  font-size: var(--codex-composer-menu-item-font-size, var(--chat-menu-font-size, 14px));
  line-height: var(--chat-menu-line-height, 18px);
  text-align: left;
  cursor: pointer;
}

.codex-composer-menu-list__item:hover:not(:disabled),
.codex-composer-menu-list__item:focus-visible {
  background: var(--codex-hover-color, var(--color-surface-low, #f4f4f4));
  outline: none;
}

.codex-composer-menu-list__item:disabled {
  color: var(--codex-muted-text-color, var(--color-text-muted, #666));
  cursor: not-allowed;
  opacity: 0.58;
}

.codex-composer-menu-list__item--danger {
  color: var(--codex-danger-color, var(--color-error, #d5351f));
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
  color: var(--codex-muted-text-color, var(--color-text-muted, #666));
  font-size: var(--codex-composer-menu-description-font-size, var(--chat-menu-description-font-size, 12px));
}

.codex-composer-menu-list__value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-composer-menu-list__value-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.codex-composer-menu-list__value-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--codex-hover-color, var(--color-surface-low, #f4f4f4));
  font-size: 11px;
  font-weight: 600;
  line-height: 20px;
}

.codex-composer-menu-list__separator {
  height: 1px;
  margin: 4px 2px;
  background: var(--codex-border-color, var(--color-border, #dedede));
}

.codex-composer-menu-list__heading {
  display: flex;
  align-items: center;
  gap: var(--codex-space-2, 4px);
  padding: 6px 8px 4px;
  color: var(--codex-muted-text-color, var(--color-text-muted, #666));
  font-size: var(--codex-composer-menu-heading-font-size, 13px);
  line-height: 18px;
}

.codex-composer-menu-list__heading-label {
  min-width: 0;
  flex: 1 1 auto;
}

.codex-composer-menu-list__heading-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.codex-composer-menu-list__heading-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.codex-composer-menu-list__heading-action:hover:not(:disabled),
.codex-composer-menu-list__heading-action:focus-visible {
  color: var(--codex-text-color, var(--color-text, #0d0d0d));
  background: var(--codex-hover-color, var(--color-surface-low, #f4f4f4));
  outline: none;
}

.codex-composer-menu-list__heading-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.codex-composer-menu-list__heading-action > svg {
  width: 16px;
  height: 16px;
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

.codex-composer-menu-list__submenu-list--bottom-aligned {
  top: auto;
  bottom: 0;
}

.codex-composer-menu-list__submenu-list--wide {
  width: 360px;
  max-width: min(360px, calc(100vw - 24px));
}

.codex-composer-menu-list__switch {
  position: relative;
  width: 28px;
  height: 16px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--codex-border-color, var(--color-border-strong, #b0b0b0));
  transition: background-color 120ms ease;
}

.codex-composer-menu-list__switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--codex-surface-color, var(--color-surface-lowest, #fff));
  box-shadow: 0 1px 2px rgb(0 0 0 / 24%);
  transition: transform 120ms ease;
}

.codex-composer-menu-list__switch--checked {
  background: var(--codex-primary-color, var(--color-primary, #1b4fb2));
}

.codex-composer-menu-list__switch--checked .codex-composer-menu-list__switch-thumb {
  transform: translateX(12px);
}

.codex-composer-menu-list__color-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 50%;
}

.codex-composer-menu-list__submenu:not(.codex-composer-menu-list__submenu--open) > .codex-composer-menu-list__submenu-list {
  display: none;
}
</style>
