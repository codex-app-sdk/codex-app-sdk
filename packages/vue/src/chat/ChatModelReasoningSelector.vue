<template>
  <div class="codex-chat-theme chat-model-selector">
    <button
      v-if="models.length === 0"
      class="chat-model-selector__button"
      type="button"
      aria-label="Model and reasoning"
      :title="selectorLabel"
      disabled
    >
      <BrainIcon class="chat-model-selector__compact-icon" aria-hidden="true" />
      <span class="chat-model-selector__label">{{ selectorLabel }}</span>
      <ChevronDown class="chat-model-selector__chevron" aria-hidden="true" />
    </button>
    <CodexComposerMenu
      v-else
      aria-label="Model and reasoning"
      button-label="Model and reasoning"
      :disabled="controlDisabled"
      :items="selectorItems"
      menu-class="chat-model-selector__menu"
      @select="onSelect"
    >
      <template #trigger="{ open, toggle }">
        <button
          class="chat-model-selector__button"
          type="button"
          aria-label="Model and reasoning"
          :title="selectorLabel"
          aria-haspopup="menu"
          :aria-expanded="open"
          :disabled="controlDisabled"
          @click="toggle"
        >
          <BrainIcon class="chat-model-selector__compact-icon" aria-hidden="true" />
          <BoltIcon
            v-if="selectedModel && fastServiceTier && props.serviceTier === fastServiceTier.id"
            class="chat-model-selector__leading-icon"
            aria-hidden="true"
          />
          <span class="chat-model-selector__label">{{ selectorLabel }}</span>
          <ChevronDown class="chat-model-selector__chevron" aria-hidden="true" />
        </button>
      </template>
    </CodexComposerMenu>
  </div>
</template>

<script setup lang="ts" generic="Payload = unknown">
import { computed } from 'vue';
import type { CodexModelOption, ReasoningEffort } from './contracts';
import { BoltIcon, BrainIcon, ChevronDown } from '../icons/app-icons';
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from '../composer-menu';
import CodexComposerMenu from '../components/CodexComposerMenu.vue';

type SelectorCommand<Payload> =
  | { source: 'selector'; kind: 'model'; value: string; reasoningEffort?: ReasoningEffort }
  | { source: 'selector'; kind: 'serviceTier'; value: string }
  | { source: 'host'; item: CodexComposerMenuSelectableItem<Payload> };

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  disabled?: boolean;
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  modelId?: string | null;
  menuItems?: readonly CodexComposerMenuItem<Payload>[];
  models?: readonly CodexModelOption[];
  reasoningEffort?: ReasoningEffort | null;
  serviceTier?: string | null;
  showServiceTier?: boolean;
  showReasoning?: boolean;
}>(), {
  disabled: false,
  modelCatalogStatus: 'notLoaded',
  modelId: null,
  models: () => [],
  menuItems: () => [],
  reasoningEffort: null,
  serviceTier: null,
  showServiceTier: true,
  showReasoning: true,
});

const emit = defineEmits<{
  'update:modelId': [modelId: string];
  menuSelect: [item: CodexComposerMenuSelectableItem<Payload>];
  'update:reasoningEffort': [reasoningEffort: ReasoningEffort];
  'update:serviceTier': [serviceTier: string | null];
}>();
// Stryker restore all

const selectedModel = computed(() => (
  props.models.find((model) => model.id === props.modelId) ??
  props.models.find((model) => model.isDefault) ??
  props.models[0] ??
  null
));

const reasoningEfforts = computed(() => selectedModel.value?.supportedReasoningEfforts ?? []);

const showReasoning = computed(() => props.showReasoning && reasoningEfforts.value.length > 0);

const effectiveReasoningEffort = computed(() => (
  props.reasoningEffort ??
  selectedModel.value?.defaultReasoningEffort ??
  reasoningEfforts.value[0]?.reasoningEffort ??
  null
));

const serviceTiers = computed(() => selectedModel.value?.serviceTiers ?? []);
const showServiceTier = computed(() => props.showServiceTier && serviceTiers.value.length > 0);
const fastServiceTier = computed(() => serviceTiers.value.find((tier) => (
  /^(fast|priority)$/i.test(tier.id) || /fast|priority/i.test(tier.name)
)) ?? null);

const controlDisabled = computed(() => props.disabled);

const selectorItems = computed<CodexComposerMenuItem<SelectorCommand<Payload>>[]>(() => {
  const items: CodexComposerMenuItem<SelectorCommand<Payload>>[] = [];
  if (props.menuItems.length > 0) {
    items.push(...wrapHostMenuItems(props.menuItems));
    items.push({ id: 'host-model-menu-separator', type: 'separator' });
  }
  for (const model of props.models) {
    const selected = model.id === selectedModel.value?.id;
    const efforts = model.supportedReasoningEfforts ?? [];
    if (!props.showReasoning || efforts.length === 0) {
      items.push({
        checked: selected,
        closeOnSelect: true,
        id: `model:${model.id}`,
        label: model.displayName,
        payload: { source: 'selector', kind: 'model', value: model.id },
        type: 'radio',
      });
      continue;
    }
    items.push({
      id: `model:${model.id}`,
      label: model.displayName,
      type: 'submenu',
      selectAction: {
        id: `select-model:${model.id}`,
        label: model.displayName,
        type: 'action',
        payload: {
          source: 'selector', kind: 'model', value: model.id,
          reasoningEffort: [effectiveReasoningEffort.value, 'high', model.defaultReasoningEffort]
            .find((candidate) => efforts.some((effort) => effort.reasoningEffort === candidate))
            ?? efforts[0]!.reasoningEffort,
        },
      },
      value: selected && effectiveReasoningEffort.value ? effortLabel(effectiveReasoningEffort.value) : undefined,
      submenuAlignment: 'bottom',
      items: efforts.map((effort) => ({
        checked: selected && effort.reasoningEffort === effectiveReasoningEffort.value,
        closeOnSelect: true,
        id: `model:${model.id}:reasoning:${effort.reasoningEffort}`,
        label: effortLabel(effort.reasoningEffort),
        payload: { source: 'selector' as const, kind: 'model' as const, value: model.id, reasoningEffort: effort.reasoningEffort },
        type: 'radio' as const,
      })),
    });
  }

  if (showServiceTier.value && fastServiceTier.value) {
    items.push({ id: 'model-service-tier-separator', type: 'separator' });
    items.push({ id: 'service-tier-heading', type: 'heading', label: 'Speed' });
    items.push({
      accessory: 'switch',
      checked: props.serviceTier === fastServiceTier.value.id,
      closeOnSelect: false,
      description: fastServiceTier.value.description,
      id: `service-tier:${fastServiceTier.value.id}`,
      label: 'Fast mode',
      payload: { source: 'selector' as const, kind: 'serviceTier' as const, value: fastServiceTier.value.id },
      type: 'checkbox' as const,
    });
  }

  return items;
});

const selectorLabel = computed(() => {
  if (!selectedModel.value) {
    return modelFallbackLabel.value;
  }

  if (!showReasoning.value) {
    return compactModelLabel(selectedModel.value.displayName);
  }

  const effort = effectiveReasoningEffort.value ? effortLabel(effectiveReasoningEffort.value) : effortFallbackLabel.value;
  return `${compactModelLabel(selectedModel.value.displayName)} ${effort}`;
});

const modelFallbackLabel = computed(() => {
  if (props.modelCatalogStatus === 'loading') {
    return 'Loading models';
  }

  if (props.modelCatalogStatus === 'error') {
    return 'Models unavailable';
  }

  return 'Model';
});

const effortFallbackLabel = computed(() => {
  if (props.modelCatalogStatus === 'loading') {
    return 'Loading';
  }

  return 'Reasoning';
});

function effortLabel(effort: ReasoningEffort): string {
  const labels: Record<string, string> = {
    xhigh: 'Extra High',
  };
  const normalized = effort.trim().toLowerCase();
  if (labels[normalized]) {
    return labels[normalized];
  }

  return effort
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function compactModelLabel(modelLabel: string): string {
  return modelLabel.replace(/^gpt[-\s]*/i, '').trim() || modelLabel;
}

function onSelect(item: CodexComposerMenuSelectableItem<SelectorCommand<Payload>>): void {
  const command = item.payload;
  if (!command) {
    return;
  }

  if (command.source === 'host') {
    emit('menuSelect', command.item);
  } else if (command.kind === 'model') {
    if (props.modelId !== command.value) emit('update:modelId', command.value);
    if (props.showReasoning && command.reasoningEffort !== undefined) emit('update:reasoningEffort', command.reasoningEffort);
  } else if (command.kind === 'serviceTier' && fastServiceTier.value) {
    emit('update:serviceTier', props.serviceTier === fastServiceTier.value.id ? null : command.value);
  }
}

function wrapHostMenuItems(
  items: readonly CodexComposerMenuItem<Payload>[],
  parentPath: readonly number[] = [],
): CodexComposerMenuItem<SelectorCommand<Payload>>[] {
  return items.map((item, index) => {
    const path = [...parentPath, index];
    const id = `host:${path.join('.')}:${item.id}`;
    if (item.type === 'separator') return { ...item, id };
    if (item.type === 'heading') {
      return {
        ...item,
        id,
        actions: item.actions?.map((action, actionIndex) => ({
          ...action,
          id: `${id}:action:${actionIndex}:${action.id}`,
          payload: { source: 'host', item: action },
        })),
      };
    }
    if (item.type === 'submenu') {
      const { items: childItems, payload: _payload, selectAction, ...submenu } = item;
      return {
        ...submenu, id, items: wrapHostMenuItems(childItems, path),
        selectAction: selectAction ? {
          ...selectAction, id: `${id}:select`, payload: { source: 'host', item: selectAction },
        } : undefined,
      };
    }
    return {
      ...item,
      id,
      payload: { source: 'host', item },
    };
  });
}
</script>

<style scoped>
.chat-model-selector {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.chat-model-selector__button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 184px;
  min-height: var(--chat-composer-button-size, 36px);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
  background: transparent;
  font-family: var(--font-family-base);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
  cursor: pointer;
}

.chat-model-selector__button:hover:not(:disabled),
.chat-model-selector__button[aria-expanded="true"] {
  color: var(--color-text);
  background: var(--color-surface-base);
}

.chat-model-selector__button:disabled {
  cursor: default;
}

.chat-model-selector__label,
.chat-model-selector__option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-model-selector__leading-icon,
.chat-model-selector__chevron {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.chat-model-selector__compact-icon {
  display: none;
  width: 20px;
  height: 20px;
  stroke-width: 1.8;
}

:deep(.chat-model-selector__menu) {
  right: 0;
  left: auto;
  min-width: 220px;
  max-width: 260px;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-menu);
  color: var(--color-text);
}

:deep(.chat-model-selector__menu .codex-composer-menu-list__icon--empty) {
  display: none;
}

:deep(.chat-model-selector__menu [data-submenu-id^="model:"] > .codex-composer-menu-list__submenu-list) {
  width: 160px;
}

:deep(.chat-model-selector__menu [role="menuitemradio"][aria-checked="true"]) {
  background: var(--color-surface-low);
}

:deep(.chat-model-selector__menu [data-submenu-id^="model:"]:has([role="menuitemradio"][aria-checked="true"]) > button) {
  background: var(--color-surface-low);
}

:deep(.chat-model-selector__menu [role="menuitemradio"] .codex-composer-menu-list__radio-check),
:deep(.chat-model-selector__menu [role="menuitemradio"] .codex-composer-menu-list__selection) {
  display: none;
}

:deep(.chat-model-selector__menu .codex-composer-menu-list__submenu-list .codex-composer-menu-list__item) {
  font-size: var(--codex-composer-model-submenu-font-size, var(--codex-composer-menu-item-font-size, var(--chat-menu-font-size, 13.5px)));
}

:deep(.chat-model-selector__menu .codex-composer-menu-list__heading) {
  padding-left: var(--space-4);
}

@media (max-width: 720px) {
  .chat-model-selector__label,
  .chat-model-selector__leading-icon,
  .chat-model-selector__chevron {
    display: none;
  }

  .chat-model-selector__button {
    justify-content: center;
    width: var(--chat-composer-compact-control-size, var(--chat-composer-button-size-small, 28px));
    min-height: var(--chat-composer-compact-control-size, var(--chat-composer-button-size-small, 28px));
    padding: 0;
  }

  .chat-model-selector__compact-icon {
    display: block;
  }
}
</style>
