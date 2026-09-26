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
      :mention-groups="visibleMentionGroups"
      :visible-files="visibleFiles"
      :visible-plugins="visiblePlugins"
      @select-file="selectFile"
      @select-plugin="selectPlugin"
      @select-mention="selectMention"
    >
      <template v-if="$slots['suggestion-item']" #mention="scope">
        <slot name="suggestion-item" v-bind="scope" surface="menu" />
      </template>
    </ChatComposerAtMentionMenu>

    <ChatComposerSkillMenu
      v-if="skillMenuVisible"
      :active-index="activeSkillIndex"
      :plugins="plugins"
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
        :placeholder="effectivePlaceholder"
        :disabled="disabled && !isSending"
        :files="files"
        :mention-groups="mentionGroups"
        :plugins="plugins"
        :skills="skills"
        @blur="closeComposerMenusSoon"
        @click="updateCaretPosition"
        @caret-change="handleCaretChange"
        @input="handleEditorInput"
        @keydown="handleEditorKeydown"
        @keyup="updateCaretPosition"
        @paste="handleEditorPaste"
      >
        <template v-if="$slots.mention" #mention="scope">
          <slot name="mention" v-bind="scope" surface="composer" />
        </template>
      </ChatRichTextEditor>
      <slot name="after-input" />
    </div>

    <div class="chat-composer__meta">
      <div class="chat-composer__meta-leading">
        <ChatComposerActionMenu
          v-if="effectivePresentation.composer.actionMenu"
          :attach-enabled="attachEnabled"
          :disabled="disabled"
          :leading-menu-items="leadingMenuItems"
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
          :command="activeCommand"
          @disable-plan-mode="$emit('update:planMode', false)"
          @remove-command="removeActiveCommand"
        />
      </div>
      <div class="chat-composer__meta-trailing">
        <ChatContextUsageIndicator
          v-if="effectivePresentation.composer.contextUsage"
          :context-usage="contextUsage"
        />
        <ChatModelReasoningSelector
          v-if="effectiveCodexCapabilities.models"
          :disabled="disabled"
          :models="models"
          :model-catalog-status="modelCatalogStatus"
          :model-id="selectedModelId"
          :menu-items="modelMenuItems"
          :reasoning-effort="selectedReasoningEffort"
          :service-tier="selectedServiceTier"
          :show-service-tier="effectiveCodexCapabilities.serviceTier"
          :show-reasoning="effectiveCodexCapabilities.reasoningEffort"
          @update:model-id="$emit('update:modelId', $event)"
          @menu-select="$emit('menuSelect', $event)"
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
          :hover-to-enable="canSubmitEmptyContinue"
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
import type { CodexSurfacePlugin } from '@codex-app-sdk/core/surface';
import { resolveCodexConversationPresentation } from '../chat/contracts';
import { codexCapabilities } from '../chat/codex-capabilities';
import { codexCommands } from '../chat/codex-commands';
import { createComposerPromptHistory } from '../chat/composer-prompt-history';
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
import { useCodexHostCapabilities } from '../native-capabilities';
import type { CodexComposerState } from '../composer-state';
import { normalizeCodexComposerState } from '../composer-state';
import type { CodexComposerMentionGroup, CodexComposerMentionItem } from '../chat/composer-mentions-custom';

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  autofocus?: boolean;
  attachEnabled?: boolean;
  canContinueInterruptedTurn?: boolean;
  contextUsage?: CodexContextUsage | null;
  disabled: boolean;
  draft?: string;
  draftRevision?: number;
  emptySendContinues?: boolean;
  files?: readonly CodexFileSearchItem[];
  hasAttachments?: boolean;
  hasExternalContent?: boolean;
  plugins?: readonly CodexSurfacePlugin[];
  promptHistory?: readonly string[];
  promptHistoryLoading?: boolean;
  capabilities?: CodexCapabilities;
  commands?: readonly CodexCommandSummary[];
  composerState?: CodexComposerState;
  isSending: boolean;
  interruptArmed?: boolean;
  leadingMenuItems?: readonly CodexComposerMenuItem<Payload>[];
  menuItems?: readonly CodexComposerMenuItem<Payload>[];
  mentionGroups?: readonly CodexComposerMentionGroup<Payload>[];
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  models?: readonly CodexModelOption[];
  modelMenuItems?: readonly CodexComposerMenuItem<Payload>[];
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
  continueInterruptedTurn: [];
  error: [message: string | null];
  send: [prompt: string, options?: { inputMethod: 'dictated' }];
  steer: [prompt: string, options?: { inputMethod: 'dictated' }];
  steerQueuedPrompt: [promptId: string];
  attach: [];
  menuSelect: [item: CodexComposerMenuSelectableItem<Payload>];
  mentionSelect: [item: CodexComposerMentionItem<Payload>, group: CodexComposerMentionGroup<Payload>];
  interrupt: [];
  'update:modelId': [modelId: string];
  'update:composerState': [state: CodexComposerState];
  selectApprovalPreset: [preset: ApprovalPreset];
  'update:planMode': [enabled: boolean];
  'update:reasoningEffort': [reasoningEffort: ReasoningEffort];
  'update:serviceTier': [serviceTier: string | null];
}>();
// Stryker restore all

const hostCapabilities = useCodexHostCapabilities();

const prompt = ref('');
const activeCommandId = ref<string | null>(null);
const dictatedInput = ref(false);
const editorEl = ref<CodexRichTextEditorExpose | null>(null);
const caretPosition = ref(0);
const selectionStart = ref(0);
const selectionEnd = ref(0);
const {
  exit: exitPromptHistory,
  recall: recallPrompt,
  remember: rememberSubmittedPrompt,
  seed: seedPromptHistory,
} = createComposerPromptHistory({
  apply: applyRecalledPrompt,
  currentPrompt: () => prompt.value,
});
let restoringComposerState = false;
let lastEmittedComposerState: CodexComposerState | null = null;
let composerRestoreRevision = 0;
const effectiveCodexCapabilities = computed(() => props.capabilities ?? codexCapabilities);
const effectivePresentation = computed(() => resolveCodexConversationPresentation(props.presentation));
const activeCommand = computed(() => (
  (props.commands ?? codexCommands).find((command) => command.id === activeCommandId.value) ?? null
));
const effectivePlaceholder = computed(() => activeCommand.value?.composerMode?.placeholder ?? props.placeholder);
const voiceVisible = computed(() => (
  effectivePresentation.value.composer.voice
  && Boolean(props.transcribeAudio || hostCapabilities?.capabilities.transcription)
));

const hasPrompt = computed(() => Boolean(prompt.value.trim()));
const canSend = computed(() => Boolean((activeCommand.value
  ? hasPrompt.value
  : hasPrompt.value || props.hasAttachments || props.hasExternalContent
) && !props.disabled));
const canContinueInterruptedTurn = computed(() => Boolean(
  props.canContinueInterruptedTurn
  && !props.isSending
  && !hasPrompt.value
  && !props.hasAttachments
  && !props.hasExternalContent
  && !props.disabled,
));
const canSubmitEmptyContinue = computed(() => Boolean(
  props.emptySendContinues
  && !props.isSending
  && !props.disabled
  && !hasPrompt.value
  && !props.hasAttachments
  && !props.hasExternalContent
  && !activeCommand.value
  && !canContinueInterruptedTurn.value,
));
let pendingTranscriptCaret: number | null = null;
const canInterrupt = computed(() => Boolean(
  props.isSending
  && !hasPrompt.value
  && !props.hasAttachments
  && !props.hasExternalContent
  && !props.disabled
  && !isRecording.value
  && !isTranscribing.value,
));
const sendButtonLoading = computed(() => canInterrupt.value);
const sendButtonDisabled = computed(() => {
  if (props.interruptArmed) return false;
  if (isTranscribing.value) return true;
  if (isRecording.value && !props.disabled) return false;
  return !canSend.value && !canInterrupt.value && !canContinueInterruptedTurn.value;
});
const sendButtonLabel = computed(() => (
  canContinueInterruptedTurn.value
    ? 'Continue'
    : canSubmitEmptyContinue.value
      ? 'Send continue prompt'
      : props.isSending ? 'Queue prompt' : 'Send prompt'
));
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
watch(isTranscribing, (transcribing) => {
  if (transcribing || pendingTranscriptCaret === null) return;
  const caret = pendingTranscriptCaret;
  pendingTranscriptCaret = null;
  void nextTick(() => {
    editorEl.value?.setCaret(caret);
  });
});
let pendingPromptHistorySteps = 0;
watch(() => [props.promptHistory, props.promptHistoryLoading] as const, ([history, loading]) => {
  seedPromptHistory(history ?? []);
  if (loading || pendingPromptHistorySteps === 0) return;
  const steps = pendingPromptHistorySteps;
  pendingPromptHistorySteps = 0;
  for (let step = 0; step < steps; step += 1) recallPrompt('ArrowUp');
}, { immediate: true });
const {
  activeAtIndex,
  activeSkillIndex,
  activeSlashIndex,
  close: closeComposerMenus,
  closeSoon: closeComposerMenusSoon,
  resume: resumeComposerSuggestions,
  fileMenuShowsHint,
  atMenuVisible,
  handleKeydown: handleSuggestionKeydown,
  selectCommand,
  selectFile,
  selectPlugin,
  selectMention,
  selectSkill,
  selectSlashSkill,
  skillMenuVisible,
  slashMenuVisible,
  suspend: suspendComposerSuggestions,
  updateCaretPosition,
  visibleFiles,
  visiblePlugins,
  visibleMentionGroups,
  visibleSkills,
  visibleSlashCommands,
  visibleSlashSkills,
} = useChatComposerSuggestions({
  caretPosition,
  commands: () => props.commands ?? codexCommands,
  disabled: () => props.disabled,
  files: () => props.files ?? [],
  plugins: () => props.plugins ?? [],
  mentionGroups: () => props.mentionGroups ?? [],
  isSending: () => props.isSending,
  onCommandActivated: (command) => {
    activeCommandId.value = command.id;
    emitComposerState();
  },
  onCommandSubmitted: (command) => {
    rememberSubmittedPrompt(command);
    emit('send', command);
  },
  onTextInserted: focusAt,
  onMentionSelected: (item, group) => emit('mentionSelect', item, group),
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
  if (canContinueInterruptedTurn.value) {
    emit('continueInterruptedTurn');
    return;
  }
  if (canSubmitEmptyContinue.value) {
    emit('send', 'continue');
    return;
  }
  submitWithIntent('send');
}

async function handleSendButtonClick(): Promise<void> {
  if (props.interruptArmed) {
    emit('interrupt');
    return;
  }
  if (isRecording.value) {
    if (await stopRecording()) {
      submitPrompt();
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
  if (!prompt.value.trim() && props.queuedPromptId && !props.hasAttachments && !props.hasExternalContent && !props.disabled) {
    emit('steerQueuedPrompt', props.queuedPromptId);
    return;
  }
  submitWithIntent('steer');
}

function submitWithIntent(intent: 'send' | 'steer'): void {
  const trimmed = prompt.value.trim();
  if (!canSend.value || (intent === 'steer' && !trimmed && !props.hasAttachments)) {
    return;
  }
  const slashCommand = activeCommand.value
    ? `/${activeCommand.value.slashName ?? activeCommand.value.name}`
    : null;
  const submittedPrompt = slashCommand && trimmed
    ? `${slashCommand} ${trimmed}`
    : trimmed || (props.hasAttachments ? '(no user instructions)' : '');
  const submissionOptions = dictatedInput.value ? { inputMethod: 'dictated' as const } : undefined;
  if (trimmed) rememberSubmittedPrompt(submittedPrompt);

  prompt.value = '';
  activeCommandId.value = null;
  dictatedInput.value = false;
  selectionStart.value = 0;
  selectionEnd.value = 0;
  caretPosition.value = 0;
  closeComposerMenus();
  if (intent === 'send') {
    if (submissionOptions) emit('send', submittedPrompt, submissionOptions);
    else emit('send', submittedPrompt);
  } else {
    if (submissionOptions) emit('steer', submittedPrompt, submissionOptions);
    else emit('steer', submittedPrompt);
  }
}

async function insertTranscript(text: string): Promise<void> {
  const transcript = text.trim();
  if (!transcript) {
    return;
  }

  const selection = editorEl.value?.getSelectionRange();
  const start = selection?.start ?? selectionStart.value;
  const end = selection?.end ?? selectionEnd.value;
  const before = prompt.value.slice(0, start);
  const after = prompt.value.slice(end);
  const prefix = before && !/\s$/.test(before) ? ' ' : '';
  const suffix = after && !/^\s/.test(after) ? ' ' : '';
  const insertion = `${prefix}${transcript}${suffix}`;
  const nextCaret = before.length + insertion.length;
  prompt.value = `${before}${insertion}${after}`;
  dictatedInput.value = true;
  caretPosition.value = nextCaret;
  selectionStart.value = nextCaret;
  selectionEnd.value = nextCaret;
  pendingTranscriptCaret = nextCaret;
  closeComposerMenus();
}

function setComposerText(value: string): void {
  exitPromptHistory();
  restoreComposerState({ text: value, selectionStart: value.length, selectionEnd: value.length });
}

function removeActiveCommand(): void {
  activeCommandId.value = null;
  emitComposerState();
  editorEl.value?.focusEnd();
}

function restoreComposerState(state: CodexComposerState): void {
  const normalized = normalizeCodexComposerState(state);
  activeCommandId.value = normalized.activeCommandId ?? null;
  if (!sameComposerState(normalized, lastEmittedComposerState)) exitPromptHistory();
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
    const restoredSelection = editorEl.value?.getSelectionRange();
    if (!restoredSelection?.valid
      || restoredSelection.start !== normalized.selectionStart
      || restoredSelection.end !== normalized.selectionEnd) {
      editorEl.value?.setSelection(normalized.selectionStart, normalized.selectionEnd, { focus: false });
    }
    restoringComposerState = false;
  });
}

function sameComposerState(left: CodexComposerState, right: CodexComposerState | null): boolean {
  return Boolean(right
    && left.text === right.text
    && left.selectionStart === right.selectionStart
    && left.selectionEnd === right.selectionEnd
    && (left.activeCommandId ?? null) === (right.activeCommandId ?? null));
}

function handleEditorKeydown(event: KeyboardEvent): void {
  if (handleSuggestionKeydown(event)) {
    return;
  }

  if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
    && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    && caretIsAtPromptEnd()) {
    if (recallPrompt(event.key)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowUp' && props.promptHistoryLoading && prompt.value === '') {
      pendingPromptHistorySteps += 1;
      event.preventDefault();
      return;
    }
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
    return;
  }

  event.preventDefault();
  if (event.metaKey && !event.ctrlKey && !event.altKey) {
    if (canContinueInterruptedTurn.value || (canSubmitEmptyContinue.value && !props.queuedPromptId)) submitPrompt();
    else submitSteer();
    return;
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey) {
    submitPrompt();
  }
}

function caretIsAtPromptEnd(): boolean {
  const selection = editorEl.value?.getSelectionRange();
  if (selection?.valid) {
    return selection.start === selection.end && selection.end === prompt.value.length;
  }
  return selectionStart.value === selectionEnd.value && selectionEnd.value === prompt.value.length;
}

function handleEditorInput(): void {
  pendingPromptHistorySteps = 0;
  exitPromptHistory();
  resumeComposerSuggestions();
  updateCaretPosition();
  resizeEditor();
}

function applyRecalledPrompt(value: string): void {
  const caret = value.length;
  prompt.value = value;
  selectionStart.value = caret;
  selectionEnd.value = caret;
  caretPosition.value = caret;
  suspendComposerSuggestions();
  void nextTick(() => {
    editorEl.value?.setText(value, caret);
  });
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
    activeCommandId: activeCommandId.value,
  });
  if (sameComposerState(state, lastEmittedComposerState)) return;
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
  });
}

function resizeEditor(): void {
  editorEl.value?.autoResize();
}

function focus(): void {
  editorEl.value?.focusEnd();
}

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
defineExpose({ focus });
// Stryker restore all
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
