<template>
  <div class="codex-chat-theme chat-model-selector">
    <button
      v-if="models.length === 0"
      class="chat-model-selector__button"
      type="button"
      aria-label="Model and reasoning"
      disabled
    >
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
          aria-haspopup="menu"
          :aria-expanded="open"
          :disabled="controlDisabled"
          @click="toggle"
        >
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

<script setup lang="ts">
import { computed } from 'vue';
import type { CodexModelOption, ReasoningEffort } from './contracts';
import { BoltIcon, ChevronDown } from '../icons/app-icons';
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from '../composer-menu';
import CodexComposerMenu from '../components/CodexComposerMenu.vue';

type SelectorCommand = {
  kind: 'model' | 'reasoning' | 'serviceTier';
  value: string;
};

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  disabled?: boolean;
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  modelId?: string | null;
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
  reasoningEffort: null,
  serviceTier: null,
  showServiceTier: true,
  showReasoning: true,
});

const emit = defineEmits<{
  'update:modelId': [modelId: string];
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

const selectorItems = computed<CodexComposerMenuItem<SelectorCommand>[]>(() => {
  const items: CodexComposerMenuItem<SelectorCommand>[] = [{
    id: 'model',
    label: 'Model',
    type: 'submenu',
    value: selectedModel.value ? compactModelLabel(selectedModel.value.displayName) : undefined,
    submenuAlignment: 'bottom',
    submenuWidth: 'wide',
    items: props.models.map((model) => ({
      checked: model.id === selectedModel.value?.id,
      closeOnSelect: true,
      id: `model:${model.id}`,
      label: model.displayName,
      payload: { kind: 'model' as const, value: model.id },
      type: 'radio' as const,
    })),
  }];

  if (showReasoning.value) {
    items.push({
      id: 'reasoning',
      label: 'Reasoning',
      type: 'submenu',
      value: effectiveReasoningEffort.value ? effortLabel(effectiveReasoningEffort.value) : undefined,
      submenuAlignment: 'bottom',
      submenuWidth: 'wide',
      items: reasoningEfforts.value.map((effort) => ({
        checked: effort.reasoningEffort === effectiveReasoningEffort.value,
        closeOnSelect: true,
        id: `reasoning:${effort.reasoningEffort}`,
        label: effortLabel(effort.reasoningEffort),
        payload: { kind: 'reasoning' as const, value: effort.reasoningEffort },
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
      payload: { kind: 'serviceTier' as const, value: fastServiceTier.value.id },
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

function onSelect(item: CodexComposerMenuSelectableItem<SelectorCommand>): void {
  const command = item.payload;
  if (!command) {
    return;
  }

  if (command.kind === 'model') {
    emit('update:modelId', command.value);
  } else if (command.kind === 'reasoning' && showReasoning.value) {
    emit('update:reasoningEffort', command.value);
  } else if (command.kind === 'serviceTier' && fastServiceTier.value) {
    emit('update:serviceTier', props.serviceTier === fastServiceTier.value.id ? null : command.value);
  }
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

:deep(.chat-model-selector__menu .codex-composer-menu-list__item) {
  gap: var(--space-3);
  min-height: var(--space-16);
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

:deep(.chat-model-selector__menu .codex-composer-menu-list__icon--empty) {
  display: none;
}

:deep(.chat-model-selector__menu .codex-composer-menu-list__item[aria-checked="true"] .codex-composer-menu-list__label) {
  font-weight: var(--font-weight-semibold);
}

@media (max-width: 720px) {
  .chat-model-selector {
    display: none;
  }
}
</style>
