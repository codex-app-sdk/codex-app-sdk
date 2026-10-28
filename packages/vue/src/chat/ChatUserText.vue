<template>
  <div class="codex-chat-theme chat-user-text codex-markdown">
    <p>
      <template v-for="(token, index) in tokens" :key="`${token.type}-${index}`">
        <span v-if="token.type === 'text'">{{ token.text }}</span>
        <code v-else-if="token.type === 'code'">{{ token.text }}</code>
        <br v-else-if="token.type === 'line-break'">
        <ChatMentionChip v-else-if="token.type === 'file-mention'" kind="file" :name="token.displayName" class="chat-user-text__mention chat-user-text__mention--file" :title="token.displayName" />
        <slot
          v-else-if="token.type === 'custom-mention'"
          name="mention"
          :group="token.group"
          :item="token.item"
          :token="token"
          surface="message"
        >
          <ChatMentionChip kind="plugin" :name="token.displayName" class="chat-user-text__mention chat-user-text__mention--custom" :title="token.item.description || token.displayName" />
        </slot>
        <ChatMentionChip
          v-else
          :kind="token.type === 'plugin-mention' ? 'plugin' : 'skill'"
          :name="token.displayName"
          class="chat-user-text__mention"
          :class="`chat-user-text__mention--${token.type === 'plugin-mention' ? 'plugin' : 'skill'}`"
          :title="mentionTitle(token)"
        >
          <template #icon>
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
              <PlugIcon
                v-if="token.type === 'plugin-mention'"
                class="chat-user-text__mention-icon"
                aria-hidden="true"
              />
              <SparklesIcon v-else class="chat-user-text__mention-icon" aria-hidden="true" />
            </span>
          </template>
        </ChatMentionChip>
      </template>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { CodexPromptPart, CodexSurfacePlugin, CodexSurfaceSkill } from '@codex-app-sdk/core/surface';
import { PlugIcon, SparklesIcon } from '../icons/app-icons';
import ChatMentionChip from './ChatMentionChip.vue';
import { parseAuthoredUserText, type CodexUserTextToken } from './user-text';
import type { CodexComposerMentionGroup } from './composer-mentions-custom';

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  content: string;
  promptContent?: readonly CodexPromptPart[];
  mentionGroups?: readonly CodexComposerMentionGroup[];
  plugins?: readonly CodexSurfacePlugin[];
  skills?: readonly CodexSurfaceSkill[];
}>(), {
  plugins: () => [],
  mentionGroups: () => [],
  skills: () => [],
});
// Stryker restore all

const failedIconUrls = reactive(new Set<string>());
const tokens = computed(() => parseAuthoredUserText(props.content, props.promptContent, props.plugins, props.skills, props.mentionGroups));

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
defineSlots<{
  mention(props: {
    group: Extract<CodexUserTextToken, { type: 'custom-mention' }>['group'];
    item: Extract<CodexUserTextToken, { type: 'custom-mention' }>['item'];
    surface: 'message';
    token: Extract<CodexUserTextToken, { type: 'custom-mention' }>;
  }): unknown;
}>();
// Stryker restore all

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

function mentionTitle(token: Extract<CodexUserTextToken, { type: 'plugin-mention' | 'skill-mention' }>): string {
  if (token.type === 'plugin-mention') {
    return token.plugin?.shortDescription || token.displayName;
  }
  return token.skill?.shortDescription || token.skill?.description || token.displayName;
}
</script>

<style scoped>
.chat-user-text {
  white-space: normal;
  overflow-wrap: anywhere;
}

.chat-user-text__mention {
  vertical-align: -2px;
}

.chat-user-text__mention-icon-frame,
.chat-user-text__mention-icon,
.chat-user-text__mention-image {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 var(--icon-sm);
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
</style>
