<template>
  <CodexConversationPane :messages="messages" :busy="true" :render-strategy="lazy ? 'lazy' : 'eager'">
    <template #message-header><span class="host-message-header">Host header</span></template>
    <template #mention><span>Host mention</span></template>
  </CodexConversationPane>
</template>
<script setup lang="ts">
import type { SurfaceMessage } from '@codex-app-sdk/core/surface'
import CodexConversationPane from '../../../../packages/vue/src/components/CodexConversationPane.vue'
defineProps<{ messages: SurfaceMessage[]; lazy: boolean }>()
</script>
