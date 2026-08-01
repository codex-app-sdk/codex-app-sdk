<template>
  <div class="codex-chat-theme chat-user-text codex-markdown">
    <p>
      <template v-for="(token, index) in tokens" :key="`${token.type}-${index}`">
        <span v-if="token.type === 'text'">{{ token.text }}</span>
        <code v-else-if="token.type === 'code'">{{ token.text }}</code>
        <br v-else-if="token.type === 'line-break'">
        <span
          v-else
          class="chat-user-text__mention"
          :class="`chat-user-text__mention--${token.type === 'plugin-mention' ? 'plugin' : 'skill'}`"
          :style="mentionStyle(token)"
          :title="mentionTitle(token)"
        >
          <span
            class="chat-user-text__mention-icon-frame"
            :class="{
              'chat-user-text__mention-icon-frame--has-light': mentionIcon(token, 'light'),
              'chat-user-text__mention-icon-frame--has-dark': mentionIcon(token, 'dark'),
            }"
          >
            <img
              v-if="mentionIcon(token, 'light')"
              class="chat-user-text__mention-image chat-user-text__mention-image--light"
              :src="mentionIcon(token, 'light')!"
              alt=""
              aria-hidden="true"
              decoding="async"
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="failedIconUrls.add(mentionIcon(token, 'light')!)"
            >
            <img
              v-if="mentionIcon(token, 'dark')"
              class="chat-user-text__mention-image chat-user-text__mention-image--dark"
              :src="mentionIcon(token, 'dark')!"
              alt=""
              aria-hidden="true"
              decoding="async"
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="failedIconUrls.add(mentionIcon(token, 'dark')!)"
            >
            <svg
              v-if="token.type === 'plugin-mention'"
              class="chat-user-text__mention-icon"
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M8 3v4" />
              <path d="M16 3v4" />
              <path d="M6 7h12v3a6 6 0 0 1-6 6v5" />
              <path d="M9 21h6" />
            </svg>
            <svg
              v-else
              class="chat-user-text__mention-icon"
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m12 2 8 4.5v11L12 22l-8-4.5v-11z" />
              <path d="m4 6.5 8 4.5 8-4.5" />
              <path d="M12 11v11" />
              <path d="m8 8.75 8-4.5" />
            </svg>
          </span>
          <span class="chat-user-text__mention-label">{{ token.displayName }}</span>
        </span>
      </template>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { CodexSurfacePlugin, CodexSurfaceSkill } from '../../surface/types';
import { parseCodexUserText, type CodexUserTextToken } from './user-text';

const props = withDefaults(defineProps<{
  content: string;
  plugins?: readonly CodexSurfacePlugin[];
  skills?: readonly CodexSurfaceSkill[];
}>(), {
  plugins: () => [],
  skills: () => [],
});

const failedIconUrls = reactive(new Set<string>());
const tokens = computed(() => parseCodexUserText(props.content, props.plugins, props.skills));

function mentionIcon(
  token: Extract<CodexUserTextToken, { type: 'plugin-mention' | 'skill-mention' }>,
  theme: 'light' | 'dark',
): string | null {
  const value = token.type === 'plugin-mention'
    ? (theme === 'dark' && token.plugin?.iconUrlDark !== token.plugin?.iconUrl
      ? token.plugin?.iconUrlDark
      : theme === 'light' ? token.plugin?.iconUrl : undefined)
    : (theme === 'light' ? token.skill?.iconSmall : undefined);
  if (!value) return null;
  if (failedIconUrls.has(value)) return null;
  if (value.startsWith('blob:') || value.startsWith('https://')) return value;
  return /^data:image\/(?:avif|bmp|gif|jpeg|png|svg\+xml|webp|x-icon);base64,/i.test(value) ? value : null;
}

function mentionStyle(token: Extract<CodexUserTextToken, { type: 'plugin-mention' | 'skill-mention' }>) {
  const color = token.type === 'plugin-mention'
    ? token.plugin?.brandColor
    : token.skill?.brandColor;
  return isSafeBrandColor(color) ? { '--codex-mention-color': color } : undefined;
}

function mentionTitle(token: Extract<CodexUserTextToken, { type: 'plugin-mention' | 'skill-mention' }>): string {
  if (token.type === 'plugin-mention') {
    return token.plugin?.shortDescription || token.displayName;
  }
  return token.skill?.shortDescription || token.skill?.description || token.displayName;
}

function isSafeBrandColor(value: string | undefined): value is string {
  return Boolean(value && /^#[\da-f]{3,8}$/i.test(value));
}
</script>

<style scoped>
.chat-user-text {
  white-space: normal;
  overflow-wrap: anywhere;
}

.chat-user-text__mention {
  --codex-mention-color: var(--color-primary);
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  max-width: 100%;
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  background: color-mix(in srgb, var(--codex-mention-color) 12%, var(--color-primary-container));
  color: color-mix(in srgb, var(--codex-mention-color) 42%, var(--color-on-primary-container));
  font-weight: var(--font-weight-medium);
  line-height: 1;
  vertical-align: -0.12em;
}

.chat-user-text__mention-icon-frame,
.chat-user-text__mention-icon,
.chat-user-text__mention-image {
  width: 1.12em;
  height: 1.12em;
  flex: 0 0 1.12em;
}

.chat-user-text__mention-icon-frame {
  position: relative;
  display: inline-flex;
}

.chat-user-text__mention-icon {
  display: block;
}

.chat-user-text__mention-icon-frame--has-light .chat-user-text__mention-icon,
.chat-user-text__mention-image--dark {
  display: none;
}

:global(.codex-chat-theme--dark) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-image--light,
:global([data-codex-theme="dark"]) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-image--light {
  display: none;
}

:global(.codex-chat-theme--dark) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-image--dark,
:global([data-codex-theme="dark"]) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-image--dark {
  display: block;
}

:global(.codex-chat-theme--dark) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-icon,
:global([data-codex-theme="dark"]) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-icon {
  display: none;
}

@media (prefers-color-scheme: dark) {
  :global(.codex-chat-theme--system) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-image--light,
  :global([data-codex-theme="system"]) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-image--light {
    display: none;
  }

  :global(.codex-chat-theme--system) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-image--dark,
  :global([data-codex-theme="system"]) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-image--dark {
    display: block;
  }

  :global(.codex-chat-theme--system) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-icon,
  :global([data-codex-theme="system"]) .chat-user-text__mention-icon-frame--has-dark .chat-user-text__mention-icon {
    display: none;
  }
}

.chat-user-text__mention-image {
  border-radius: 0.2em;
  object-fit: contain;
}

.chat-user-text__mention-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
