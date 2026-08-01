<template>
  <div
    ref="menuEl"
    class="codex-chat-theme chat-composer-plugin-menu"
    role="listbox"
    aria-label="Plugins"
  >
    <div class="chat-composer-plugin-menu__section">Plugins</div>
    <button
      v-for="(plugin, index) in visiblePlugins"
      :key="plugin.id"
      class="chat-composer-plugin-menu__item"
      :class="{ 'chat-composer-plugin-menu__item--active': index === activeIndex }"
      role="option"
      type="button"
      @mousedown.prevent="$emit('select', plugin)"
    >
      <img
        v-if="plugin.iconUrl"
        class="chat-composer-plugin-menu__icon chat-composer-plugin-menu__icon-image"
        :src="plugin.iconUrl"
        alt=""
        aria-hidden="true"
        referrerpolicy="no-referrer"
      >
      <PlugIcon v-else class="chat-composer-plugin-menu__icon" aria-hidden="true" />
      <span class="chat-composer-plugin-menu__main">
        <span class="chat-composer-plugin-menu__name">{{ pluginDisplayName(plugin) }}</span>
        <span class="chat-composer-plugin-menu__description">{{ pluginDescription(plugin) }}</span>
      </span>
    </button>
    <div v-if="visiblePlugins.length === 0" class="chat-composer-plugin-menu__empty">No matching plugins</div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { CodexSurfacePlugin } from '../../surface/types';
import { PlugIcon } from '../icons/app-icons';
import { pluginDescription, pluginDisplayName } from './composer-plugins';

const props = defineProps<{
  activeIndex: number;
  visiblePlugins: CodexSurfacePlugin[];
}>();

defineEmits<{
  select: [plugin: CodexSurfacePlugin];
}>();

const menuEl = ref<HTMLElement | null>(null);

watch(
  () => [props.activeIndex, props.visiblePlugins],
  async () => {
    await nextTick();
    const activeItem = menuEl.value?.querySelectorAll<HTMLButtonElement>('.chat-composer-plugin-menu__item')
      .item(props.activeIndex);
    if (typeof activeItem?.scrollIntoView === 'function') {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  },
);
</script>

<style scoped>
.chat-composer-plugin-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + var(--space-4));
  left: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-height: 280px;
  overflow-y: auto;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-lg);
}

.chat-composer-plugin-menu__section {
  padding: var(--space-3) var(--space-4) var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-medium);
  line-height: normal;
  text-transform: uppercase;
}

.chat-composer-plugin-menu__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border: 0;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font: inherit;
  line-height: 1.35;
  text-align: left;
}

.chat-composer-plugin-menu__item:hover,
.chat-composer-plugin-menu__item--active {
  background: var(--color-surface);
}

.chat-composer-plugin-menu__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 var(--icon-md);
  color: var(--color-text-muted);
}

.chat-composer-plugin-menu__icon-image {
  object-fit: contain;
}

.chat-composer-plugin-menu__main {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: var(--space-4);
}

.chat-composer-plugin-menu__name {
  overflow: hidden;
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.chat-composer-plugin-menu__description {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
}

.chat-composer-plugin-menu__empty {
  padding: var(--space-3) var(--space-4) var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--font-size-13);
}
</style>
