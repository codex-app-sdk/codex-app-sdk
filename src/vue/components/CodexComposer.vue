<template>
  <form
    class="codex-chat-theme chat-composer"
    :class="{ 'chat-composer--disabled': disabled && !isSending }"
    aria-label="Prompt composer"
    @submit.prevent="submitPrompt"
  >
    <slot name="before" />
    <ChatComposerAtMentionMenu
      v-if="atMenuVisible"
      :active-index="activeAtIndex"
      :show-file-hint="fileMenuShowsHint"
      :visible-files="visibleFiles"
      :visible-plugins="visiblePlugins"
      @select-file="selectFile"
      @select-plugin="selectPlugin"
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
      v-if="effectivePresentation.composer.actionMenu"
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
      v-if="voiceVisible && (isRecording || isTranscribing)"
      :recorder="recorder"
      :recording="isRecording"
    />
    <ChatRichTextEditor
      v-else
      ref="editorEl"
      v-model="prompt"
      class="chat-composer__input"
      :placeholder="placeholder"
      :disabled="disabled && !isSending"
      :files="files"
      :plugins="plugins"
      :skills="skills"
      @blur="closeComposerMenusSoon"
      @click="updateCaretPosition"
      @caret-change="handleCaretChange"
      @input="handleEditorInput"
      @keydown="handleEditorKeydown"
      @keyup="updateCaretPosition"
      @paste="handleEditorPaste"
    />
    <slot name="after-input" />

    <div class="chat-composer__meta">
      <slot name="before-meta" />
      <ChatComposerActiveModes
        :plan-mode="effectiveCodexCapabilities.planMode && Boolean(planMode)"
        @disable-plan-mode="$emit('update:planMode', false)"
      />
      <ChatContextUsageIndicator
        v-if="effectivePresentation.composer.contextUsage"
        :context-usage="contextUsage"
      />
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
        v-if="voiceVisible"
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
import type { CodexContextUsage, CodexFileSearchItem, ApprovalPreset, CodexCapabilities, CodexCommandSummary, CodexModelOption, CodexSkillSummary, CodexChatTranscription, CodexConversationPresentation, ReasoningEffort } from '../chat/contracts';
import type { CodexSurfacePlugin } from '../../surface/types';
import { resolveCodexConversationPresentation } from '../chat/contracts';
import { codexCapabilities } from '../chat/codex-capabilities';
import { codexCommands } from '../chat/codex-commands';
import CodexComposerSendButton from './CodexComposerSendButton.vue';
import ChatComposerActiveModes from '../chat/ChatComposerActiveModes.vue';
import ChatComposerActionMenu from '../chat/ChatComposerActionMenu.vue';
import ChatComposerVoiceButton from '../chat/ChatComposerVoiceButton.vue';
import ChatComposerVoiceField from '../chat/ChatComposerVoiceField.vue';
import ChatContextUsageIndicator from '../chat/ChatContextUsageIndicator.vue';
import ChatModelReasoningSelector from '../chat/ChatModelReasoningSelector.vue';
import ChatComposerAtMentionMenu from '../chat/ChatComposerAtMentionMenu.vue';
import ChatComposerSkillMenu from '../chat/ChatComposerSkillMenu.vue';
import ChatComposerSlashMenu from '../chat/ChatComposerSlashMenu.vue';
import ChatRichTextEditor, { type CodexRichTextEditorExpose } from '../chat/ChatRichTextEditor.vue';
import { useChatComposerSuggestions } from '../chat/use-chat-composer-suggestions';
import { useChatComposerVoice } from '../chat/use-chat-composer-voice';
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from '../composer-menu';
import { getCodexNativeRendererApi } from '../native-capabilities';
import type { CodexComposerState } from '../composer-state';
import { normalizeCodexComposerState } from '../composer-state';

const props = defineProps<{
  autofocus?: boolean;
  attachEnabled?: boolean;
  contextUsage?: CodexContextUsage | null;
  disabled: boolean;
  draft?: string;
  draftRevision?: number;
  files?: readonly CodexFileSearchItem[];
  plugins?: readonly CodexSurfacePlugin[];
  capabilities?: CodexCapabilities;
  commands?: readonly CodexCommandSummary[];
  composerState?: CodexComposerState;
  isSending: boolean;
  menuItems?: readonly CodexComposerMenuItem<Payload>[];
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  models?: readonly CodexModelOption[];
  placeholder: string;
  approvalPreset?: ApprovalPreset | null;
  planMode?: boolean;
  presentation?: CodexConversationPresentation;
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
  'update:composerState': [state: CodexComposerState];
  selectApprovalPreset: [preset: ApprovalPreset];
  'update:planMode': [enabled: boolean];
  'update:reasoningEffort': [reasoningEffort: ReasoningEffort];
}>();

const prompt = ref('');
const editorEl = ref<CodexRichTextEditorExpose | null>(null);
const caretPosition = ref(0);
const selectionStart = ref(0);
const selectionEnd = ref(0);
let restoringComposerState = false;
let lastEmittedComposerState: CodexComposerState | null = null;
const effectiveCodexCapabilities = computed(() => props.capabilities ?? codexCapabilities);
const effectivePresentation = computed(() => resolveCodexConversationPresentation(props.presentation));
const voiceVisible = computed(() => (
  effectivePresentation.value.composer.voice
  && Boolean(props.transcribeAudio || getCodexNativeRendererApi()?.capabilities.transcription)
));

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
  activeAtIndex,
  activeSkillIndex,
  activeSlashIndex,
  close: closeComposerMenus,
  closeSoon: closeComposerMenusSoon,
  fileMenuShowsHint,
  atMenuVisible,
  handleKeydown: handleSuggestionKeydown,
  selectCommand,
  selectFile,
  selectPlugin,
  selectSkill,
  selectSlashSkill,
  skillMenuVisible,
  slashMenuVisible,
  sync: syncComposerMenus,
  updateCaretPosition,
  visibleFiles,
  visiblePlugins,
  visibleSkills,
  visibleSlashCommands,
  visibleSlashSkills,
} = useChatComposerSuggestions({
  caretPosition,
  commands: () => props.commands ?? codexCommands,
  disabled: () => props.disabled,
  files: () => props.files ?? [],
  plugins: () => props.plugins ?? [],
  pluginsEnabled: () => true,
  isSending: () => props.isSending,
  onCommandSubmitted: (command) => {
    emit('send', command);
    void nextTick(resizeEditor);
  },
  onTextInserted: focusAt,
  prompt,
  skills: () => props.skills ?? [],
  skillsEnabled: () => effectiveCodexCapabilities.value.skills,
  editor: editorEl,
});

watch(() => props.composerState, (state) => {
  if (state) restoreComposerState(state);
}, { deep: true, immediate: true });

watch(() => props.draftRevision, () => {
  if (!props.composerState) setComposerText(props.draft ?? '');
}, { immediate: props.draftRevision !== undefined });

watch(prompt, () => emitComposerState());

onMounted(() => {
  if (props.autofocus) {
    editorEl.value?.focusEnd();
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
  selectionStart.value = 0;
  selectionEnd.value = 0;
  caretPosition.value = 0;
  closeComposerMenus();
  if (intent === 'send') {
    emit('send', trimmed);
  } else {
    emit('steer', trimmed);
  }
  void nextTick(resizeEditor);
}

function insertTranscript(text: string): void {
  const transcript = text.trim();
  if (!transcript) {
    return;
  }

  const selection = editorEl.value?.getSelectionRange();
  const start = selection?.start ?? caretPosition.value;
  const end = selection?.end ?? caretPosition.value;
  const before = prompt.value.slice(0, start);
  const after = prompt.value.slice(end);
  const prefix = before && !/\s$/.test(before) ? ' ' : '';
  const suffix = after && !/^\s/.test(after) ? ' ' : '';
  const insertion = `${prefix}${transcript}${suffix}`;
  const nextCaret = before.length + insertion.length;
  prompt.value = `${before}${insertion}${after}`;
  caretPosition.value = nextCaret;
  selectionStart.value = nextCaret;
  selectionEnd.value = nextCaret;
  closeComposerMenus();
  void nextTick(() => {
    editorEl.value?.setCaret(nextCaret);
    resizeEditor();
  });
}

function setComposerText(value: string): void {
  restoreComposerState({ text: value, selectionStart: value.length, selectionEnd: value.length });
}

function restoreComposerState(state: CodexComposerState): void {
  const normalized = normalizeCodexComposerState(state);
  restoringComposerState = true;
  prompt.value = normalized.text;
  selectionStart.value = normalized.selectionStart;
  selectionEnd.value = normalized.selectionEnd;
  caretPosition.value = normalized.selectionEnd;
  closeComposerMenus();
  void nextTick(() => {
    if (prompt.value !== normalized.text) {
      restoringComposerState = false;
      return;
    }
    editorEl.value?.setText(normalized.text, normalized.selectionEnd, { focus: false });
    editorEl.value?.setSelection(normalized.selectionStart, normalized.selectionEnd, { focus: false });
    resizeEditor();
    restoringComposerState = false;
  });
}

function handleEditorKeydown(event: KeyboardEvent): void {
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
    event.preventDefault();
    editorEl.value?.insertTextAtSelection('\n');
    resizeEditorSoon();
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

function handleEditorInput(): void {
  updateCaretPosition();
  resizeEditor();
  syncComposerMenus();
}

function handleCaretChange(range: { end: number; start: number }): void {
  selectionStart.value = range.start;
  selectionEnd.value = range.end;
  updateCaretPosition(range);
  emitComposerState();
}

function emitComposerState(): void {
  if (restoringComposerState) return;
  const state = normalizeCodexComposerState({
    text: prompt.value,
    selectionStart: selectionStart.value,
    selectionEnd: selectionEnd.value,
  });
  if (lastEmittedComposerState
    && lastEmittedComposerState.text === state.text
    && lastEmittedComposerState.selectionStart === state.selectionStart
    && lastEmittedComposerState.selectionEnd === state.selectionEnd) return;
  lastEmittedComposerState = state;
  emit('update:composerState', state);
}

function handleEditorPaste(event: ClipboardEvent): void {
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  const text = clipboard.getData('text/plain');
  const containsRichOrFileContent = clipboard.files.length > 0 || [...(clipboard.types ?? [])].includes('text/html');
  if (!text && !containsRichOrFileContent) return;
  event.preventDefault();
  if (text) editorEl.value?.insertTextAtSelection(text);
}

function focusAt(caret: number): void {
  selectionStart.value = caret;
  selectionEnd.value = caret;
  caretPosition.value = caret;
  void nextTick(() => {
    editorEl.value?.setCaret(caret);
    resizeEditor();
  });
}

function resizeEditor(): void {
  editorEl.value?.autoResize();
}

function resizeEditorSoon(): void {
  void nextTick(resizeEditor);
}
</script>

<style scoped>
.chat-composer {
  --codex-composer-button-background: var(--color-on-surface-variant);
  --codex-composer-button-foreground: var(--color-surface);
  --codex-composer-button-hover-background: var(--color-on-surface);
  --chat-composer-button-size: var(--chat-composer-control-size, 36px);
  --chat-composer-button-size-small: var(--chat-composer-compact-control-size, 28px);
  --chat-composer-input-max-height: calc(
    var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--space-4)
    + var(--space-4)
  );
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
  font-size: var(--chat-composer-font-size, var(--font-size-15));
  line-height: var(--chat-composer-line-height, var(--line-height-24));
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
