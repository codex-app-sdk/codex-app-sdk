<template>
  <CodexComposerMenu
    v-if="menuItems.length > 0"
    class="chat-composer-action-menu__root"
    menu-class="chat-composer-action-menu"
    aria-label="Composer actions"
    button-label="Composer actions"
    :disabled="disabled"
    :items="menuItems"
    @select="selectMenuItem"
  >
    <template #trigger="{ open, toggle }">
      <button
        class="chat-composer-action-menu__button"
        type="button"
        aria-label="Composer actions"
        aria-haspopup="menu"
        :aria-expanded="open"
        :disabled="disabled"
        @click="toggle"
      >
        <PlusIcon />
      </button>
    </template>
    <template v-if="$slots.icon" #icon="scope"><slot name="icon" v-bind="scope" /></template>
    <template v-if="$slots.item" #item="scope"><slot name="item" v-bind="scope" /></template>
  </CodexComposerMenu>
</template>

<script setup lang="ts" generic="Payload = unknown">
import { computed, type Component } from 'vue';
import type { ApprovalPreset } from './contracts';
import { approvalPresetOptions } from './approval-presets';
import CodexComposerMenu from '../components/CodexComposerMenu.vue';
import type {
  CodexComposerMenuItem,
  CodexComposerMenuSelectableItem,
} from '../composer-menu';
import { HandStopIcon, ListDetailsIcon, PaperclipIcon, PlusIcon, ShieldCheckIcon, Sparkles } from '../icons/app-icons';

type ComposerMenuAction =
  | { kind: 'approval'; preset: ApprovalPreset }
  | { kind: 'attach' }
  | { kind: 'plan-mode' };

const props = withDefaults(defineProps<{
  attachEnabled?: boolean;
  disabled?: boolean;
  items?: readonly CodexComposerMenuItem<Payload>[];
  approvalPreset?: ApprovalPreset | null;
  approvalPresets?: readonly ApprovalPreset[];
  planMode: boolean;
  showApprovalMenu?: boolean;
  showPlanMode?: boolean;
}>(), {
  attachEnabled: false,
  disabled: false,
  items: () => [],
  approvalPreset: null,
  approvalPresets: () => [],
  planMode: false,
  showApprovalMenu: false,
  showPlanMode: true,
});

const emit = defineEmits<{
  attach: [];
  select: [item: CodexComposerMenuSelectableItem<Payload>];
  selectApprovalPreset: [preset: ApprovalPreset];
  'update:planMode': [enabled: boolean];
}>();

const allowedApprovalPresets = computed(() => new Set(props.approvalPresets));
const menuItems = computed<CodexComposerMenuItem<ComposerMenuAction | Payload>[]>(() => {
  const items: CodexComposerMenuItem<ComposerMenuAction | Payload>[] = [];

  if (props.showApprovalMenu) {
    items.push({
      id: 'approval',
      type: 'submenu',
      label: 'Approval',
      icon: ShieldCheckIcon,
      items: approvalPresetOptions.map((option) => ({
        id: `approval:${option.id}`,
        type: 'radio',
        label: option.label,
        description: option.description,
        icon: approvalIcon(option.id),
        checked: option.id === props.approvalPreset,
        disabled: !allowedApprovalPresets.value.has(option.id),
        payload: { kind: 'approval', preset: option.id },
      })),
    });
  }

  if (props.showPlanMode) {
    items.push({
      id: 'plan-mode',
      type: 'checkbox',
      label: 'Plan mode',
      accessory: 'switch',
      checked: props.planMode,
      icon: ListDetailsIcon,
      payload: { kind: 'plan-mode' },
    });
  }

  items.push(...props.items);

  if (props.attachEnabled) {
    if (items.length > 0 && items.at(-1)?.type !== 'separator') {
      items.push({ id: 'group-attach', type: 'separator' });
    }
    items.push({
      id: 'attach',
      type: 'action',
      label: 'Add Files & Photos',
      icon: PaperclipIcon,
      payload: { kind: 'attach' },
    });
  }

  return items;
});

function approvalIcon(preset: ApprovalPreset): Component {
  if (preset === 'ask-for-approval') {
    return HandStopIcon;
  }
  if (preset === 'approve-for-me') {
    return Sparkles;
  }
  return ShieldCheckIcon;
}

function selectMenuItem(item: CodexComposerMenuSelectableItem<ComposerMenuAction | Payload>): void {
  const action = item.payload;
  if (item.id === 'plan-mode') {
    emit('update:planMode', !props.planMode);
    return;
  }
  if (item.id.startsWith('approval:') && isComposerMenuAction(action) && action.kind === 'approval') {
    emit('selectApprovalPreset', action.preset);
    return;
  }
  if (item.id === 'attach') {
    emit('attach');
    return;
  }

  emit('select', item as CodexComposerMenuSelectableItem<Payload>);
}

function isComposerMenuAction(value: unknown): value is ComposerMenuAction {
  return typeof value === 'object' && value !== null && 'kind' in value;
}
</script>

<style scoped>
.chat-composer-action-menu__root {
  --codex-border-color: var(--color-border);
  --codex-composer-menu-radius: var(--radius-xl);
  --codex-composer-menu-shadow: var(--shadow-menu);
  --codex-hover-color: var(--color-surface-low);
  --codex-muted-text-color: var(--color-text-muted);
  --codex-surface-color: var(--color-surface-lowest);
  --codex-text-color: var(--color-text);
}

.chat-composer-action-menu__button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--chat-composer-action-size, 32px);
  height: var(--chat-composer-action-size, 32px);
  border: 0;
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.chat-composer-action-menu__button:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-surface-base);
}

.chat-composer-action-menu__button:disabled {
  cursor: default;
}

.chat-composer-action-menu__button svg {
  width: var(--icon-lg);
  height: var(--icon-lg);
  stroke-width: 1.5;
}

:deep(.chat-composer-action-menu .codex-composer-menu-list__submenu-list) {
  width: 360px;
  max-width: min(360px, calc(100vw - var(--space-12)));
}
</style>
