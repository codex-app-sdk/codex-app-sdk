<script setup lang="ts">
import { computed, ref } from 'vue';
import { CodexConversationPane, useCodexSurface } from 'codex-app-sdk/vue';

const surface = useCodexSurface(window.codexSurface);
const localSignInError = ref<string | null>(null);
const requiresSignIn = computed(() => (
  surface.state.authentication.account === null
  && surface.state.authentication.requiresOpenaiAuth === true
));
const signInBusy = computed(() => (
  surface.state.authentication.login.status === 'starting'
  || surface.state.authentication.login.status === 'pending'
));
const signInError = computed(() => (
  localSignInError.value
  ?? surface.state.authentication.login.error
  ?? surface.state.authentication.error
));

async function signIn(): Promise<void> {
  localSignInError.value = null;
  let loginId: string | undefined;
  try {
    const login = await surface.startChatGptLogin();
    loginId = login.loginId;
    await window.codexAppSdkNative.openExternal(login.authUrl);
  } catch {
    if (loginId) await surface.cancelLogin(loginId).catch(() => undefined);
    localSignInError.value = 'Could not open Codex sign in. Please try again.';
  }
}
</script>

<template>
  <main class="app-shell">
    <aside class="sidebar" aria-label="Conversations">
      <header class="sidebar__header">
        <strong class="sidebar__brand">{{displayName}}</strong>
      </header>
      <div class="sidebar__actions">
        <button
          type="button"
          class="sidebar__new-chat"
          :disabled="surface.state.status !== 'ready'"
          @click="surface.createConversation()"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
          </svg>
          <span>New chat</span>
        </button>
      </div>

      <section class="sidebar__recents" aria-labelledby="recent-chats-heading">
        <h2 id="recent-chats-heading" class="sidebar__section-title">Recent chats</h2>
        <p v-if="surface.state.conversations.length === 0" class="sidebar__empty">
          {{ surface.state.status === 'connecting' ? 'Loading…' : 'No conversations yet' }}
        </p>
        <nav v-else class="sidebar__list" aria-label="Recent chats">
          <button
            v-for="conversation in surface.state.conversations"
            :key="conversation.id"
            type="button"
            class="sidebar__conversation"
            :class="{ 'sidebar__conversation--active': conversation.id === surface.state.activeConversationId }"
            :title="conversation.title || 'Untitled conversation'"
            @click="surface.selectConversation(conversation.id)"
          >
            <span>{{ conversation.title || 'Untitled conversation' }}</span>
          </button>
        </nav>
      </section>
    </aside>

    <section v-if="requiresSignIn" class="auth-landing">
      <div class="auth-landing__card">
        <span class="auth-landing__mark" aria-hidden="true">✦</span>
        <h1>Connect Codex</h1>
        <p>Sign in to start conversations and build with Codex in this app.</p>
        <button type="button" :disabled="signInBusy" @click="signIn">
          {{ signInBusy ? 'Waiting for sign in…' : 'Sign in with ChatGPT' }}
        </button>
        <p v-if="signInError" class="auth-landing__error" role="alert">{{ signInError }}</p>
      </div>
    </section>
    <CodexConversationPane v-else :surface="surface" autofocus />
  </main>
</template>
