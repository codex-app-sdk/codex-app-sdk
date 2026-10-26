<template>
  <div class="codex-chat-theme chat-composer-drawer-row">
    <div v-if="$slots.leading" class="chat-composer-drawer-row__leading"><slot name="leading" /></div>
    <div class="chat-composer-drawer-row__text"><slot /></div>
    <div v-if="$slots.actions" class="chat-composer-drawer-row__actions"><slot name="actions" /></div>
  </div>
</template>
<script setup lang="ts">
defineSlots<{ default(): unknown; leading(): unknown; actions(): unknown }>();
</script>
<style scoped>
.chat-composer-drawer-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-6);
  border-bottom: 0.5px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-xlight);
  line-height: var(--line-height-18);
}

.chat-composer-drawer-row:last-of-type {
  border-bottom: none;
}

.chat-composer-drawer-row__leading {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex: 0 1 auto;
  min-width: 0;
  max-width: 30%;
}

.chat-composer-drawer-row__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-xlight);
  line-height: var(--line-height-18);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-composer-drawer-row__actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

</style>
