<template>
  <div class="codex-chat-theme chat-composer-drawer"><slot /></div>
</template>
<style scoped>
.chat-composer-drawer {
  width: 100%;
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--color-border);
  border-bottom: 0;
  border-top-left-radius: var(--radius-xl);
  border-top-right-radius: var(--radius-xl);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-sm);
}
.chat-composer-drawer:not(:first-child) {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
</style>
