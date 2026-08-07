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

    <div class="chat-composer__input-row">
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
    </div>

    <div class="chat-composer__meta">
      <div class="chat-composer__meta-leading">
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
        <slot name="before-meta" />
        <ChatComposerActiveModes
          :plan-mode="effectiveCodexCapabilities.planMode && Boolean(planMode)"
          @disable-plan-mode="$emit('update:planMode', false)"
        />
      </div>
      <div class="chat-composer__meta-trailing">
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
          :service-tier="selectedServiceTier"
          :show-service-tier="effectiveCodexCapabilities.serviceTier"
          :show-reasoning="effectiveCodexCapabilities.reasoningEffort"
          @update:model-id="$emit('update:modelId', $event)"
          @update:reasoning-effort="$emit('update:reasoningEffort', $event)"
          @update:service-tier="$emit('update:serviceTier', $event)"
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
          :interrupt-armed="interruptArmed"
          :submit-label="sendButtonLabel"
          interrupt-label="Codex is working"
          @click="handleSendButtonClick"
        />
        <slot name="after" />
      </div>
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
  hasAttachments?: boolean;
  plugins?: readonly CodexSurfacePlugin[];
  capabilities?: CodexCapabilities;
  commands?: readonly CodexCommandSummary[];
  composerState?: CodexComposerState;
  isSending: boolean;
  interruptArmed?: boolean;
  menuItems?: readonly CodexComposerMenuItem<Payload>[];
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  models?: readonly CodexModelOption[];
  placeholder: string;
  queuedPromptId?: string | null;
  approvalPreset?: ApprovalPreset | null;
  planMode?: boolean;
  presentation?: CodexConversationPresentation;
  selectedModelId?: string | null;
  selectedReasoningEffort?: ReasoningEffort | null;
  selectedServiceTier?: string | null;
  skillCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  skills?: readonly CodexSkillSummary[];
  transcribeAudio?: CodexChatTranscription;
}>();

const emit = defineEmits<{
  error: [message: string | null];
  send: [prompt: string];
  steer: [prompt: string];
  steerQueuedPrompt: [promptId: string];
  attach: [];
  menuSelect: [item: CodexComposerMenuSelectableItem<Payload>];
  interrupt: [];
  'update:modelId': [modelId: string];
  'update:composerState': [state: CodexComposerState];
  selectApprovalPreset: [preset: ApprovalPreset];
  'update:planMode': [enabled: boolean];
  'update:reasoningEffort': [reasoningEffort: ReasoningEffort];
  'update:serviceTier': [serviceTier: string | null];
}>();

const prompt = ref('');
const editorEl = ref<CodexRichTextEditorExpose | null>(null);
const caretPosition = ref(0);
const selectionStart = ref(0);
const selectionEnd = ref(0);
let restoringComposerState = false;
let lastEmittedComposerState: CodexComposerState | null = null;
let composerRestoreRevision = 0;
const effectiveCodexCapabilities = computed(() => props.capabilities ?? codexCapabilities);
const effectivePresentation = computed(() => resolveCodexConversationPresentation(props.presentation));
const voiceVisible = computed(() => (
  effectivePresentation.value.composer.voice
  && Boolean(props.transcribeAudio || getCodexNativeRendererApi()?.capabilities.transcription)
));

const hasPrompt = computed(() => Boolean(prompt.value.trim()));
const canSend = computed(() => Boolean((hasPrompt.value || props.hasAttachments) && !props.disabled));
const transcribeAndSendPending = ref(false);
const canInterrupt = computed(() => Boolean(
  props.isSending
  && !hasPrompt.value
  && !props.hasAttachments
  && !props.disabled
  && !isRecording.value
  && !isTranscribing.value
  && !transcribeAndSendPending.value,
));
const sendButtonLoading = computed(() => canInterrupt.value);
const sendButtonDisabled = computed(() => {
  if (props.interruptArmed) return false;
  if (transcribeAndSendPending.value || isTranscribing.value) return true;
  if (isRecording.value && !props.disabled) return false;
  return !canSend.value && !canInterrupt.value;
});
const sendButtonLabel = computed(() => (props.isSending ? 'Queue prompt' : 'Send prompt'));
const {
  buttonDisabled: voiceButtonDisabled,
  buttonLabel: voiceButtonLabel,
  buttonTitle: voiceButtonTitle,
  error: voiceError,
  isRecording,
  isTranscribing,
  recorder,
  stop: stopRecording,
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

async function handleSendButtonClick(): Promise<void> {
  if (transcribeAndSendPending.value) return;
  if (props.interruptArmed) {
    emit('interrupt');
    return;
  }
  if (isRecording.value) {
    transcribeAndSendPending.value = true;
    try {
      if (await stopRecording()) {
        submitPrompt();
      }
    } finally {
      transcribeAndSendPending.value = false;
    }
    return;
  }
  if (canInterrupt.value) {
    emit('interrupt');
    return;
  }

  submitPrompt();
}

function submitSteer(): void {
  if (!prompt.value.trim() && props.queuedPromptId && !props.disabled) {
    emit('steerQueuedPrompt', props.queuedPromptId);
    return;
  }
  submitWithIntent('steer');
}

function submitWithIntent(intent: 'send' | 'steer'): void {
  const trimmed = prompt.value.trim();
  if (!canSend.value || (intent === 'steer' && !trimmed)) {
    return;
  }
  const submittedPrompt = trimmed || '(no user instructions)';

  prompt.value = '';
  selectionStart.value = 0;
  selectionEnd.value = 0;
  caretPosition.value = 0;
  closeComposerMenus();
  if (intent === 'send') {
    emit('send', submittedPrompt);
  } else {
    emit('steer', submittedPrompt);
  }
  void nextTick(resizeEditor);
}

async function insertTranscript(text: string): Promise<void> {
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
  await nextTick(() => {
    editorEl.value?.setCaret(nextCaret);
    resizeEditor();
  });
}

function setComposerText(value: string): void {
  restoreComposerState({ text: value, selectionStart: value.length, selectionEnd: value.length });
}

function restoreComposerState(state: CodexComposerState): void {
  const normalized = normalizeCodexComposerState(state);
  const revision = ++composerRestoreRevision;
  const currentSelection = editorEl.value?.getSelectionRange();
  if (editorEl.value
    && prompt.value === normalized.text
    && editorEl.value.readText() === normalized.text
    && currentSelection?.valid
    && currentSelection.start === normalized.selectionStart
    && currentSelection.end === normalized.selectionEnd) {
    selectionStart.value = normalized.selectionStart;
    selectionEnd.value = normalized.selectionEnd;
    caretPosition.value = normalized.selectionEnd;
    lastEmittedComposerState = normalized;
    restoringComposerState = false;
    return;
  }

  restoringComposerState = true;
  prompt.value = normalized.text;
  selectionStart.value = normalized.selectionStart;
  selectionEnd.value = normalized.selectionEnd;
  caretPosition.value = normalized.selectionEnd;
  lastEmittedComposerState = normalized;
  closeComposerMenus();
  void nextTick(() => {
    if (revision !== composerRestoreRevision) return;
    if (prompt.value !== normalized.text) {
      restoringComposerState = false;
      return;
    }
    if (editorEl.value?.readText() !== normalized.text) {
      editorEl.value?.setText(normalized.text, normalized.selectionEnd, { focus: false });
    }
    const restoredSelection = editorEl.value?.getSelectionRange();
    if (!restoredSelection?.valid
      || restoredSelection.start !== normalized.selectionStart
      || restoredSelection.end !== normalized.selectionEnd) {
      editorEl.value?.setSelection(normalized.selectionStart, normalized.selectionEnd, { focus: false });
    }
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

function focus(): void {
  editorEl.value?.focusEnd();
}

defineExpose({ focus });
</script>

<style scoped>
.chat-composer {
  --codex-composer-button-background: var(--color-on-surface-variant);
  --codex-composer-button-foreground: var(--color-surface);
  --codex-composer-button-hover-background: var(--color-on-surface);
  --chat-composer-button-size: var(--chat-composer-control-size, 36px);
  --chat-composer-button-size-small: var(--chat-composer-compact-control-size, 28px);
  --chat-composer-send-size: 28px;
  --chat-composer-input-max-height: calc(
    var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--chat-composer-line-height, var(--line-height-24))
    + var(--space-4)
    + var(--space-4)
  );
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-4) var(--space-6) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
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
  width: 100%;
  padding: var(--space-2) var(--space-1) var(--space-4);
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
  justify-content: space-between;
  gap: var(--space-6);
  width: 100%;
  min-height: var(--chat-composer-button-size, 36px);
}

.chat-composer__input-row,
.chat-composer__meta-leading,
.chat-composer__meta-trailing {
  display: flex;
  align-items: center;
  min-width: 0;
}

.chat-composer__input-row {
  width: 100%;
  align-items: flex-start;
}

.chat-composer__meta-leading {
  flex: 1 1 auto;
  gap: var(--space-3);
}

.chat-composer__meta-trailing {
  flex: 0 0 auto;
  gap: var(--space-3);
}

@media (max-width: 720px) {
  .chat-composer {
    border-radius: var(--radius-2xl);
  }
}
</style>
