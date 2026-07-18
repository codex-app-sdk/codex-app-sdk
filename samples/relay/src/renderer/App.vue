<template>
  <main v-if="startupError" class="relay-status" aria-labelledby="relay-error-title">
    <span class="relay-status__mark" aria-hidden="true">R</span>
    <h1 id="relay-error-title">Relay couldn’t start</h1>
    <p>{{ startupError }}</p>
    <button type="button" @click="start">Try again</button>
  </main>

  <main v-else-if="!authenticationReady || !operationsSnapshot" class="relay-status" aria-live="polite">
    <span class="relay-status__mark relay-status__mark--loading" aria-hidden="true">R</span>
    <h1>Opening the dispatch desk…</h1>
    <p>Loading the operations board and your Relay conversation.</p>
  </main>

  <RelaySignIn
    v-else-if="requiresSignIn"
    :busy="signInBusy"
    :error="signInError"
    @sign-in="signIn"
  />

  <main v-else-if="selectedShipment" class="relay-shell">
    <OperationsBoard
      :account-label="accountLabel"
      :action-pending="actionPending"
      :selected-shipment="selectedShipment"
      :snapshot="operationsSnapshot"
      @action="sendBusinessAction"
      @select="selectedShipmentId = $event"
      @sign-out="signOut"
    />

    <section class="relay-conversation" aria-label="Relay operations conversation">
      <div v-if="actionError" class="relay-action-error" role="alert">
        {{ actionError }}
        <button type="button" aria-label="Dismiss error" @click="actionError = null">×</button>
      </div>
      <CodexConversationPane
        class="relay-chat"
        :surface="surface"
        aria-label="Chat with Relay"
        empty-title="Your operations room is ready"
        empty-description="Select an exception action on the left, or ask about any shipment in the composer."
        placeholder="Ask about operations…"
        autofocus
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';
import type { RelayAction, RelayShipment, RelaySnapshot } from '../shared/relay-contracts';
import { buildRelayPrompt } from '../shared/relay-prompts';
import OperationsBoard from './components/OperationsBoard.vue';
import RelaySignIn from './components/RelaySignIn.vue';

const surface = useCodexSurface(window.codexSurface);
const operationsSnapshot = ref<RelaySnapshot | null>(null);
const selectedShipmentId = ref<string | null>(null);
const connectError = ref<string | null>(null);
const operationsError = ref<string | null>(null);
const localSignInError = ref<string | null>(null);
const actionError = ref<string | null>(null);
const openingSignIn = ref(false);
const signingOut = ref(false);
const actionPending = ref(false);
let creatingConversation: Promise<void> | null = null;
let removeEventListener: (() => void) | null = null;

const authenticationReady = computed(() => surface.state.authentication.status === 'loaded');
const requiresSignIn = computed(() => (
  surface.state.authentication.account === null
  && surface.state.authentication.requiresOpenaiAuth === true
));
const startupError = computed(() => connectError.value ?? (
  operationsSnapshot.value ? null : operationsError.value
));
const signInBusy = computed(() => (
  openingSignIn.value
  || surface.state.authentication.login.status === 'starting'
  || surface.state.authentication.login.status === 'pending'
));
const signInError = computed(() => (
  localSignInError.value
  ?? surface.state.authentication.login.error
  ?? surface.state.authentication.error
));
const selectedShipment = computed(() => {
  const shipments = operationsSnapshot.value?.shipments ?? [];
  return shipments.find((shipment) => shipment.id === selectedShipmentId.value)
    ?? shipments.find((shipment) => shipment.status === 'critical')
    ?? shipments[0]
    ?? null;
});
const accountLabel = computed(() => {
  const account = surface.state.authentication.account;
  if (account?.type === 'chatgpt') return account.email ?? 'ChatGPT account';
  if (account?.type === 'apiKey') return 'API key account';
  if (account?.type === 'amazonBedrock') return 'Amazon Bedrock';
  return undefined;
});

watch(
  () => [surface.state.status, authenticationReady.value, requiresSignIn.value] as const,
  ([status, authReady, signInRequired]) => {
    if (status === 'ready' && authReady && !signInRequired) void ensureConversation();
  },
);

onMounted(() => {
  removeEventListener = surface.onEvent((event) => {
    if (event.type === 'tool.completed') void refreshOperations();
  });
  void start();
});

onUnmounted(() => removeEventListener?.());

async function start(): Promise<void> {
  connectError.value = null;
  operationsError.value = null;
  await Promise.all([connectSurface(), refreshOperations()]);
}

async function connectSurface(): Promise<void> {
  try {
    await surface.connect();
  } catch {
    connectError.value = 'The Codex conversation surface is unavailable. Check the local Codex installation and try again.';
  }
}

async function refreshOperations(): Promise<void> {
  try {
    const snapshot = await window.relayOperations.getSnapshot();
    operationsSnapshot.value = snapshot;
    if (!selectedShipmentId.value) {
      selectedShipmentId.value = snapshot.shipments.find((shipment) => shipment.status === 'critical')?.id
        ?? snapshot.shipments[0]?.id
        ?? null;
    }
    operationsError.value = null;
  } catch {
    operationsError.value = 'The Relay operations store is unavailable. Check the sample data and try again.';
  }
}

async function ensureConversation(): Promise<void> {
  if (surface.state.activeConversationId || creatingConversation) return creatingConversation ?? Promise.resolve();
  creatingConversation = surface.createConversation().then(() => undefined).finally(() => {
    creatingConversation = null;
  });
  return creatingConversation;
}

async function sendBusinessAction(action: RelayAction, shipment: RelayShipment): Promise<void> {
  actionError.value = null;
  actionPending.value = true;
  try {
    await ensureConversation();
    await surface.sendMessage(buildRelayPrompt(action, shipment));
  } catch {
    actionError.value = `Relay could not send the ${shipment.id} action to the conversation. Please try again.`;
  } finally {
    actionPending.value = false;
  }
}

async function signIn(): Promise<void> {
  localSignInError.value = null;
  openingSignIn.value = true;
  let loginId: string | undefined;
  try {
    const login = await surface.startChatGptLogin();
    loginId = login.loginId;
    await window.codexAppSdkNative.openExternal(login.authUrl);
  } catch {
    if (loginId) await surface.cancelLogin(loginId).catch(() => undefined);
    localSignInError.value = 'Relay could not open ChatGPT sign in. Please try again.';
  } finally {
    openingSignIn.value = false;
  }
}

async function signOut(): Promise<void> {
  if (signingOut.value) return;
  signingOut.value = true;
  actionError.value = null;
  try {
    await surface.logout();
  } catch {
    actionError.value = 'Relay could not sign out. Please try again.';
  } finally {
    signingOut.value = false;
  }
}
</script>
