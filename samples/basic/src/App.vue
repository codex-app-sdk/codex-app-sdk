<template>
  <main class="app-shell">
    <ConversationSidebar
      :active-conversation-id="state.activeConversationId"
      :conversations="state.conversations"
      :disabled="working"
      :loading="state.status === 'connecting'"
      @create="run(createConversation)"
      @select="run(() => selectConversation($event))"
    />
    <CodexConversationPane
      v-model="draft"
      :approvals="state.approvals"
      :approval-preset="state.approvalPreset"
      :backend-capabilities="backendCapabilities"
      :busy="state.busy"
      :context-usage="state.contextUsage"
      :commands="commands"
      :disabled="state.status !== 'ready'"
      :error="visibleError"
      :menu-items="composerMenuItems"
      :messages="state.messages"
      :model-catalog-status="state.modelCatalogStatus"
      :models="models"
      :plan-mode="state.planMode"
      :queued-prompts="state.queuedPrompts"
      :goal="state.goal"
      :selected-model-id="state.selectedModelId"
      :selected-reasoning-effort="state.selectedReasoningEffort"
      :skill-catalog-status="state.skillCatalogStatus"
      :skills="state.skills"
      :title="activeConversation?.title || 'New conversation'"
      :turn-git-diff="state.turnGitDiff"
      autofocus
      @clear-goal="run(clearGoal)"
      @client-response="run(() => respondToClientRequest($event))"
      @delete-message="run(() => deleteMessage($event))"
      @delete-queued-prompt="run(() => deleteQueuedPrompt($event))"
      @edit-message="run(() => editMessage($event.index, $event.content))"
      @interrupt="run(interrupt)"
      @menu-select="handleMenuAction"
      @resolve-approval="(id, decision, scope) => run(() => resolveApproval(id, decision, scope))"
      @retry-message="run(() => retryMessage($event))"
      @select-approval-preset="run(() => updateConversationSettings({ approvalPreset: $event }))"
      @steer="run(() => steerMessage($event))"
      @steer-queued-prompt="run(() => steerQueuedPrompt($event))"
      @submit="run(() => sendMessage($event))"
      @update:model-id="run(() => updateConversationSettings({ modelId: $event }))"
      @update:plan-mode="run(() => updateConversationSettings({ planMode: $event }))"
      @update:reasoning-effort="run(() => updateConversationSettings({ reasoningEffort: $event }))"
    >
      <template #empty>
        <div class="welcome">
          <div class="welcome__mark" aria-hidden="true">⌁</div>
          <h2>What should we build?</h2>
          <p>This sample is read-only by default. Change the surface options in Electron main to grant workspace access.</p>
        </div>
      </template>
    </CodexConversationPane>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  type BackendModelOption,
  CodexConversationPane,
  type CodexComposerMenuSelectableItem,
  defaultBackendCapabilities,
  defaultBackendCommands,
  useCodexSurface,
} from 'codex-app-sdk/vue';
import ConversationSidebar from './components/ConversationSidebar.vue';

const draft = ref('');
const working = ref(false);
const actionError = ref<string | null>(null);
const {
  state,
  clearGoal,
  connect,
  createConversation,
  deleteMessage,
  deleteQueuedPrompt,
  editMessage,
  interrupt,
  refreshConversations,
  respondToClientRequest,
  resolveApproval,
  retryMessage,
  selectConversation,
  sendMessage,
  steerMessage,
  steerQueuedPrompt,
  updateConversationSettings,
} = useCodexSurface(window.codexSurface);

const activeConversation = computed(() => state.conversations.find(
  (conversation) => conversation.id === state.activeConversationId,
));
const visibleError = computed(() => actionError.value ?? state.error);
const backendCapabilities = computed(() => ({
  ...defaultBackendCapabilities('codex'),
  approvalPresets: [...state.approvalPresets],
}));
const commands = defaultBackendCommands('codex');
const models = computed<BackendModelOption[]>(() => state.models.map((model) => ({
  ...model,
  supportedReasoningEfforts: model.supportedReasoningEfforts
    ? model.supportedReasoningEfforts.map((option) => ({ ...option }))
    : undefined,
})));
const composerMenuItems = [{
  id: 'refresh-conversations',
  type: 'custom' as const,
  label: 'Refresh conversations',
  description: 'Sample-provided SDK action',
}];

onMounted(() => void run(connect));

async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
  working.value = true;
  actionError.value = null;
  try {
    return await action();
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : String(error);
    return undefined;
  } finally {
    working.value = false;
  }
}

function handleMenuAction(item: CodexComposerMenuSelectableItem): void {
  if (item.id === 'refresh-conversations') void run(refreshConversations);
}
</script>
