<template>
  <div ref="root" class="codex-composer-menu" @keydown.escape.prevent.stop="close(true)">
    <slot name="trigger" :open="menuOpen" :toggle="toggle">
      <button
        class="codex-composer-menu__trigger"
        type="button"
        :aria-label="buttonLabel"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        :disabled="disabled"
        @click="toggle"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
          <path d="M9 3.5v11M3.5 9h11" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8" />
        </svg>
      </button>
    </slot>
    <CodexComposerMenuList
      v-if="menuOpen"
      class="codex-composer-menu__list"
      :class="menuClass"
      :aria-label="ariaLabel"
      :items="items"
      @select="selectItem"
    >
      <template v-if="$slots.icon" #icon="scope"><slot name="icon" v-bind="scope" /></template>
      <template v-if="$slots.item" #item="scope"><slot name="item" v-bind="scope" /></template>
    </CodexComposerMenuList>
  </div>
</template>

<script setup lang="ts" generic="Payload = unknown">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from '../composer-menu';
import CodexComposerMenuList from './CodexComposerMenuList.vue';

const props = withDefaults(defineProps<{
  ariaLabel?: string;
  buttonLabel?: string;
  disabled?: boolean;
  items: readonly CodexComposerMenuItem<Payload>[];
  menuClass?: string;
  open?: boolean;
}>(), {
  ariaLabel: 'Composer actions',
  buttonLabel: 'Open composer actions',
  disabled: false,
  menuClass: undefined,
  open: undefined,
});

const emit = defineEmits<{
  select: [item: CodexComposerMenuSelectableItem<Payload>];
  'update:open': [open: boolean];
}>();

const root = ref<HTMLElement | null>(null);
const triggerElement = ref<HTMLElement | null>(null);
const internalOpen = ref(false);
const menuOpen = computed(() => props.open ?? internalOpen.value);

onMounted(() => document.addEventListener('click', closeOnOutsideClick));
onBeforeUnmount(() => document.removeEventListener('click', closeOnOutsideClick));

watch(menuOpen, async (open) => {
  if (!open) return;
  await nextTick();
  const firstItem = root.value?.querySelector(
    '.codex-composer-menu__list > button[role^="menuitem"], .codex-composer-menu__list > div > button[role^="menuitem"]',
  );
  if (firstItem instanceof HTMLElement) firstItem.focus();
}, { immediate: true });

function setOpen(open: boolean): void {
  if (props.open === undefined) {
    internalOpen.value = open;
  }
  emit('update:open', open);
}

function toggle(event?: Event): void {
  event?.stopPropagation();
  if (event?.currentTarget instanceof HTMLElement) triggerElement.value = event.currentTarget;
  if (!props.disabled) {
    setOpen(!menuOpen.value);
  }
}

function close(restoreFocus = false): void {
  if (menuOpen.value) {
    setOpen(false);
    if (restoreFocus) void nextTick(() => triggerElement.value?.focus());
  }
}

function closeOnOutsideClick(event: MouseEvent): void {
  if (root.value && event.target && !root.value.contains(event.target as Node)) {
    close(false);
  }
}

function selectItem(item: CodexComposerMenuSelectableItem<Payload>): void {
  emit('select', item);
  const shouldClose = item.closeOnSelect ?? (item.type !== 'checkbox');
  if (shouldClose) {
    close(true);
  }
}

defineExpose({ close, open: () => setOpen(true), toggle });
</script>

<style scoped>
.codex-composer-menu {
  position: relative;
  flex: 0 0 auto;
}

.codex-composer-menu__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--codex-composer-button-size, 36px);
  height: var(--codex-composer-button-size, 36px);
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: var(--codex-muted-text-color, #777b82);
  background: transparent;
  cursor: pointer;
}

.codex-composer-menu__trigger:hover:not(:disabled),
.codex-composer-menu__trigger:focus-visible {
  color: var(--codex-text-color, #202124);
  background: var(--codex-hover-color, rgb(0 0 0 / 6%));
  outline: none;
}

.codex-composer-menu__trigger:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.codex-composer-menu__list {
  position: absolute;
  z-index: 10;
  bottom: calc(100% + var(--codex-space-2, 8px));
  left: 0;
}
</style>
