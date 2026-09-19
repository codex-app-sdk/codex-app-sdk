<template>
  <div v-if="visible" class="codex-chat-theme chat-composer-shelf">
    <ChatTurnGitInfo
      v-if="visibleTurnGitDiff"
      :diff="visibleTurnGitDiff"
    />
    <ChatQueuedPrompts
      v-if="showQueuedPrompts"
      :edit-disabled="queuedPromptEditDisabled"
      :prompts="queuedPrompts"
      @delete="$emit('deleteQueuedPrompt', $event)"
      @edit="$emit('editQueuedPrompt', $event)"
      @steer="$emit('steerQueuedPrompt', $event)"
    />
    <ChatGoal
      v-if="showGoal"
      :goal="goal"
      @clear="$emit('clearGoal')"
      @edit="$emit('editGoal')"
    />
    <div v-if="showActions" class="chat-composer-shelf__actions">
      <slot name="actions" :disabled="effectiveDisabled" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Comment, Fragment, Text, computed, type VNode } from 'vue';
import type { CodexComposerShelfPresentation, ThreadGoal, TurnGitDiff } from './contracts';
import ChatGoal from './ChatGoal.vue';
import ChatQueuedPrompts from './ChatQueuedPrompts.vue';
import ChatTurnGitInfo from './ChatTurnGitInfo.vue';
import type { QueuedChatPrompt } from './queued-prompts';

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  disabled?: boolean;
  goal: ThreadGoal | null;
  presentation?: CodexComposerShelfPresentation;
  queuedPrompts: readonly QueuedChatPrompt[];
  queuedPromptEditDisabled?: boolean;
  turnGitDiff?: TurnGitDiff | null;
}>();

const slots = defineSlots<{
  actions(props: { disabled: boolean }): unknown;
}>();

defineEmits<{
  clearGoal: [];
  deleteQueuedPrompt: [promptId: string];
  editQueuedPrompt: [promptId: string];
  editGoal: [];
  steerQueuedPrompt: [promptId: string];
}>();
// Stryker restore all

const showGoal = computed(() => (
  props.presentation?.goal !== false
  && Boolean(props.goal)
  && props.goal?.status !== 'complete'
));
const showQueuedPrompts = computed(() => (
  props.presentation?.queuedPrompts !== false && props.queuedPrompts.length > 0
));
const visibleTurnGitDiff = computed(() => (
  props.presentation?.turnGitDiff === false ? null : props.turnGitDiff ?? null
));
const effectiveDisabled = computed(() => props.disabled ?? false);
const showActions = computed(() => hasSlotContent(slots.actions?.({ disabled: effectiveDisabled.value })));
const visible = computed(() => (
  showGoal.value
  || showQueuedPrompts.value
  || Boolean(visibleTurnGitDiff.value)
  || showActions.value
));

function hasSlotContent(content: unknown): boolean {
  const nodes = Array.isArray(content) ? content : [content];
  return nodes.some((node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return false;
    if (typeof node === 'string' || typeof node === 'number') return String(node).trim().length > 0;
    if (typeof node !== 'object' || !('type' in node)) return true;
    const vnode = node as VNode;
    if (vnode.type === Comment) return false;
    if (vnode.type === Text) return String(vnode.children ?? '').trim().length > 0;
    if (vnode.type === Fragment) return hasSlotContent(vnode.children);
    return true;
  });
}
</script>

<style scoped>
.chat-composer-shelf {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.chat-composer-shelf:has(.chat-queued-prompts) {
  &:deep() {
    .chat-goal {
      border-top-left-radius: 0;
      border-top-right-radius: 0;
    }
  }
}

.chat-composer-shelf__actions {
  width: 100%;
  min-height: var(--space-16);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6);
  border: 0.5px solid var(--color-border);
  border-bottom: 0;
  background: var(--color-surface-lowest);
  color: var(--color-text-muted);
}

.chat-composer-shelf__actions:first-child {
  border-top-left-radius: var(--radius-xl);
  border-top-right-radius: var(--radius-xl);
}


</style>
