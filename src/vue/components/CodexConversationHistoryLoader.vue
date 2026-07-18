<template>
  <div
    class="codex-chat-theme codex-conversation-history-loader"
    role="status"
    aria-live="polite"
    aria-label="Loading conversation"
  >
    <div class="codex-conversation-history-loader__inner">
      <div class="codex-conversation-history-loader__block codex-conversation-history-loader__block--user" />
      <div class="codex-conversation-history-loader__group">
        <div class="codex-conversation-history-loader__block codex-conversation-history-loader__block--wide" />
        <div class="codex-conversation-history-loader__block codex-conversation-history-loader__block--medium" />
        <div class="codex-conversation-history-loader__block codex-conversation-history-loader__block--short" />
      </div>
      <div class="codex-conversation-history-loader__group">
        <div class="codex-conversation-history-loader__block codex-conversation-history-loader__block--tool" />
        <div class="codex-conversation-history-loader__block codex-conversation-history-loader__block--wide" />
        <div class="codex-conversation-history-loader__block codex-conversation-history-loader__block--medium" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.codex-conversation-history-loader {
  --conversation-history-loader-shine: var(--color-shine, rgb(255 255 255 / 64%));
  display: grid;
  align-items: center;
  height: 100%;
  padding: var(--space-8) var(--space-32);
}

.codex-conversation-history-loader__inner {
  display: grid;
  gap: var(--space-8);
}

.codex-conversation-history-loader__group {
  display: grid;
  gap: var(--space-3);
  max-width: 560px;
}

.codex-conversation-history-loader__block {
  position: relative;
  overflow: hidden;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--color-surface-base);
}

.codex-conversation-history-loader__block::after {
  position: absolute;
  inset: 0;
  content: '';
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--conversation-history-loader-shine) 48%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: codex-conversation-history-loader-shine 1.35s ease-in-out infinite;
}

.codex-conversation-history-loader__block--user {
  justify-self: end;
  width: min(260px, 55%);
  height: 34px;
  border-radius: var(--radius-xl);
}

.codex-conversation-history-loader__block--wide {
  width: min(520px, 100%);
}

.codex-conversation-history-loader__block--medium {
  width: min(420px, 82%);
}

.codex-conversation-history-loader__block--short {
  width: min(280px, 58%);
}

.codex-conversation-history-loader__block--tool {
  width: min(340px, 72%);
  height: 28px;
  border-radius: var(--radius-lg);
}

@keyframes codex-conversation-history-loader-shine {
  to {
    transform: translateX(100%);
  }
}
</style>
