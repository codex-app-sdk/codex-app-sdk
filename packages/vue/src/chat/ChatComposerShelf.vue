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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CodexComposerShelfPresentation, ThreadGoal, TurnGitDiff } from './contracts';
import ChatGoal from './ChatGoal.vue';
import ChatQueuedPrompts from './ChatQueuedPrompts.vue';
import ChatTurnGitInfo from './ChatTurnGitInfo.vue';
import type { QueuedChatPrompt } from './queued-prompts';

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  goal: ThreadGoal | null;
  presentation?: CodexComposerShelfPresentation;
  queuedPrompts: readonly QueuedChatPrompt[];
  queuedPromptEditDisabled?: boolean;
  turnGitDiff?: TurnGitDiff | null;
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
const visible = computed(() => showGoal.value || showQueuedPrompts.value || Boolean(visibleTurnGitDiff.value));
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


</style>
