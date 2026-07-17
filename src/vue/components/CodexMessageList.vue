<template>
  <div ref="element" class="codex-message-list" :aria-label="ariaLabel" @scroll="updateStickiness">
    <div class="codex-message-list__content">
      <slot v-if="messages.length === 0" name="empty">
        <p class="codex-message-list__empty">{{ emptyLabel }}</p>
      </slot>
      <template v-for="(message, index) in messages" v-else :key="messageKey(message, index)">
        <slot name="message" :message="message" :index="index">
          <CodexMessage v-if="isSurfaceMessage(message)" :message="message" />
        </slot>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts" generic="Message extends { id?: string | number } = SurfaceMessage">
import { nextTick, onMounted, ref, watch } from 'vue';
import type { SurfaceMessage } from '../types';
import CodexMessage from './CodexMessage.vue';

const props = withDefaults(defineProps<{
  ariaLabel?: string;
  bottomThreshold?: number;
  emptyLabel?: string;
  messages: readonly Message[];
}>(), {
  ariaLabel: 'Conversation',
  bottomThreshold: 24,
  emptyLabel: 'No messages yet',
});

const emit = defineEmits<{
  stickinessChange: [stuckToBottom: boolean];
}>();

const element = ref<HTMLElement | null>(null);
const stickToBottom = ref(true);

onMounted(async () => {
  await nextTick();
  scrollToBottom();
});

watch(() => props.messages, async () => {
  const shouldScroll = stickToBottom.value;
  await nextTick();
  if (shouldScroll) {
    scrollToBottom();
  }
}, { deep: true });

function isSurfaceMessage(message: Message): message is Message & SurfaceMessage {
  const candidate = message as Partial<SurfaceMessage>;
  return typeof candidate.id === 'string'
    && (candidate.role === 'user' || candidate.role === 'assistant' || candidate.role === 'system')
    && Array.isArray(candidate.parts);
}

function messageKey(message: Message, index: number): string | number {
  return message.id ?? index;
}

function updateStickiness(): void {
  const next = element.value ? isAtBottom(element.value) : true;
  if (stickToBottom.value !== next) {
    stickToBottom.value = next;
    emit('stickinessChange', next);
  }
}

function isAtBottom(target: HTMLElement): boolean {
  return target.scrollHeight - target.scrollTop - target.clientHeight <= props.bottomThreshold;
}

function scrollToBottom(): void {
  if (!element.value) {
    return;
  }
  element.value.scrollTop = element.value.scrollHeight;
  if (!stickToBottom.value) {
    stickToBottom.value = true;
    emit('stickinessChange', true);
  }
}

defineExpose({ scrollToBottom });
</script>

<style scoped>
.codex-message-list {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  padding: var(--codex-message-list-padding, 24px 16px);
  overflow-y: auto;
  scrollbar-width: thin;
  box-sizing: border-box;
}

.codex-message-list__content {
  display: flex;
  flex-direction: column;
  gap: var(--codex-message-list-gap, 12px);
  width: min(100%, var(--codex-message-list-content-width, 900px));
  margin: 0 auto;
  padding: var(--codex-message-list-content-padding, 0);
  box-sizing: border-box;
}

.codex-message-list__empty {
  margin: auto;
  color: var(--codex-muted-text-color, #777b82);
  text-align: center;
}
</style>
