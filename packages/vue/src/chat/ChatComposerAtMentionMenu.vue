<template>
  <div class="codex-chat-theme chat-composer-at-menu" role="listbox" aria-label="Mentions">
    <template v-for="group in leadingMentionGroups" :key="`custom:${group.id}`">
      <div class="chat-composer-at-menu__section">{{ group.label }}</div>
      <button
        v-for="item in group.items"
        :key="`custom:${group.id}:${item.id}`"
        class="chat-composer-at-menu__item"
        :class="{ 'chat-composer-at-menu__item--active': mentionIndex(group.id, item.id) === activeIndex }"
        role="option"
        type="button"
        @mousedown.prevent="$emit('select-mention', item, group)"
      >
        <slot name="mention" :group="group" :item="item" :active="mentionIndex(group.id, item.id) === activeIndex">
          <SparklesIcon class="chat-composer-at-menu__icon" aria-hidden="true" />
          <span><strong>{{ item.label }}</strong><small v-if="item.description">{{ item.description }}</small></span>
        </slot>
      </button>
    </template>
    <template v-if="visiblePlugins.length">
      <div class="chat-composer-at-menu__section">Plugins</div>
      <button
        v-for="(plugin, index) in visiblePlugins"
        :key="`plugin:${plugin.id}`"
        class="chat-composer-at-menu__item"
        :class="{ 'chat-composer-at-menu__item--active': leadingMentionCount + index === activeIndex }"
        role="option"
        type="button"
        @mousedown.prevent="$emit('select-plugin', plugin)"
      >
        <PlugIcon class="chat-composer-at-menu__icon" aria-hidden="true" />
        <span><strong>{{ pluginDisplayName(plugin) }}</strong><small>{{ pluginDescription(plugin) }}</small></span>
      </button>
    </template>
    <template v-if="visibleFiles.length">
      <div class="chat-composer-at-menu__section">Files</div>
      <button
        v-for="(file, index) in visibleFiles"
        :key="`file:${file.path}`"
        class="chat-composer-at-menu__item"
        :class="{ 'chat-composer-at-menu__item--active': leadingMentionCount + visiblePlugins.length + index === activeIndex }"
        role="option"
        type="button"
        @mousedown.prevent="$emit('select-file', file)"
      >
        <FileTextIcon class="chat-composer-at-menu__icon" aria-hidden="true" />
        <span><strong>{{ file.name }}</strong><small>{{ file.path }}</small></span>
      </button>
    </template>
    <template v-for="group in trailingMentionGroups" :key="`custom:${group.id}`">
      <div class="chat-composer-at-menu__section">{{ group.label }}</div>
      <button
        v-for="item in group.items"
        :key="`custom:${group.id}:${item.id}`"
        class="chat-composer-at-menu__item"
        :class="{ 'chat-composer-at-menu__item--active': mentionIndex(group.id, item.id) === activeIndex }"
        role="option"
        type="button"
        @mousedown.prevent="$emit('select-mention', item, group)"
      >
        <slot name="mention" :group="group" :item="item" :active="mentionIndex(group.id, item.id) === activeIndex">
          <SparklesIcon class="chat-composer-at-menu__icon" aria-hidden="true" />
          <span><strong>{{ item.label }}</strong><small v-if="item.description">{{ item.description }}</small></span>
        </slot>
      </button>
    </template>
    <div v-if="showFileHint && !visibleFiles.length" class="chat-composer-at-menu__hint">Type to search files</div>
  </div>
</template>

<script setup lang="ts" generic="Payload = unknown">
import { computed } from 'vue';
import type { CodexFileSearchItem } from './contracts';
import type { CodexSurfacePlugin } from '@codex-app-sdk/core/surface';
import { FileTextIcon, PlugIcon, SparklesIcon } from '../icons/app-icons';
import { pluginDescription, pluginDisplayName } from './composer-plugins';
import type {
  CodexComposerMentionGroup,
  CodexComposerMentionItem,
  CodexComposerVisibleMentionGroup,
} from './composer-mentions-custom';

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  activeIndex: number;
  mentionGroups?: readonly CodexComposerVisibleMentionGroup<Payload>[];
  showFileHint: boolean;
  visibleFiles: CodexFileSearchItem[];
  visiblePlugins: CodexSurfacePlugin[];
}>();

defineEmits<{
  'select-file': [file: CodexFileSearchItem];
  'select-plugin': [plugin: CodexSurfacePlugin];
  'select-mention': [item: CodexComposerMentionItem<Payload>, group: CodexComposerMentionGroup<Payload>];
}>();

defineSlots<{
  mention(props: {
    active: boolean;
    group: CodexComposerVisibleMentionGroup<Payload>;
    item: CodexComposerMentionItem<Payload>;
  }): unknown;
}>();
// Stryker restore all

const leadingMentionGroups = computed(() => props.mentionGroups?.filter((group) => group.placement !== 'after') ?? []);
const trailingMentionGroups = computed(() => props.mentionGroups?.filter((group) => group.placement === 'after') ?? []);
const leadingMentionCount = computed(() => leadingMentionGroups.value.reduce((total, group) => total + group.items.length, 0));

function mentionIndex(groupId: string, itemId: string): number {
  let index = 0;
  for (const group of leadingMentionGroups.value) {
    for (const item of group.items) {
      if (group.id === groupId && item.id === itemId) return index;
      index += 1;
    }
  }
  index += props.visiblePlugins.length + props.visibleFiles.length;
  for (const group of trailingMentionGroups.value) {
    for (const item of group.items) {
      if (group.id === groupId && item.id === itemId) return index;
      index += 1;
    }
  }
  return -1;
}
</script>

<style scoped>
.chat-composer-at-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + var(--space-4));
  left: 0;
  z-index: 5;
  max-height: 280px;
  overflow-y: auto;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-lg);
}
.chat-composer-at-menu__section,
.chat-composer-at-menu__hint { padding: var(--space-2) var(--space-4); color: var(--color-text-muted); font-size: var(--font-size-12); }
.chat-composer-at-menu__section { font-weight: var(--font-weight-medium); text-transform: uppercase; }
.chat-composer-at-menu__item { display: flex; align-items: center; gap: var(--space-3); width: 100%; padding: var(--space-3) var(--space-4); border: 0; border-radius: var(--radius-lg); background: transparent; color: var(--color-text); text-align: left; }
.chat-composer-at-menu__item--active { background: var(--color-surface-low); }
.chat-composer-at-menu__icon { width: 18px; flex: 0 0 auto; }
.chat-composer-at-menu__item span { display: flex; min-width: 0; flex-direction: column; }
.chat-composer-at-menu__item small { overflow: hidden; color: var(--color-text-muted); text-overflow: ellipsis; white-space: nowrap; }
</style>
