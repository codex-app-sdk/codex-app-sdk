<template>
  <form
    class="codex-chat-theme chat-composer"
    :class="{ 'chat-composer--disabled': disabled && !isSending }"
    aria-label="Prompt composer"
    @submit.prevent="submitPrompt"
  >
    <slot name="before" />
    <ChatComposerFileMentionMenu
      v-if="fileMenuVisible"
      :active-index="activeFileIndex"
      :show-hint="fileMenuShowsHint"
      :visible-files="visibleFiles"
      @select="selectFile"
    />

    <ChatComposerSkillMenu
      v-if="skillMenuVisible"
      :active-index="activeSkillIndex"
      :visible-skills="visibleSkills"
      @select="selectSkill"
    />

    <ChatComposerSlashMenu
      v-if="slashMenuVisible"
      :active-index="activeSlashIndex"
      :visible-commands="visibleSlashCommands"
      :visible-skills="visibleSlashSkills"
      @select-command="selectCommand"
      @select-skill="selectSlashSkill"
    />

    <ChatComposerActionMenu
      :attach-enabled="attachEnabled"
      :disabled="disabled"
      :items="menuItems"
      :approval-preset="approvalPreset"
      :approval-presets="effectiveCodexCapabilities.approvalPresets ?? []"
      :plan-mode="planMode"
      :show-approval-menu="effectiveCodexCapabilities.approvals && Boolean(approvalPreset) && (effectiveCodexCapabilities.approvalPresets?.length ?? 0) > 0"
      :show-plan-mode="effectiveCodexCapabilities.planMode"
      @attach="$emit('attach')"
      @select="$emit('menuSelect', $event)"
      @select-approval-preset="$emit('selectApprovalPreset', $event)"
      @update:plan-mode="$emit('update:planMode', $event)"
    >
      <template v-if="$slots['menu-icon']" #icon="scope"><slot name="menu-icon" v-bind="scope" /></template>
      <template v-if="$slots['menu-item']" #item="scope"><slot name="menu-item" v-bind="scope" /></template>
    </ChatComposerActionMenu>

    <ChatComposerVoiceField
      v-if="isRecording || isTranscribing"
      :recorder="recorder"
      :recording="isRecording"
    />
    <textarea
      v-else
      ref="textareaEl"
      v-model="prompt"
      class="chat-composer__input"
      :placeholder="placeholder"
      aria-label="Prompt"
      rows="1"
      :disabled="disabled && !isSending"
      @blur="closeComposerMenusSoon"
      @click="updateCaretPosition"
      @input="handleTextareaInput"
      @keydown="handleTextareaKeydown"
      @keyup="updateCaretPosition"
      @select="updateCaretPosition"
    />
    <slot name="after-input" />

    <div class="chat-composer__meta">
      <slot name="before-meta" />
      <ChatComposerActiveModes
        :plan-mode="effectiveCodexCapabilities.planMode && Boolean(planMode)"
        @disable-plan-mode="$emit('update:planMode', false)"
      />
      <ChatContextUsageIndicator :context-usage="contextUsage" />
      <ChatModelReasoningSelector
        v-if="effectiveCodexCapabilities.models"
        :disabled="disabled || isSending"
        :models="models"
        :model-catalog-status="modelCatalogStatus"
        :model-id="selectedModelId"
        :reasoning-effort="selectedReasoningEffort"
        :show-reasoning="effectiveCodexCapabilities.reasoningEffort"
        @update:model-id="$emit('update:modelId', $event)"
        @update:reasoning-effort="$emit('update:reasoningEffort', $event)"
      />
      <ChatComposerVoiceButton
        :disabled="voiceButtonDisabled"
        :label="voiceButtonLabel"
        :recording="isRecording"
        :title="voiceButtonTitle"
        @toggle="toggleRecording"
      />
      <CodexComposerSendButton
        class="chat-composer__send"
        :disabled="sendButtonDisabled"
        :busy="sendButtonLoading"
        :submit-label="sendButtonLabel"
        interrupt-label="Codex is working"
        @click="handleSendButtonClick"
      />
      <slot name="after" />
    </div>
  </form>
</template>

<script setup lang="ts" generic="Payload = unknown">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { CodexContextUsage, CodexFileSearchItem, ApprovalPreset, CodexCapabilities, CodexCommandSummary, CodexModelOption, CodexSkillSummary, CodexChatTranscription, ReasoningEffort } from '../chat/contracts';
import { codexCapabilities } from '../chat/codex-capabilities';
import { codexCommands } from '../chat/codex-commands';
import CodexComposerSendButton from './CodexComposerSendButton.vue';
import ChatComposerActiveModes from '../chat/ChatComposerActiveModes.vue';
import ChatComposerActionMenu from '../chat/ChatComposerActionMenu.vue';
import ChatComposerVoiceButton from '../chat/ChatComposerVoiceButton.vue';
import ChatComposerVoiceField from '../chat/ChatComposerVoiceField.vue';
import ChatContextUsageIndicator from '../chat/ChatContextUsageIndicator.vue';
import ChatModelReasoningSelector from '../chat/ChatModelReasoningSelector.vue';
import ChatComposerFileMentionMenu from '../chat/ChatComposerFileMentionMenu.vue';
import ChatComposerSkillMenu from '../chat/ChatComposerSkillMenu.vue';
import ChatComposerSlashMenu from '../chat/ChatComposerSlashMenu.vue';
import { useChatComposerSuggestions } from '../chat/use-chat-composer-suggestions';
import { useChatComposerVoice } from '../chat/use-chat-composer-voice';
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from '../composer-menu';

const props = defineProps<{
  autofocus?: boolean;
  attachEnabled?: boolean;
  contextUsage?: CodexContextUsage | null;
  disabled: boolean;
  draft?: string;
  draftRevision?: number;
  files?: readonly CodexFileSearchItem[];
  capabilities?: CodexCapabilities;
  commands?: readonly CodexCommandSummary[];
  isSending: boolean;
  menuItems?: readonly CodexComposerMenuItem<Payload>[];
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  models?: readonly CodexModelOption[];
  placeholder: string;
  approvalPreset?: ApprovalPreset | null;
  planMode?: boolean;
  selectedModelId?: string | null;
  selectedReasoningEffort?: ReasoningEffort | null;
  skillCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  skills?: readonly CodexSkillSummary[];
  transcribeAudio?: CodexChatTranscription;
}>();

const emit = defineEmits<{
  error: [message: string | null];
  send: [prompt: string];
  steer: [prompt: string];
  attach: [];
  menuSelect: [item: CodexComposerMenuSelectableItem<Payload>];
  interrupt: [];
  'update:modelId': [modelId: string];
  selectApprovalPreset: [preset: ApprovalPreset];
  'update:planMode': [enabled: boolean];
  'update:reasoningEffort': [reasoningEffort: ReasoningEffort];
}>();

const CHAT_COMPOSER_INPUT_MAX_HEIGHT_PX = 88;

const prompt = ref('');
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const caretPosition = ref(0);
const effectiveCodexCapabilities = computed(() => props.capabilities ?? codexCapabilities);

const hasPrompt = computed(() => Boolean(prompt.value.trim()));
const canSend = computed(() => Boolean(hasPrompt.value && !props.disabled));
const canInterrupt = computed(() => Boolean(props.isSending && !hasPrompt.value && !props.disabled));
const sendButtonLoading = computed(() => canInterrupt.value);
const sendButtonDisabled = computed(() => !canSend.value && !canInterrupt.value);
const sendButtonLabel = computed(() => (props.isSending ? 'Queue prompt' : 'Send prompt'));
const {
  buttonDisabled: voiceButtonDisabled,
  buttonLabel: voiceButtonLabel,
  buttonTitle: voiceButtonTitle,
  error: voiceError,
  isRecording,
  isTranscribing,
  recorder,
  toggle: toggleRecording,
} = useChatComposerVoice({
  isDisabled: () => props.disabled,
  isSending: () => props.isSending,
  onTranscript: insertTranscript,
  transcribeAudio: props.transcribeAudio,
});

watch(voiceError, (message) => emit('error', message));
const {
  activeFileIndex,
  activeSkillIndex,
  activeSlashIndex,
  close: closeComposerMenus,
  closeSoon: closeComposerMenusSoon,
  fileMenuShowsHint,
  fileMenuVisible,
  handleKeydown: handleSuggestionKeydown,
  selectCommand,
  selectFile,
  selectSkill,
  selectSlashSkill,
  skillMenuVisible,
  slashMenuVisible,
  sync: syncComposerMenus,
  updateCaretPosition,
  visibleFiles,
  visibleSkills,
  visibleSlashCommands,
  visibleSlashSkills,
} = useChatComposerSuggestions({
  caretPosition,
  commands: () => props.commands ?? codexCommands,
  disabled: () => props.disabled,
  files: () => props.files ?? [],
  isSending: () => props.isSending,
  onCommandSubmitted: (command) => {
    emit('send', command);
    void nextTick(resizeTextarea);
  },
  onTextInserted: focusAt,
  prompt,
  skills: () => props.skills ?? [],
  skillsEnabled: () => effectiveCodexCapabilities.value.skills,
  textarea: textareaEl,
});

watch(() => props.draftRevision, () => {
  setComposerText(props.draft ?? '');
}, { immediate: props.draftRevision !== undefined });

onMounted(() => {
  if (props.autofocus) {
    textareaEl.value?.focus();
  }
});

function submitPrompt(): void {
  submitWithIntent('send');
}

function handleSendButtonClick(): void {
  if (canInterrupt.value) {
    emit('interrupt');
    return;
  }

  submitPrompt();
}

function submitSteer(): void {
  submitWithIntent('steer');
}

function submitWithIntent(intent: 'send' | 'steer'): void {
  const trimmed = prompt.value.trim();
  if (!canSend.value) {
    return;
  }

  prompt.value = '';
  closeComposerMenus();
  if (intent === 'send') {
    emit('send', trimmed);
  } else {
    emit('steer', trimmed);
  }
  void nextTick(resizeTextarea);
}

function insertTranscript(text: string): void {
  const transcript = text.trim();
  if (!transcript) {
    return;
  }

  const textarea = textareaEl.value;
  const start = textarea?.selectionStart ?? caretPosition.value;
  const end = textarea?.selectionEnd ?? caretPosition.value;
  const before = prompt.value.slice(0, start);
  const after = prompt.value.slice(end);
  const prefix = before && !/\s$/.test(before) ? ' ' : '';
  const suffix = after && !/^\s/.test(after) ? ' ' : '';
  const insertion = `${prefix}${transcript}${suffix}`;
  const nextCaret = before.length + insertion.length;
  prompt.value = `${before}${insertion}${after}`;
  caretPosition.value = nextCaret;
  closeComposerMenus();
  void nextTick(() => {
    textareaEl.value?.focus();
    textareaEl.value?.setSelectionRange(nextCaret, nextCaret);
    resizeTextarea();
  });
}

function setComposerText(value: string): void {
  prompt.value = value;
  const nextCaret = value.length;
  caretPosition.value = nextCaret;
  closeComposerMenus();
  void nextTick(() => {
    textareaEl.value?.focus();
    textareaEl.value?.setSelectionRange(nextCaret, nextCaret);
    resizeTextarea();
  });
}

function handleTextareaKeydown(event: KeyboardEvent): void {
  if (handleSuggestionKeydown(event)) {
    return;
  }

  if (event.key === 'Tab' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    if (effectiveCodexCapabilities.value.planMode) {
      emit('update:planMode', !props.planMode);
    }
    return;
  }

  if (event.key !== 'Enter') {
    return;
  }

  if (event.shiftKey) {
    resizeTextareaSoon();
    return;
  }

  event.preventDefault();
  if (event.metaKey && !event.ctrlKey && !event.altKey) {
    submitSteer();
    return;
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey) {
    submitPrompt();
  }
}

function handleTextareaInput(): void {
  updateCaretPosition();
  resizeTextarea();
  syncComposerMenus();
}

function focusAt(caret: number): void {
  void nextTick(() => {
    textareaEl.value?.focus();
    textareaEl.value?.setSelectionRange(caret, caret);
    resizeTextarea();
  });
}

function resizeTextarea(): void {
  const textarea = textareaEl.value;
  if (!textarea) {
    return;
  }

  textarea.style.height = '0px';
  textarea.style.height = `${Math.min(textarea.scrollHeight, CHAT_COMPOSER_INPUT_MAX_HEIGHT_PX)}px`;
}

function resizeTextareaSoon(): void {
  void nextTick(resizeTextarea);
}
</script>

<style scoped>
.chat-composer {
  --codex-composer-button-background: var(--color-on-surface-variant);
  --codex-composer-button-foreground: var(--color-surface);
  --codex-composer-button-hover-background: var(--color-on-surface);
  --codex-composer-button-size: var(--chat-composer-button-size);
  --chat-composer-button-size: 36px;
  --chat-composer-button-size-small: 28px;
  --chat-composer-input-max-height: calc(var(--line-height-24) + var(--line-height-24) + var(--line-height-24) + var(--space-4) + var(--space-4));
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface-lowest);
  box-shadow: var(--shadow-lg);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.chat-composer:focus-within {
  box-shadow: 0 0 var(--space-6) var(--space-2) var(--color-surface-low), var(--shadow-md);
}

.chat-composer--disabled {
  opacity: 0.62;
}

.chat-composer__input {
  flex: 1 1 auto;
  min-width: 0;
  max-height: var(--chat-composer-input-max-height);
  padding: var(--space-4) 0;
  border: 0;
  outline: 0;
  resize: none;
  overflow-y: auto;
  color: var(--color-text);
  background: transparent;
  font: inherit;
  font-size: var(--font-size-15);
  line-height: var(--line-height-24);
}

.chat-composer__input::placeholder {
  color: var(--color-text-muted);
}

.chat-composer__meta {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex: 0 0 auto;
}

@media (max-width: 720px) {
  .chat-composer {
    border-radius: var(--radius-2xl);
  }
}
</style>
