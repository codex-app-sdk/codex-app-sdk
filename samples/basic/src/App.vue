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
      :busy="state.busy"
      :approvals="state.approvals"
      :disabled="state.status !== 'ready'"
      :error="visibleError"
      :menu-items="composerMenuItems"
      :messages="state.messages"
      :title="activeConversation?.title || 'New conversation'"
      autofocus
      @interrupt="run(interrupt)"
      @menu-select="handleMenuAction"
      @resolve-approval="(id, decision, scope) => run(() => resolveApproval(id, decision, scope))"
      @submit="run(() => sendMessage($event))"
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
  CodexConversationPane,
  type CodexComposerMenuSelectableItem,
  useCodexSurface,
} from 'codex-app-sdk/vue';
import ConversationSidebar from './components/ConversationSidebar.vue';

const draft = ref('');
const working = ref(false);
const actionError = ref<string | null>(null);
const {
  state,
  connect,
  createConversation,
  interrupt,
  refreshConversations,
  resolveApproval,
  selectConversation,
  sendMessage,
} = useCodexSurface(window.codexSurface);

const activeConversation = computed(() => state.conversations.find(
  (conversation) => conversation.id === state.activeConversationId,
));
const visibleError = computed(() => actionError.value ?? state.error);
const composerMenuItems = [{
  id: 'refresh-conversations',
  type: 'custom' as const,
  label: 'Refresh conversations',
  description: 'Sample-provided SDK action',
}];

onMounted(async () => {
  const snapshot = await run(connect);
  const firstConversation = snapshot?.conversations[0];
  if (snapshot && !snapshot.activeConversationId && firstConversation) {
    await run(() => selectConversation(firstConversation.id));
  }
});

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
