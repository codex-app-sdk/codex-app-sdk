<template>
  <section
    ref="paneElement"
    class="codex-chat-theme codex-conversation-pane"
    :aria-busy="effectiveTranscriptBusy || effectiveHistoryLoading"
    :aria-label="ariaLabel"
    :data-codex-generating="effectiveTranscriptBusy ? 'true' : undefined"
    @click="handleConversationClick"
    @dragover="handleDragOver"
    @drop="handleDrop"
    @paste.capture="handlePaste"
  >
    <CodexConversationHistoryLoader
      v-if="showHistoryLoader"
      class="codex-conversation-pane__history-loader"
    />

    <CodexWorkbenchLayout
      v-else
      class="codex-conversation-pane__layout"
      scroll-mode="child"
    >
      <CodexMessageList
        v-if="started"
        class="codex-conversation-pane__messages"
        :actions-disabled="effectiveActionsDisabled"
        :active-turn-id="effectiveActiveTurnId"
        :answered-client-request-ids="effectiveAnsweredClientRequestIds"
        :aria-label="ariaLabel"
        :busy="effectiveTranscriptBusy"
        :can-delete-turn="effectiveCanDeleteTurn"
        :can-edit-turn="effectiveCanEditTurn"
        :can-fork-turn="effectiveCanForkTurn"
        :can-retry-turn="effectiveCanRetryTurn"
        :deleting-turn-id="deletingTurnId"
        :empty-label="emptyTitle"
        :follow-ups-disabled="effectiveFollowUpsDisabled"
        :has-older-messages="effectiveHasOlderHistory"
        :render-strategy="effectiveRenderStrategy"
        :loading-older-messages="effectiveLoadingOlderHistory"
        :initial-message-batch-size="initialMessageBatchSize"
        :message-batch-size="messageBatchSize"
        :messages="effectiveMessages"
        :mention-groups="effectiveMentionGroups"
        :open-image="openImage"
        :plugins="effectivePlugins"
        :presentation="effectivePresentation"
        :reset-key="effectiveConversationKey"
        :scroll-to-bottom-label="scrollToBottomLabel"
        :show-tool-details="showToolDetails"
        :skills="effectiveSkills"
        :transform-message="transformMessage"
        :turns="effectiveTurns"
        @cancel="cancel"
        @client-response="respondToClientRequest"
        @copy-message="copyMessage"
        @delete-turn="deleteTurn"
        @edit-turn="editTurn"
        @fork-turn="forkTurn"
        @load-older-messages="loadOlderHistory"
        @open-link="handleConversationLink"
        @open-visualization="handleVisualization"
        @quote-message="quoteMessage"
        @retry-turn="retryTurn"
        @send-follow-up="sendFollowUp"
      >
        <template v-if="$slots.message" #message="scope"><slot name="message" v-bind="scope" /></template>
        <template v-if="$slots['message-actions']" #actions="scope"><slot name="message-actions" v-bind="scope" /></template>
        <template v-if="$slots['message-attachment']" #attachment="scope"><slot name="message-attachment" v-bind="scope" /></template>
        <template v-if="$slots['message-block']" #block="scope"><slot name="message-block" v-bind="scope" /></template>
        <template v-if="$slots['message-header']" #header="scope"><slot name="message-header" v-bind="scope" /></template>
        <template v-if="$slots.mention" #mention="scope"><slot name="mention" v-bind="scope" /></template>
        <template v-if="$slots['message-status']" #status="scope"><slot name="message-status" v-bind="scope" /></template>
        <template v-if="$slots['message-text']" #text="scope"><slot name="message-text" v-bind="scope" /></template>
        <template v-if="$slots['message-thinking']" #thinking="scope"><slot name="message-thinking" v-bind="scope" /></template>
        <template v-if="$slots['message-tool']" #tool="scope"><slot name="message-tool" v-bind="scope" /></template>
      </CodexMessageList>

      <div v-else class="codex-conversation-pane__hero">
        <slot name="empty" :title="emptyTitle" :description="emptyDescription">
          <div class="codex-conversation-pane__hero-copy">
            <h1>{{ emptyTitle }}</h1>
            <p v-if="emptyDescription">{{ emptyDescription }}</p>
          </div>
        </slot>
      </div>

      <template #footer>
        <footer class="codex-conversation-pane__footer">
          <p v-if="effectiveError" class="codex-conversation-pane__error" role="alert">{{ effectiveError }}</p>
          <div v-if="effectiveApprovals.length > 0" class="codex-conversation-pane__approvals">
            <template v-for="approval in effectiveApprovals" :key="approval.id">
              <slot name="approval" :approval="approval">
                <CodexApprovalPrompt
                  :approval="approval"
                  :disabled="effectiveDisabled"
                  @resolve="(decision, scope) => resolveApproval(approval.id, decision, scope)"
                />
              </slot>
            </template>
          </div>
          <slot name="before-composer" />
          <ChatComposerShelf
            class="codex-conversation-pane__composer-shelf"
            :goal="effectiveGoal"
            :presentation="effectivePresentation.shelf"
            :queued-prompts="effectiveQueuedPrompts"
            :queued-prompt-edit-disabled="localDraft.length > 0"
            :turn-git-diff="effectiveTurnGitDiff"
            @clear-goal="clearGoal"
            @delete-queued-prompt="deleteQueuedPrompt"
            @edit-queued-prompt="editQueuedPrompt"
            @edit-goal="editGoal"
            @steer-queued-prompt="steerQueuedPrompt"
          />
          <CodexComposer
            :key="effectiveConversationKey ?? 'no-conversation'"
            ref="composer"
            class="codex-conversation-pane__composer"
            :autofocus="autofocus"
            :attach-enabled="effectiveAttachEnabled"
            :capabilities="effectiveCapabilities"
            :commands="effectiveCommands"
            :composer-state="localComposerState"
            :context-usage="effectiveContextUsage"
            :disabled="effectiveDisabled"
            :draft="localDraft"
            :files="effectiveFiles"
            :has-attachments="selectedAttachments.length > 0"
            :interrupt-armed="escapeInterruptArmed"
            :plugins="effectivePlugins"
            :prompt-history="effectivePromptHistory"
            :prompt-history-loading="promptHistoryLoading"
            :queued-prompt-id="effectiveQueuedPrompts[0]?.id ?? null"
            :is-sending="effectiveBusy"
            :leading-menu-items="effectiveLeadingMenuItems"
            :menu-items="effectiveMenuItems"
            :mention-groups="effectiveMentionGroups"
            :model-catalog-status="effectiveModelCatalogStatus"
            :models="effectiveModels"
            :placeholder="effectivePlaceholder"
            :approval-preset="effectiveApprovalPreset"
            :plan-mode="effectivePlanMode"
            :presentation="effectivePresentation"
            :selected-model-id="effectiveSelectedModelId"
            :selected-reasoning-effort="effectiveSelectedReasoningEffort"
            :selected-service-tier="effectiveSelectedServiceTier"
            :skill-catalog-status="effectiveSkillCatalogStatus"
            :skills="effectiveSkills"
            :transcribe-audio="transcribeAudio"
            @error="handleComposerError"
            @attach="selectAttachments"
            @interrupt="interrupt"
            @menu-select="menuSelect"
            @mention-select="mentionSelect"
            @select-approval-preset="selectApprovalPreset"
            @send="submit"
            @steer="steer"
            @steer-queued-prompt="steerQueuedPrompt"
            @update:model-id="updateModelId"
            @update:composer-state="updateComposerState"
            @update:plan-mode="updatePlanMode"
            @update:reasoning-effort="updateReasoningEffort"
            @update:service-tier="updateServiceTier"
          >
            <template #before>
              <div
                v-if="selectedAttachments.length > 0"
                class="codex-conversation-pane__attachments"
                aria-label="Prompt attachments"
              >
                <div
                  v-for="(attachment, index) in selectedAttachments"
                  :key="attachment.id"
                  class="codex-conversation-pane__attachment"
                >
                  <img
                    v-if="attachment.previewUrl"
                    class="codex-conversation-pane__attachment-preview"
                    :src="attachment.previewUrl"
                    :alt="attachment.name"
                  >
                  <span v-else class="codex-conversation-pane__attachment-file" aria-hidden="true">📎</span>
                  <span class="codex-conversation-pane__attachment-name" :title="attachment.name">
                    {{ attachment.name }}
                  </span>
                  <span class="codex-conversation-pane__attachment-actions">
                    <slot
                      name="composer-attachment-actions"
                      :attachments="selectedAttachments"
                      :index="index"
                      :disabled="effectiveDisabled"
                    />
                    <button
                      type="button"
                      class="codex-conversation-pane__attachment-remove"
                      :aria-label="`Remove ${attachment.name}`"
                      :disabled="effectiveDisabled"
                      @click="removeAttachment(attachment.id)"
                    >
                      <XIcon aria-hidden="true" />
                    </button>
                  </span>
                </div>
              </div>
            </template>
            <template v-if="$slots['menu-icon']" #menu-icon="scope"><slot name="menu-icon" v-bind="scope" /></template>
            <template v-if="$slots['menu-item']" #menu-item="scope"><slot name="menu-item" v-bind="scope" /></template>
            <template v-if="$slots['suggestion-item']" #suggestion-item="scope"><slot name="suggestion-item" v-bind="scope" /></template>
            <template v-if="$slots.mention" #mention="scope"><slot name="mention" v-bind="scope" /></template>
            <template v-if="$slots['composer-after-input']" #after-input><slot name="composer-after-input" /></template>
            <template v-if="$slots['composer-after']" #after><slot name="composer-after" /></template>
          </CodexComposer>
          <slot name="after-composer" />
        </footer>
      </template>
    </CodexWorkbenchLayout>
  </section>
</template>

<script setup lang="ts" generic="Payload = unknown">
import { computed, onMounted, ref, watch } from 'vue';
import type {
  CodexConversationRenderStrategy,
  CodexRendererAttachment,
  CodexSurfaceApproval,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfacePlugin,
  CodexSurfaceTurn,
  SurfaceMessage,
  CodexRendererSendMessageOptions,
} from '@codex-app-sdk/core/surface';
import type { CodexHostAttachment } from '@codex-app-sdk/core/native';
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from '../composer-menu';
import type {
  CodexConversationPaneActions,
  CodexConversationPaneControllerSource,
  CodexConversationPaneState,
} from '../conversation-pane-controller';
import { resolveCodexConversationPaneValue } from '../conversation-pane-controller';
import type { Message } from '../chat/types';
import type { MessageBlock } from '../chat/message-blocks';
import type {
  CodexMessageImage,
  CodexMessageImageContext,
  CodexMessageImageOpenHandler,
} from '../chat/message-image';
import type {
  CodexConversationVisualization,
  CodexConversationVisualizationOpenHandler,
} from '../chat/visualization';
import { stripMessageContext } from '../chat/message-blocks';
import type { QueuedChatPrompt } from '../chat/queued-prompts';
import { chatMessageFromInput } from '../chat/renderer-message-adapter';
import type {
  CodexContextUsage,
  CodexFileSearchItem,
  ApprovalPreset,
  CodexCapabilities,
  CodexCommandSummary,
  CodexConversationPresentation,
  CodexModelOption,
  CodexSkillSummary,
  ClientRequestResponse,
  CodexChatTranscription,
  CodexConversationLink,
  ReasoningEffort,
  ThreadGoal,
  TurnGitDiff,
} from '../chat/contracts';
import { resolveCodexConversationPresentation } from '../chat/contracts';
import { codexCapabilities } from '../chat/codex-capabilities';
import { codexCommands } from '../chat/codex-commands';
import { codexConversationLinkFromHref } from '../chat/conversation-links';
import {
  ingestCodexAttachments,
  pickCodexAttachments,
  useCodexHostCapabilities,
  type CodexAttachmentIngester,
  type CodexAttachmentPicker,
} from '../native-capabilities';
import type { CodexSurfaceController } from '../use-codex-surface';
import type { CodexComposerState } from '../composer-state';
import type { CodexComposerMentionGroup, CodexComposerMentionItem } from '../chat/composer-mentions-custom';
import { normalizeCodexComposerState } from '../composer-state';
import { useConversationEscapeInterrupt } from '../chat/use-conversation-escape-interrupt';
import { X as XIcon } from '../icons/app-icons';
import ChatComposerShelf from '../chat/ChatComposerShelf.vue';
import CodexComposer from './CodexComposer.vue';
import CodexApprovalPrompt from './CodexApprovalPrompt.vue';
import CodexConversationHistoryLoader from './CodexConversationHistoryLoader.vue';
import CodexMessageList from './CodexMessageList.vue';
import CodexWorkbenchLayout from './CodexWorkbenchLayout.vue';

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  ariaLabel?: string;
  actionsDisabled?: boolean;
  activeTurnId?: string | null;
  answeredClientRequestIds?: ReadonlySet<string>;
  approvals?: readonly CodexSurfaceApproval[];
  approvalPresets?: readonly ApprovalPreset[];
  attachEnabled?: boolean;
  attachments?: readonly CodexHostAttachment[];
  autofocus?: boolean;
  capabilities?: CodexCapabilities;
  /** Controlled state/actions adapter. When supplied, it takes precedence over legacy props and surface state. */
  controller?: CodexConversationPaneControllerSource<Payload>;
  busy?: boolean;
  canDeleteTurn?: boolean;
  canEditTurn?: boolean;
  canForkTurn?: boolean;
  canRetryTurn?: boolean;
  commands?: readonly CodexCommandSummary[];
  composerState?: CodexComposerState;
  contextUsage?: CodexContextUsage | null;
  conversationKey?: string | number | null;
  disabled?: boolean;
  emptyDescription?: string;
  emptyTitle?: string;
  error?: string | null;
  escapeInterrupt?: boolean;
  files?: readonly CodexFileSearchItem[];
  followUpsDisabled?: boolean;
  goal?: ThreadGoal | null;
  hasOlderHistory?: boolean;
  historyLoading?: boolean;
  renderStrategy?: CodexConversationRenderStrategy;
  /** @deprecated Use renderStrategy instead. */
  lazyMessages?: boolean;
  initialMessageBatchSize?: number;
  loadingOlderHistory?: boolean;
  messageBatchSize?: number;
  leadingMenuItems?: readonly CodexComposerMenuItem<Payload>[];
  menuItems?: readonly CodexComposerMenuItem<Payload>[];
  mentionGroups?: readonly CodexComposerMentionGroup<Payload>[];
  messages?: readonly (Message | SurfaceMessage)[];
  turns?: readonly CodexSurfaceTurn[];
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  models?: readonly CodexModelOption[];
  modelValue?: string;
  openImage?: CodexMessageImageOpenHandler;
  openConversationLink?: (link: CodexConversationLink) => void | Promise<void>;
  openVisualization?: CodexConversationVisualizationOpenHandler;
  pickAttachments?: CodexAttachmentPicker;
  ingestAttachments?: CodexAttachmentIngester;
  placeholder?: string;
  promptHistory?: readonly string[];
  approvalPreset?: ApprovalPreset | null;
  planMode?: boolean;
  plugins?: readonly CodexSurfacePlugin[];
  presentation?: CodexConversationPresentation;
  queuedPrompts?: readonly QueuedChatPrompt[];
  selectedModelId?: string | null;
  selectedReasoningEffort?: ReasoningEffort | null;
  selectedServiceTier?: string | null;
  scrollToBottomLabel?: string;
  showToolDetails?: boolean;
  skillCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  skills?: readonly CodexSkillSummary[];
  surface?: CodexSurfaceController;
  transformMessage?: (message: Message | SurfaceMessage, index: number) => Message | SurfaceMessage;
  transcribeAudio?: CodexChatTranscription;
  turnGitDiff?: TurnGitDiff | null;
}>(), {
  ariaLabel: 'Conversation',
  attachEnabled: true,
  attachments: () => [],
  escapeInterrupt: true,
  autofocus: false,
  busy: undefined,
  canDeleteTurn: true,
  canEditTurn: true,
  canForkTurn: false,
  canRetryTurn: true,
  disabled: undefined,
  emptyDescription: '',
  emptyTitle: 'Start a conversation with Codex',
  historyLoading: undefined,
  lazyMessages: undefined,
  initialMessageBatchSize: 50,
  leadingMenuItems: () => [],
  messageBatchSize: 25,
  menuItems: () => [],
  modelValue: '',
  placeholder: 'Ask Codex…',
  planMode: undefined,
  showToolDetails: undefined,
  scrollToBottomLabel: 'Scroll to bottom',
});

defineSlots<{
  'after-composer'(): unknown;
  approval(props: { approval: CodexSurfaceApproval }): unknown;
  'before-composer'(): unknown;
  'composer-after'(): unknown;
  'composer-after-input'(): unknown;
  'composer-attachment-actions'(props: {
    attachments: readonly CodexHostAttachment[];
    disabled: boolean;
    index: number;
  }): unknown;
  empty(props: { description: string; title: string }): unknown;
  'menu-icon'(props: { item: CodexComposerMenuItem<Payload> }): unknown;
  'menu-item'(props: { item: CodexComposerMenuItem<Payload> }): unknown;
  mention(props: {
    group: CodexComposerMentionGroup;
    item: CodexComposerMentionItem;
    surface: 'composer' | 'message';
  }): unknown;
  'suggestion-item'(props: {
    active: boolean;
    group: CodexComposerMentionGroup;
    item: CodexComposerMentionItem;
    surface: string;
  }): unknown;
  message(props: { index: number; message: Message }): unknown;
  'message-actions'(props: { disabled: boolean; index: number; message: Message }): unknown;
  'message-attachment'(props: {
    attachment: Extract<MessageBlock, { type: 'attachment' }>['attachment'];
    block: Extract<MessageBlock, { type: 'attachment' }>;
    index: number;
    message: Message;
  }): unknown;
  'message-block'(props: { block: MessageBlock; blockIndex: number; index: number; message: Message }): unknown;
  'message-header'(props: { index: number; message: Message }): unknown;
  'message-status'(props: { index: number; message: Message; status: 'streaming' }): unknown;
  'message-text'(props: { block: Extract<MessageBlock, { type: 'text' | 'user-text' }>; content: string; index: number; message: Message; user: boolean }): unknown;
  'message-thinking'(props: { index: number; message: Message }): unknown;
  'message-tool'(props: {
    block: Extract<MessageBlock, { type: 'tool' | 'tool-group' }>;
    index: number;
    message: Message;
    toolCall?: Extract<MessageBlock, { type: 'tool' }>['toolCall'];
    toolCalls?: Extract<MessageBlock, { type: 'tool-group' }>['toolCalls'];
  }): unknown;
}>();

const emit = defineEmits<{
  attach: [];
  attachmentsChange: [attachments: readonly CodexHostAttachment[]];
  cancel: [];
  clientResponse: [response: ClientRequestResponse];
  copyMessage: [index: number];
  clearGoal: [];
  deleteTurn: [turnId: string];
  deleteQueuedPrompt: [promptId: string];
  updateQueuedPrompt: [promptId: string, prompt: string];
  editGoal: [];
  editTurn: [payload: { content: string; turnId: string }];
  forkTurn: [turnId: string];
  loadOlderHistory: [];
  error: [message: string | null];
  interrupt: [];
  menuSelect: [item: CodexComposerMenuSelectableItem<Payload>];
  mentionSelect: [item: CodexComposerMentionItem<Payload>, group: CodexComposerMentionGroup<Payload>];
  openLink: [link: CodexConversationLink];
  openVisualization: [visualization: CodexConversationVisualization];
  resolveApproval: [
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope: CodexSurfaceApprovalScope,
  ];
  quoteMessage: [index: number];
  retryTurn: [turnId: string];
  selectApprovalPreset: [preset: ApprovalPreset];
  sendFollowUp: [prompt: string];
  submit: [prompt: string, options?: CodexRendererSendMessageOptions];
  steer: [prompt: string, options?: CodexRendererSendMessageOptions];
  steerQueuedPrompt: [promptId: string, prompt?: string];
  'update:modelId': [modelId: string];
  'update:composerState': [state: CodexComposerState];
  'update:modelValue': [value: string];
  'update:planMode': [enabled: boolean];
  'update:reasoningEffort': [reasoningEffort: ReasoningEffort];
  'update:serviceTier': [serviceTier: string | null];
}>();
// Stryker restore all

const hostCapabilities = useCodexHostCapabilities();

const composer = ref<{ focus(): void } | null>(null);
const paneElement = ref<HTMLElement | null>(null);
const effectiveController = computed(() => resolveCodexConversationPaneValue(props.controller));
const effectiveControllerState = computed<CodexConversationPaneState | undefined>(() => {
  const controller = effectiveController.value;
  return controller ? resolveCodexConversationPaneValue(controller.state) : undefined;
});
const effectiveControllerActions = computed<CodexConversationPaneActions<Payload> | undefined>(() => {
  const controller = effectiveController.value;
  return controller ? resolveCodexConversationPaneValue(controller.actions) : undefined;
});
const surfaceState = computed(() => props.surface?.state);
function controlledValue<T>(read: (state: CodexConversationPaneState) => T, fallback: () => T): T {
  const state = effectiveControllerState.value;
  return state ? read(state) : fallback();
}

const effectiveComposerState = computed(() => controlledValue(
  (state) => state.composer?.state,
  () => props.composerState,
));
const effectiveAttachments = computed(() => controlledValue(
  (state) => state.composer?.attachments ?? [],
  () => props.attachments,
));
const initialComposerState = normalizeCodexComposerState(effectiveComposerState.value ?? (
  effectiveControllerState.value
    ? { text: '', selectionStart: 0, selectionEnd: 0 }
    : {
      text: props.modelValue,
      selectionStart: props.modelValue.length,
      selectionEnd: props.modelValue.length,
    }
));
const localComposerState = ref<CodexComposerState>(initialComposerState);
const localDraft = ref(initialComposerState.text);
const editingQueuedPromptId = ref<string | null>(null);
const deletingTurnId = ref<string | null>(null);
type PendingControlledSubmission = {
  adoptedConversationKey: string | number | null;
  hasAdoptedConversationKey: boolean;
  message: SurfaceMessage;
  originConversationKey: string | number | null;
  prompt: string;
};
const pendingControlledSubmission = ref<PendingControlledSubmission | null>(null);
let optimisticSubmissionSequence = 0;
let deleteOperation = 0;
const localError = ref<string | null>(null);
const selectedAttachments = ref<CodexHostAttachment[]>([...effectiveAttachments.value]);
const promptHistoryByConversation = new Map<string | number, readonly string[]>();
const loadedPromptHistory = ref<readonly string[]>([]);
const promptHistoryLoading = ref(false);
let promptHistoryRequest = 0;
const authoritativeMessages = computed(() => controlledValue(
  (state) => state.identity.messages,
  () => props.messages ?? surfaceState.value?.messages ?? [],
));
const effectiveMessages = computed<readonly (Message | SurfaceMessage)[]>(() => {
  const messages = authoritativeMessages.value;
  const pending = pendingControlledSubmission.value;
  if (!pending || messages.some((message) => matchesPendingSubmission(message, pending))) return messages;
  return [...messages, pending.message];
});
const effectiveActiveTurnId = computed(() => controlledValue(
  (state) => state.identity.activeTurnId,
  () => (props.activeTurnId !== undefined ? props.activeTurnId : surfaceState.value?.activeTurnId),
));
const effectiveTurns = computed(() => controlledValue(
  (state) => state.identity.turns,
  () => props.turns ?? surfaceState.value?.turns ?? [],
));
const visiblePromptHistory = computed(() => effectiveMessages.value.flatMap((message) => {
  const chatMessage = chatMessageFromInput(message);
  if (chatMessage.role !== 'user') return [];
  const content = stripMessageContext(chatMessage.content);
  return content && content !== '(no user instructions)' ? [content] : [];
}));
const configuredPromptHistory = computed(() => controlledValue(
  (state) => state.composer?.promptHistory,
  () => props.promptHistory,
));
const effectivePromptHistory = computed(() => mergePromptHistories(
  configuredPromptHistory.value ?? loadedPromptHistory.value,
  visiblePromptHistory.value,
));
const effectiveAnsweredClientRequestIds = computed(() => controlledValue(
  (state) => state.thread?.answeredClientRequestIds,
  () => props.answeredClientRequestIds ?? props.surface?.answeredClientRequestIds,
));
const effectiveApprovals = computed(() => controlledValue(
  (state) => state.thread?.approvals ?? [],
  () => props.approvals ?? surfaceState.value?.approvals ?? [],
));
const effectiveBusy = computed(() => controlledValue(
  (state) => state.identity.busy ?? false,
  () => props.busy ?? surfaceState.value?.busy ?? false,
));
const effectiveTranscriptBusy = computed(() => (
  effectiveBusy.value || pendingControlledSubmission.value !== null
));
const {
  armed: escapeInterruptArmed,
  clear: clearEscapeInterruptArm,
} = useConversationEscapeInterrupt({
  root: paneElement,
  busy: () => effectiveBusy.value,
  enabled: () => props.escapeInterrupt,
  onInterrupt: interrupt,
});
const effectiveConversationKey = computed(() => controlledValue(
  (state) => state.identity.conversationKey,
  () => (props.conversationKey !== undefined ? props.conversationKey : surfaceState.value?.activeConversationId),
));
const effectiveContextUsage = computed(() => controlledValue(
  (state) => state.thread?.contextUsage,
  () => (props.contextUsage !== undefined ? props.contextUsage : surfaceState.value?.contextUsage),
));
const effectiveDisabled = computed(() => controlledValue(
  (state) => state.identity.disabled ?? false,
  () => props.disabled ?? (surfaceState.value ? surfaceState.value.status !== 'ready' : false),
));
const effectiveError = computed(() => (
  localError.value
  ?? controlledValue(
    (state) => state.identity.error,
    () => props.error ?? surfaceState.value?.error ?? null,
  )
  ?? null
));
const effectiveGoal = computed(() => controlledValue(
  (state) => state.thread?.goal ?? null,
  () => (props.goal !== undefined ? props.goal : surfaceState.value?.goal ?? null),
));
const effectiveHistoryLoading = computed(() => controlledValue(
  (state) => state.history?.loading ?? false,
  () => props.historyLoading ?? surfaceState.value?.historyLoading ?? false,
));
const effectiveRenderStrategy = computed<CodexConversationRenderStrategy>(() => (
  props.renderStrategy ?? (props.lazyMessages === false ? 'eager' : 'lazy')
));
const effectiveHasOlderHistory = computed(() => controlledValue(
  (state) => state.history?.hasOlder ?? false,
  () => props.hasOlderHistory ?? surfaceState.value?.historyState?.hasOlder ?? false,
));
const effectiveLoadingOlderHistory = computed(() => controlledValue(
  (state) => state.history?.loadingOlder ?? false,
  () => props.loadingOlderHistory ?? surfaceState.value?.historyState?.loadingOlder ?? false,
));
const effectiveModelCatalogStatus = computed(() => controlledValue(
  (state) => state.catalogs?.modelCatalogStatus,
  () => props.modelCatalogStatus ?? surfaceState.value?.modelCatalogStatus,
));
const effectiveModels = computed(() => controlledValue(
  (state) => state.catalogs?.models,
  () => props.models ?? surfaceState.value?.models,
));
const effectiveApprovalPreset = computed(() => controlledValue(
  (state) => state.composer?.approvalPreset,
  () => (props.approvalPreset !== undefined ? props.approvalPreset : surfaceState.value?.approvalPreset),
));
const effectivePlanMode = computed(() => controlledValue(
  (state) => state.composer?.planMode,
  () => props.planMode ?? surfaceState.value?.planMode,
));
const effectivePlugins = computed(() => controlledValue(
  (state) => state.catalogs?.plugins,
  () => props.plugins ?? surfaceState.value?.plugins,
));
const effectiveMentionGroups = computed(() => controlledValue(
  (state) => state.catalogs?.mentionGroups,
  () => props.mentionGroups,
) as readonly CodexComposerMentionGroup<Payload>[] | undefined);
const effectivePresentation = computed(() => resolveCodexConversationPresentation(props.presentation));
const effectiveQueuedPrompts = computed(() => controlledValue(
  (state) => state.thread?.queuedPrompts ?? [],
  () => props.queuedPrompts ?? surfaceState.value?.queuedPrompts ?? [],
));
const effectiveSelectedModelId = computed(() => controlledValue(
  (state) => state.composer?.selectedModelId,
  () => (props.selectedModelId !== undefined ? props.selectedModelId : surfaceState.value?.selectedModelId),
));
const effectiveSelectedReasoningEffort = computed(() => controlledValue(
  (state) => state.composer?.selectedReasoningEffort,
  () => (props.selectedReasoningEffort !== undefined
    ? props.selectedReasoningEffort
    : surfaceState.value?.selectedReasoningEffort),
));
const effectiveSelectedServiceTier = computed(() => controlledValue(
  (state) => state.composer?.selectedServiceTier,
  () => (props.selectedServiceTier !== undefined
    ? props.selectedServiceTier
    : surfaceState.value?.selectedServiceTier),
));
const effectiveSkillCatalogStatus = computed(() => controlledValue(
  (state) => state.catalogs?.skillCatalogStatus,
  () => props.skillCatalogStatus ?? surfaceState.value?.skillCatalogStatus,
));
const effectiveSkills = computed(() => controlledValue(
  (state) => state.catalogs?.skills,
  () => props.skills ?? surfaceState.value?.skills,
));
const effectiveTurnGitDiff = computed(() => controlledValue(
  (state) => state.thread?.turnGitDiff,
  () => (props.turnGitDiff !== undefined ? props.turnGitDiff : surfaceState.value?.turnGitDiff),
));
const effectiveAttachEnabled = computed(() => controlledValue(
  (state) => state.policy?.attachEnabled ?? true,
  () => props.attachEnabled !== false,
));
const effectiveCapabilities = computed<CodexCapabilities>(() => ({
  ...codexCapabilities,
  ...(effectiveControllerState.value
    ? effectiveControllerState.value.capabilities
    : props.capabilities),
  approvalPresets: effectiveControllerState.value?.capabilities?.approvalPresets
    ?? (effectiveControllerState.value
      ? codexCapabilities.approvalPresets
      : props.approvalPresets ?? surfaceState.value?.approvalPresets ?? props.capabilities?.approvalPresets)
    ?? codexCapabilities.approvalPresets,
}));
const effectiveCommands = computed(() => controlledValue(
  (state) => state.catalogs?.commands ?? [],
  () => props.commands ?? codexCommands,
));
const effectiveFiles = computed(() => controlledValue(
  (state) => state.catalogs?.files ?? [],
  () => props.files,
));
const effectiveLeadingMenuItems = computed(() => controlledValue(
  (state) => state.composer?.leadingMenuItems ?? [],
  () => props.leadingMenuItems,
));
const effectiveMenuItems = computed(() => controlledValue(
  (state) => state.composer?.menuItems ?? [],
  () => props.menuItems,
));
const effectivePlaceholder = computed(() => controlledValue(
  (state) => state.composer?.placeholder,
  () => props.placeholder,
) ?? 'Ask Codex…');
const effectiveCanDeleteTurn = computed(() => controlledValue(
  (state) => state.policy?.canDeleteTurn ?? true,
  () => props.canDeleteTurn,
));
const effectiveCanEditTurn = computed(() => controlledValue(
  (state) => state.policy?.canEditTurn ?? true,
  () => props.canEditTurn,
));
const effectiveCanForkTurn = computed(() => controlledValue(
  (state) => state.policy?.canForkTurn ?? false,
  () => props.canForkTurn,
));
const effectiveCanRetryTurn = computed(() => controlledValue(
  (state) => state.policy?.canRetryTurn ?? true,
  () => props.canRetryTurn,
));
const effectiveActionsDisabled = computed(() => (
  controlledValue((state) => state.policy?.actionsDisabled ?? false, () => props.actionsDisabled ?? false)
));
const effectiveFollowUpsDisabled = computed(() => (
  effectiveBusy.value
  || controlledValue((state) => state.policy?.followUpsDisabled ?? false, () => props.followUpsDisabled ?? false)
));
const showHistoryLoader = computed(() => effectiveHistoryLoading.value);
const started = computed(() => (
  effectiveMessages.value.length > 0 || effectiveBusy.value || effectiveApprovals.value.length > 0
));

watch(() => props.modelValue, () => {
  if (effectiveController.value || props.composerState) return;
  localDraft.value = props.modelValue;
  localComposerState.value = {
    text: props.modelValue,
    selectionStart: props.modelValue.length,
    selectionEnd: props.modelValue.length,
  };
});

watch(effectiveComposerState, (state) => {
  if (!state) return;
  const normalized = normalizeCodexComposerState(state);
  localComposerState.value = normalized;
  localDraft.value = normalized.text;
}, { deep: true });

watch(effectiveAttachments, (attachments) => {
  selectedAttachments.value = [...attachments];
});

watch(effectiveAttachEnabled, (enabled) => {
  if (!enabled && selectedAttachments.value.length > 0) replaceAttachments([]);
});

watch(effectiveConversationKey, (conversationKey, previousConversationKey) => {
  const pending = pendingControlledSubmission.value;
  if (pending) {
    if (
      !pending.hasAdoptedConversationKey
      && (previousConversationKey ?? null) === pending.originConversationKey
    ) {
      pendingControlledSubmission.value = {
        ...pending,
        adoptedConversationKey: conversationKey ?? null,
        hasAdoptedConversationKey: true,
      };
    } else if (
      (conversationKey ?? null) !== pending.originConversationKey
      && (conversationKey ?? null) !== pending.adoptedConversationKey
    ) {
      pendingControlledSubmission.value = null;
    }
  }
  deleteOperation += 1;
  deletingTurnId.value = null;
  clearEscapeInterruptArm();
  editingQueuedPromptId.value = null;
  localError.value = null;
  const incoming = normalizeCodexComposerState(effectiveComposerState.value ?? (
    effectiveController.value
      ? { text: '', selectionStart: 0, selectionEnd: 0 }
      : {
        text: props.modelValue,
        selectionStart: props.modelValue.length,
        selectionEnd: props.modelValue.length,
      }
  ));
  localComposerState.value = incoming;
  localDraft.value = incoming.text;
});

watch(authoritativeMessages, (messages) => {
  const pending = pendingControlledSubmission.value;
  if (!pending) return;
  if (messages.some((message) => matchesPendingSubmission(message, pending))) {
    pendingControlledSubmission.value = null;
    return;
  }
  if (pending.hasAdoptedConversationKey && messages.length > 0) {
    pendingControlledSubmission.value = null;
  }
});

watch([effectiveMessages, effectiveTurns], () => {
  const turnId = deletingTurnId.value;
  if (!turnId) return;
  const turnStillPresent = effectiveTurns.value?.some((turn) => turn.id === turnId)
    || effectiveMessages.value.some((message) => chatMessageFromInput(message).turnId === turnId);
  if (turnStillPresent) return;
  deleteOperation += 1;
  deletingTurnId.value = null;
});

watch(effectiveQueuedPrompts, (prompts) => {
  const editingId = editingQueuedPromptId.value;
  if (editingId && !prompts.some((prompt) => prompt.id === editingId)) {
    editingQueuedPromptId.value = null;
  }
});

watch([
  effectiveConversationKey,
  () => surfaceState.value?.activeConversationId,
  () => effectiveControllerActions.value?.readPromptHistory,
  configuredPromptHistory,
], () => { void loadPromptHistory(); }, { immediate: true });

watch(() => [surfaceState.value?.status, surfaceState.value?.error] as const, ([status, error]) => {
  if (status === 'ready' && error == null) localError.value = null;
});

onMounted(() => {
  if (props.surface && props.surface.state.status === 'idle') {
    void runSurfaceAction(() => props.surface!.connect());
  }
});

async function loadPromptHistory(): Promise<void> {
  const request = ++promptHistoryRequest;
  const key = effectiveConversationKey.value;
  promptHistoryLoading.value = false;
  loadedPromptHistory.value = [];
  if (key == null || configuredPromptHistory.value !== undefined) return;

  const cached = promptHistoryByConversation.get(key);
  if (cached) {
    loadedPromptHistory.value = cached;
    return;
  }

  const controlledLoader = effectiveControllerActions.value?.readPromptHistory;
  const surface = props.surface;
  const conversationId = surfaceState.value?.activeConversationId;
  if (!controlledLoader && !conversationId) return;

  promptHistoryLoading.value = true;
  try {
    const prompts = controlledLoader
      ? await controlledLoader()
      : (await surface!.readConversationPromptHistory(conversationId!)).prompts;
    if (request !== promptHistoryRequest || effectiveConversationKey.value !== key) return;
    const bounded = [...prompts].slice(-100);
    promptHistoryByConversation.set(key, bounded);
    loadedPromptHistory.value = bounded;
  } catch {
    // Prompt recall is an optional enhancement; visible messages remain usable.
  } finally {
    if (request === promptHistoryRequest) promptHistoryLoading.value = false;
  }
}

function mergePromptHistories(
  older: readonly string[],
  visible: readonly string[],
): readonly string[] {
  const maximumOverlap = Math.min(older.length, visible.length);
  let overlap = maximumOverlap;
  while (overlap > 0) {
    const olderStart = older.length - overlap;
    if (visible.slice(0, overlap).every((prompt, index) => prompt === older[olderStart + index])) break;
    overlap -= 1;
  }
  return [...older, ...visible.slice(overlap)].slice(-100);
}

function submit(prompt: string, composerOptions?: Pick<CodexRendererSendMessageOptions, 'inputMethod'>): void {
  updateDraft('');
  const queuedPromptId = editingQueuedPromptId.value;
  if (queuedPromptId) {
    editingQueuedPromptId.value = null;
    updateQueuedPrompt(queuedPromptId, prompt);
    replaceAttachments([]);
    return;
  }
  const options = sendOptionsForAttachments(selectedAttachments.value, composerOptions);
  if (effectiveController.value) {
    const controlledSubmit = effectiveControllerActions.value?.submit;
    if (controlledSubmit) {
      const optimisticMessageId = beginControlledSubmission(prompt, selectedAttachments.value);
      void runSurfaceAction(
        () => Promise.resolve(controlledSubmit(prompt, options)),
        () => clearPendingControlledSubmission(optimisticMessageId),
      );
    }
    replaceAttachments([]);
    return;
  }
  if (options) emit('submit', prompt, options);
  else emit('submit', prompt);
  if (props.surface) {
    void runSurfaceAction(() => props.surface!.sendMessage(prompt, options));
  }
  replaceAttachments([]);
}

function beginControlledSubmission(
  prompt: string,
  attachments: readonly CodexHostAttachment[],
): string | null {
  if (effectiveBusy.value || authoritativeMessages.value.length > 0) return null;
  const id = `codex-optimistic-user-${++optimisticSubmissionSequence}`;
  pendingControlledSubmission.value = {
    adoptedConversationKey: null,
    hasAdoptedConversationKey: false,
    originConversationKey: effectiveConversationKey.value ?? null,
    prompt,
    message: {
      id,
      role: 'user',
      status: 'complete',
      createdAt: new Date().toISOString(),
      parts: [
        { type: 'text', text: prompt },
        ...attachments.map((attachment) => ({
          type: 'attachment' as const,
          attachment: {
            kind: attachment.type,
            name: attachment.name,
            mimeType: attachment.mimeType,
            ...(attachment.previewUrl ? { url: attachment.previewUrl } : {}),
          },
        })),
      ],
    },
  };
  return id;
}

function matchesPendingSubmission(
  message: Message | SurfaceMessage,
  pending: PendingControlledSubmission,
): boolean {
  const candidate = chatMessageFromInput(message);
  return candidate.role === 'user' && stripMessageContext(candidate.content) === pending.prompt;
}

function clearPendingControlledSubmission(messageId: string | null): void {
  if (messageId && pendingControlledSubmission.value?.message.id === messageId) {
    pendingControlledSubmission.value = null;
  }
}

function loadOlderHistory(): void {
  if (dispatchControllerAction('loadOlderHistory')) return;
  if (effectiveController.value) return;
  if (props.surface && effectiveConversationKey.value) {
    void runSurfaceAction(() => props.surface!.loadOlderConversationHistory(String(effectiveConversationKey.value)));
    return;
  }
  emit('loadOlderHistory');
}

function quoteMessage(index: number): void {
  const message = effectiveMessages.value[index];
  if (!message) return;
  const chatMessage = chatMessageFromInput(message);
  const content = stripMessageContext(chatMessage.content);
  if (chatMessage.role !== 'user' || !content) return;
  updateDraft(content);
  if (dispatchControllerAction('quoteMessage', index)) return;
  if (effectiveController.value) return;
  emit('quoteMessage', index);
}

function editGoal(): void {
  if (!effectiveGoal.value?.objective.trim()) return;
  updateDraft(`/goal ${effectiveGoal.value.objective}`);
  if (dispatchControllerAction('editGoal')) return;
  if (effectiveController.value) return;
  emit('editGoal');
}

function handleConversationClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest('a[href]');
  if (!anchor) return;

  const href = anchor.getAttribute('href')?.trim() ?? '';
  if (!href || href.startsWith('#')) return;

  event.preventDefault();
  const link = codexConversationLinkFromHref(href);
  if (!link) return;
  handleConversationLink(link);
}

function handleConversationLink(link: CodexConversationLink): void {
  if (dispatchControllerAction('openLink', link)) return;
  if (effectiveController.value) return;
  emit('openLink', link);
  if (props.openConversationLink) {
    void Promise.resolve(props.openConversationLink(link)).catch(setLocalError);
    return;
  }
  if (link.kind === 'external') {
    if (hostCapabilities) void hostCapabilities.openExternal(link.href).catch(setLocalError);
    else window.open(link.href, '_blank', 'noopener,noreferrer');
  }
}

function handleVisualization(visualization: CodexConversationVisualization): void {
  if (dispatchControllerAction('openVisualization', visualization)) return;
  if (effectiveController.value) return;
  emit('openVisualization', visualization);
  if (props.openVisualization) {
    void Promise.resolve(props.openVisualization(visualization)).catch(setLocalError);
  }
}

async function openImage(
  image: CodexMessageImage,
  context?: CodexMessageImageContext,
): Promise<boolean> {
  const handler = effectiveController.value
    ? effectiveControllerActions.value?.openImage
    : props.openImage;
  if (!handler) return false;
  localError.value = null;
  try {
    return await handler(image, context) !== false;
  } catch (error) {
    setLocalError(error);
    return true;
  }
}

async function selectAttachments(): Promise<void> {
  if (dispatchControllerAction('attach')) return;
  if (!effectiveController.value) emit('attach');
  if (!effectiveAttachEnabled.value) return;
  try {
    appendAttachments(await pickCodexAttachments(props.pickAttachments, hostCapabilities));
  } catch (error) {
    setLocalError(error);
  }
}

function handleDragOver(event: DragEvent): void {
  if (effectiveAttachEnabled.value && event.dataTransfer?.types.includes('Files')) event.preventDefault();
}

function handleDrop(event: DragEvent): void {
  if (!effectiveAttachEnabled.value) return;
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length === 0) return;
  event.preventDefault();
  void ingestFiles(files);
}

function handlePaste(event: ClipboardEvent): void {
  const images = clipboardFiles(event).filter((file) => file.type.startsWith('image/'));
  if (images.length === 0) return;
  // Never let Chromium insert clipboard image HTML into the contenteditable.
  // The composer inserts accompanying plain text while this pane owns the one
  // attachment-ingestion path.
  event.preventDefault();
  if (!effectiveAttachEnabled.value) return;
  void ingestFiles(images);
}

function clipboardFiles(event: ClipboardEvent): File[] {
  const clipboard = event.clipboardData;
  if (!clipboard) return [];
  const files = [...clipboard.files];
  if (files.length > 0) return files;
  return [...(clipboard.items ?? [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

async function ingestFiles(files: readonly File[]): Promise<void> {
  try {
    appendAttachments(await ingestCodexAttachments(files, props.ingestAttachments, hostCapabilities));
  } catch (error) {
    setLocalError(error);
  }
}

function appendAttachments(attachments: readonly CodexHostAttachment[]): void {
  const byReference = new Map(selectedAttachments.value.map((attachment) => [attachment.reference, attachment]));
  for (const attachment of attachments) byReference.set(attachment.reference, attachment);
  replaceAttachments([...byReference.values()].slice(0, 20));
}

function removeAttachment(id: string): void {
  replaceAttachments(selectedAttachments.value.filter((attachment) => attachment.id !== id));
}

function replaceAttachments(attachments: CodexHostAttachment[]): void {
  selectedAttachments.value = attachments;
  if (dispatchControllerAction('updateAttachments', attachments)) return;
  if (effectiveController.value) return;
  emit('attachmentsChange', attachments);
}

function sendOptionsForAttachments(
  attachments: readonly CodexHostAttachment[],
  composerOptions?: Pick<CodexRendererSendMessageOptions, 'inputMethod'>,
): CodexRendererSendMessageOptions | undefined {
  if (attachments.length === 0) return composerOptions;
  const surfaceAttachments: CodexRendererAttachment[] = attachments.map((attachment) => (
    attachment.type === 'image'
      ? {
        type: 'image',
        reference: attachment.reference,
      }
      : {
        type: 'file', reference: attachment.reference,
      }
  ));
  return { ...composerOptions, attachments: surfaceAttachments };
}

function updateDraft(value: string): void {
  updateComposerState({ text: value, selectionStart: value.length, selectionEnd: value.length });
}

function updateComposerState(state: CodexComposerState): void {
  const normalized = normalizeCodexComposerState(state);
  localComposerState.value = normalized;
  localDraft.value = normalized.text;
  if (dispatchControllerAction('updateComposerState', normalized)) return;
  if (effectiveController.value) return;
  emit('update:modelValue', normalized.text);
  emit('update:composerState', normalized);
}

function cancel(): void {
  if (dispatchControllerAction('cancel')) return;
  if (effectiveController.value) return;
  emit('cancel');
  if (props.surface) void runSurfaceAction(() => props.surface!.interrupt());
}

function respondToClientRequest(response: ClientRequestResponse): void {
  if (dispatchControllerAction('clientResponse', response)) return;
  if (effectiveController.value) return;
  emit('clientResponse', response);
  if (props.surface) void runSurfaceAction(() => props.surface!.respondToClientRequest(response));
}

function copyMessage(index: number): void {
  if (dispatchControllerAction('onMessageCopied', index)) return;
  if (effectiveController.value) return;
  emit('copyMessage', index);
}

async function deleteTurn(turnId: string): Promise<void> {
  if (deletingTurnId.value !== null) return;
  const controlledAction = effectiveControllerActions.value?.deleteTurn;
  if (effectiveController.value && !controlledAction) return;

  const operation = ++deleteOperation;
  let waitForControlledState = false;
  deletingTurnId.value = turnId;
  try {
    if (controlledAction) {
      localError.value = null;
      let result: void | Promise<void>;
      try {
        result = controlledAction(turnId);
      } catch (error) {
        setLocalError(error);
        return;
      }
      if (result === undefined) {
        waitForControlledState = true;
        return;
      }
      await runSurfaceAction(() => result);
      return;
    }
    emit('deleteTurn', turnId);
    if (props.surface) {
      await runSurfaceAction(() => props.surface!.deleteTurn(turnId));
    }
  } finally {
    if (!waitForControlledState && deleteOperation === operation) deletingTurnId.value = null;
  }
}

function editTurn(payload: { content: string; turnId: string }): void {
  if (dispatchControllerAction('editTurn', payload)) return;
  if (effectiveController.value) return;
  emit('editTurn', payload);
  if (props.surface) void runSurfaceAction(() => props.surface!.editTurn(payload.turnId, payload.content));
}

function forkTurn(turnId: string): void {
  if (dispatchControllerAction('forkTurn', turnId)) return;
  if (effectiveController.value) return;
  emit('forkTurn', turnId);
  if (props.surface) void runSurfaceAction(() => props.surface!.forkTurn(turnId));
}

function retryTurn(turnId: string): void {
  if (dispatchControllerAction('retryTurn', turnId)) return;
  if (effectiveController.value) return;
  emit('retryTurn', turnId);
  if (props.surface) void runSurfaceAction(() => props.surface!.retryTurn(turnId));
}

function sendFollowUp(prompt: string): void {
  if (dispatchControllerAction('sendFollowUp', prompt)) return;
  if (effectiveController.value) return;
  emit('sendFollowUp', prompt);
  if (props.surface) void runSurfaceAction(() => props.surface!.sendMessage(prompt));
}

function clearGoal(): void {
  if (dispatchControllerAction('clearGoal')) return;
  if (effectiveController.value) return;
  emit('clearGoal');
  if (props.surface) void runSurfaceAction(() => props.surface!.clearGoal());
}

function deleteQueuedPrompt(promptId: string): void {
  if (editingQueuedPromptId.value === promptId) editingQueuedPromptId.value = null;
  if (dispatchControllerAction('deleteQueuedPrompt', promptId)) return;
  if (effectiveController.value) return;
  emit('deleteQueuedPrompt', promptId);
  if (props.surface) void runSurfaceAction(() => props.surface!.deleteQueuedPrompt(promptId));
}

function editQueuedPrompt(promptId: string): void {
  if (localDraft.value.length > 0) return;
  const prompt = effectiveQueuedPrompts.value.find((candidate) => candidate.id === promptId);
  if (!prompt) return;
  editingQueuedPromptId.value = promptId;
  updateDraft(prompt.text);
  composer.value?.focus();
}

function updateQueuedPrompt(promptId: string, prompt: string): void {
  if (dispatchControllerAction('updateQueuedPrompt', promptId, prompt)) return;
  if (effectiveController.value) return;
  emit('updateQueuedPrompt', promptId, prompt);
  if (props.surface) void runSurfaceAction(() => props.surface!.updateQueuedPrompt(promptId, prompt));
}

function steerQueuedPrompt(promptId: string, prompt?: string): void {
  if (editingQueuedPromptId.value === promptId) editingQueuedPromptId.value = null;
  if (prompt === undefined) dispatchControllerAction('steerQueuedPrompt', promptId);
  else dispatchControllerAction('steerQueuedPrompt', promptId, prompt);
  if (effectiveController.value) return;
  if (prompt === undefined) emit('steerQueuedPrompt', promptId);
  else emit('steerQueuedPrompt', promptId, prompt);
  if (props.surface) {
    void runSurfaceAction(() => prompt === undefined
      ? props.surface!.steerQueuedPrompt(promptId)
      : props.surface!.steerQueuedPrompt(promptId, prompt));
  }
}

function interrupt(): void {
  clearEscapeInterruptArm();
  if (dispatchControllerAction('interrupt')) return;
  if (effectiveController.value) return;
  emit('interrupt');
  if (props.surface) void runSurfaceAction(() => props.surface!.interrupt());
}

function steer(prompt: string, composerOptions?: Pick<CodexRendererSendMessageOptions, 'inputMethod'>): void {
  const queuedPromptId = editingQueuedPromptId.value;
  if (queuedPromptId) {
    editingQueuedPromptId.value = null;
    steerQueuedPrompt(queuedPromptId, prompt);
    replaceAttachments([]);
    return;
  }
  const options = sendOptionsForAttachments(selectedAttachments.value, composerOptions);
  const dispatched = dispatchControllerAction('steer', prompt, options);
  if (dispatched || effectiveController.value) {
    replaceAttachments([]);
    return;
  }
  if (options) emit('steer', prompt, options);
  else emit('steer', prompt);
  if (props.surface) void runSurfaceAction(() => props.surface!.steerMessage(prompt, options));
  replaceAttachments([]);
}

function selectApprovalPreset(preset: ApprovalPreset): void {
  if (dispatchControllerAction('selectApprovalPreset', preset)) return;
  if (effectiveController.value) {
    void dispatchControllerAction('updateSettings', { approvalPreset: preset });
    return;
  }
  emit('selectApprovalPreset', preset);
  if (props.surface) void runSurfaceAction(() => props.surface!.updateConversationSettings({ approvalPreset: preset }));
}

function resolveApproval(
  approvalId: string,
  decision: CodexSurfaceApprovalDecision,
  scope: CodexSurfaceApprovalScope,
): void {
  if (dispatchControllerAction('resolveApproval', approvalId, decision, scope)) return;
  if (effectiveController.value) return;
  emit('resolveApproval', approvalId, decision, scope);
  if (props.surface) void runSurfaceAction(() => props.surface!.resolveApproval(approvalId, decision, scope));
}

function updateModelId(modelId: string): void {
  if (dispatchControllerAction('updateSettings', { modelId })) return;
  if (effectiveController.value) return;
  emit('update:modelId', modelId);
  if (props.surface) void runSurfaceAction(() => props.surface!.updateConversationSettings({ modelId }));
}

function updatePlanMode(planMode: boolean): void {
  if (dispatchControllerAction('updateSettings', { planMode })) return;
  if (effectiveController.value) return;
  emit('update:planMode', planMode);
  if (props.surface) void runSurfaceAction(() => props.surface!.updateConversationSettings({ planMode }));
}

function updateReasoningEffort(reasoningEffort: ReasoningEffort): void {
  if (dispatchControllerAction('updateSettings', { reasoningEffort })) return;
  if (effectiveController.value) return;
  emit('update:reasoningEffort', reasoningEffort);
  if (props.surface) void runSurfaceAction(() => props.surface!.updateConversationSettings({ reasoningEffort }));
}

function updateServiceTier(serviceTier: string | null): void {
  if (dispatchControllerAction('updateSettings', { serviceTier })) return;
  if (effectiveController.value) return;
  emit('update:serviceTier', serviceTier);
  if (props.surface) void runSurfaceAction(() => props.surface!.updateConversationSettings({ serviceTier }));
}

function menuSelect(item: CodexComposerMenuSelectableItem<unknown>): void {
  if (dispatchControllerAction('menuSelect', item)) return;
  if (effectiveController.value) return;
  emit('menuSelect', item as CodexComposerMenuSelectableItem<Payload>);
}

function mentionSelect(
  item: CodexComposerMentionItem,
  group: CodexComposerMentionGroup,
): void {
  if (dispatchControllerAction('mentionSelect', item, group)) return;
  if (effectiveController.value) return;
  emit(
    'mentionSelect',
    item as CodexComposerMentionItem<Payload>,
    group as CodexComposerMentionGroup<Payload>,
  );
}

function dispatchControllerAction(
  name: keyof CodexConversationPaneActions<Payload>,
  ...args: unknown[]
): boolean {
  const action = effectiveControllerActions.value?.[name] as
    | ((...actionArgs: never[]) => void | Promise<void>)
    | undefined;
  if (!action) return false;
  void runSurfaceAction(() => Promise.resolve(action(...args as never[])));
  return true;
}

async function runSurfaceAction(action: () => Promise<unknown>, onError?: () => void): Promise<void> {
  localError.value = null;
  try {
    await action();
  } catch (error) {
    onError?.();
    setLocalError(error);
  }
}

function setLocalError(error: unknown): void {
  localError.value = error instanceof Error ? error.message : String(error);
}

function handleComposerError(error: string | null): void {
  localError.value = error;
  emit('error', error);
}

function focusComposer(): void {
  composer.value?.focus();
}

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
defineExpose({ focusComposer });
// Stryker restore all
</script>

<style scoped>
.codex-conversation-pane {
  --codex-conversation-content-width: 860px;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  color: var(--codex-text-color, var(--color-text, #202124));
  background: var(--codex-surface-color, var(--color-shell-main, #fff));
}

.codex-conversation-pane__layout {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  --workbench-layout-footer-padding: var(--space-24) 0 var(--space-12);
  --workbench-layout-footer-background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--color-shell-main) 0%, transparent),
    var(--color-shell-main) 24%
  );
  --workbench-layout-scrollbar-gutter: var(--space-4);
}

.codex-conversation-pane__messages {
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--color-shell-main);
  --codex-scroll-to-bottom-offset: calc(var(--workbench-layout-footer-offset, 0px) - var(--space-12) + 4px);
  --codex-scroll-to-bottom-size: 40px;
  --message-list-content-width: var(--codex-conversation-content-width);
  --message-list-content-padding-top: var(--space-12);
  --message-list-content-padding-bottom: calc(var(--workbench-layout-footer-offset) + var(--space-12));
  --message-list-padding-inline-start: var(--space-8);
  --message-list-padding-inline-end: var(--space-8);
}

.codex-conversation-pane__hero {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  place-items: center;
  padding: var(--space-12) var(--space-16) calc(var(--workbench-layout-footer-offset) + var(--space-12));
}

.codex-conversation-pane__hero-copy {
  display: grid;
  gap: var(--space-2);
  max-width: var(--codex-conversation-content-width);
  text-align: center;
}

.codex-conversation-pane__hero h1,
.codex-conversation-pane__hero p {
  margin: 0;
}

.codex-conversation-pane__hero h1 {
  color: var(--color-text);
  font-size: var(--font-size-24);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-28);
}

.codex-conversation-pane__hero p {
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
}

.codex-conversation-pane__footer {
  display: flex;
  flex-direction: column;
  width: min(calc(100% - var(--space-16) * 2), var(--codex-conversation-content-width));
  margin: 0 auto;
}

.codex-conversation-pane__approvals {
  display: grid;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.codex-conversation-pane__composer-shelf {
  width: 90%;
  margin: 0 auto;
}

.codex-conversation-pane__composer {
  width: 100%;
  margin: 0 auto var(--space-4);
}

.codex-conversation-pane__attachments {
  display: flex;
  gap: var(--space-4);
  width: 100%;
  margin-top: var(--space-2);
  padding: 0;
  overflow-x: auto;
}

.codex-conversation-pane__attachment {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0;
  align-items: center;
  min-width: 0;
  max-width: 240px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-lowest);
}

.codex-conversation-pane__attachment-preview,
.codex-conversation-pane__attachment-file {
  width: 32px;
  height: 32px;
  margin-inline-end: var(--space-3);
  border-radius: var(--radius-md);
}

.codex-conversation-pane__attachment-preview {
  object-fit: cover;
}

.codex-conversation-pane__attachment-file {
  display: grid;
  place-items: center;
  background: var(--color-surface-low);
}

.codex-conversation-pane__attachment-name {
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--font-size-12);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-conversation-pane__attachment-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-inline-start: var(--space-4);
}

.codex-conversation-pane__attachment-remove {
  display: grid;
  width: 24px;
  height: 24px;
  margin-inline-start: calc(-1 * var(--space-3));
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  place-items: center;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
}

.codex-conversation-pane__attachment-remove:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-surface-low);
}

.codex-conversation-pane__attachment-remove svg {
  width: 16px;
  height: 16px;
}

.codex-conversation-pane__history-loader {
  width: min(100%, var(--codex-conversation-content-width));
  margin: 0 auto;
}

.codex-conversation-pane__error {
  margin: 0 0 var(--space-4);
  overflow: hidden;
  color: var(--codex-danger-color, var(--color-error, #b3261e));
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
