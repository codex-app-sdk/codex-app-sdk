<template>
  <main v-if="showStartupError" class="spark-status" aria-labelledby="spark-error-title">
    <span class="spark-status__mascot" aria-hidden="true">★</span>
    <h1 id="spark-error-title">Spark couldn’t start</h1>
    <p>{{ startupError }}</p>
    <button type="button" @click="connectSurface">Try again</button>
  </main>

  <main v-else-if="!authenticationReady" class="spark-status" aria-live="polite">
    <span class="spark-status__mascot spark-status__mascot--loading" aria-hidden="true">★</span>
    <h1>Warming up Spark…</h1>
    <p>Getting your friendly helper ready.</p>
  </main>

  <SparkLanding
    v-else-if="requiresSignIn"
    :busy="signInBusy"
    :error="signInError"
    @sign-in="signIn"
  />

  <main v-else class="spark-shell">
    <SparkSidebar
      :active-conversation-id="surface.state.activeConversationId"
      :conversations="surface.state.conversations"
      :create-disabled="surface.state.status !== 'ready'"
      :loading="surface.state.status === 'connecting'"
      :account-label="accountLabel"
      :logout-busy="signingOut"
      :account-error="accountMenuError"
      @create="surface.createConversation()"
      @logout="signOut"
      @select="surface.selectConversation($event)"
    />

    <section class="spark-conversation" aria-label="Spark conversation">
      <header class="spark-conversation__header">
        <span class="spark-conversation__avatar" aria-hidden="true">★</span>
        <div>
          <h1>{{ activeTitle }}</h1>
          <p>Your friendly idea helper</p>
        </div>
      </header>

      <CodexConversationPane
        class="spark-chat"
        :surface="surface"
        :capabilities="sparkCapabilities"
        :attach-enabled="false"
        :commands="[]"
        :presentation="sparkPresentation"
        :can-delete-message="false"
        :can-edit-message="false"
        :can-retry-message="false"
        aria-label="Chat with Spark"
        empty-title="What are you curious about?"
        empty-description="Ask a question, dream up a story, or learn something surprising."
        placeholder="Ask Spark anything…"
        autofocus
      >
        <template #empty>
          <div class="spark-empty">
            <span class="spark-empty__mascot" aria-hidden="true">★</span>
            <h2>Hi! I’m Spark.</h2>
            <p>What should we wonder about today?</p>
            <div class="spark-prompts" aria-label="Try asking">
              <button
                v-for="suggestion in suggestions"
                :key="suggestion.prompt"
                type="button"
                @click="sendSuggestion(suggestion.prompt)"
              >
                <span aria-hidden="true">{{ suggestion.icon }}</span>
                {{ suggestion.label }}
              </button>
            </div>
          </div>
        </template>
      </CodexConversationPane>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  CodexConversationPane,
  useCodexSurface,
  type CodexConversationPresentation,
} from 'codex-app-sdk/vue';
import SparkLanding from './components/SparkLanding.vue';
import SparkSidebar from './components/SparkSidebar.vue';
import { sparkCapabilities } from './spark-capabilities';

const surface = useCodexSurface(window.codexSurface);
const connectError = ref<string | null>(null);
const openingSignIn = ref(false);
const localSignInError = ref<string | null>(null);
const signingOut = ref(false);
const accountMenuError = ref<string | null>(null);
const authenticationReady = computed(() => surface.state.authentication.status === 'loaded');
const requiresSignIn = computed(() => (
  surface.state.authentication.account === null
  && surface.state.authentication.requiresOpenaiAuth === true
));
const startupError = computed(() => connectError.value ?? surface.state.authentication.error);
const showStartupError = computed(() => Boolean(startupError.value));
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
const activeTitle = computed(() => surface.state.conversations.find(
  (conversation) => conversation.id === surface.state.activeConversationId,
)?.title ?? 'A new chat');
const accountLabel = computed(() => {
  const account = surface.state.authentication.account;
  if (account?.type === 'chatgpt') return 'ChatGPT account';
  if (account?.type === 'apiKey') return 'API key account';
  if (account?.type === 'amazonBedrock') return 'Amazon Bedrock';
  return 'Signed in';
});
const sparkPresentation: CodexConversationPresentation = {
  composer: { actionMenu: false, contextUsage: false, voice: false },
  messages: {
    actions: { copy: false, delete: false, edit: false, quote: false, retry: false },
    toolBlocks: false,
  },
  shelf: { goal: false, queuedPrompts: false, turnGitDiff: false },
};
const suggestions = [
  { icon: '🐉', label: 'Invent a funny creature', prompt: 'Help me invent a funny creature.' },
  { icon: '🪐', label: 'Explore space', prompt: 'Tell me something amazing about space.' },
  { icon: '🐬', label: 'Take an ocean quiz', prompt: 'Quiz me about the ocean.' },
] as const;

onMounted(() => { void connectSurface(); });

async function connectSurface(): Promise<void> {
  connectError.value = null;
  try {
    await surface.connect();
  } catch {
    connectError.value = 'We could not get Spark ready. Please check your connection and try again.';
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
    localSignInError.value = 'We could not open sign in. Please ask a grown-up to try again.';
  } finally {
    openingSignIn.value = false;
  }
}

async function signOut(): Promise<void> {
  accountMenuError.value = null;
  signingOut.value = true;
  try {
    await surface.logout();
    localSignInError.value = null;
  } catch {
    accountMenuError.value = 'We could not sign out. Please try again.';
  } finally {
    signingOut.value = false;
  }
}

async function sendSuggestion(prompt: string): Promise<void> {
  if (!surface.state.activeConversationId) {
    await surface.createConversation();
  }
  await surface.sendMessage(prompt);
}
</script>
