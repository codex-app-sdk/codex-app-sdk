<template>
  <section
    class="codex-chat-theme codex-conversation-pane"
    :aria-busy="effectiveBusy || effectiveHistoryLoading"
    :aria-label="ariaLabel"
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
        :answered-client-request-ids="effectiveAnsweredClientRequestIds"
        :aria-label="ariaLabel"
        :can-delete-message="canDeleteMessage"
        :can-edit-message="canEditMessage"
        :can-retry-message="canRetryMessage"
        :empty-label="emptyTitle"
        :follow-ups-disabled="effectiveFollowUpsDisabled"
        :messages="effectiveMessages"
        :reset-key="effectiveConversationKey"
        @cancel="cancel"
        @client-response="respondToClientRequest"
        @copy-message="emit('copyMessage', $event)"
        @delete-message="deleteMessage"
        @edit-message="editMessage"
        @quote-message="quoteMessage"
        @retry-message="retryMessage"
        @send-follow-up="sendFollowUp"
      >
        <template v-if="$slots.message" #message="scope"><slot name="message" v-bind="scope" /></template>
        <template v-if="$slots['message-actions']" #actions="scope"><slot name="message-actions" v-bind="scope" /></template>
        <template v-if="$slots['message-attachment']" #attachment="scope"><slot name="message-attachment" v-bind="scope" /></template>
        <template v-if="$slots['message-block']" #block="scope"><slot name="message-block" v-bind="scope" /></template>
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
            :queued-prompts="effectiveQueuedPrompts"
            :turn-git-diff="effectiveTurnGitDiff"
            @clear-goal="clearGoal"
            @delete-queued-prompt="deleteQueuedPrompt"
            @edit-goal="editGoal"
            @steer-queued-prompt="steerQueuedPrompt"
          />
          <div
            v-if="selectedAttachments.length > 0"
            class="codex-conversation-pane__attachments"
            aria-label="Prompt attachments"
          >
            <div
              v-for="attachment in selectedAttachments"
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
              <span class="codex-conversation-pane__attachment-name" :title="attachment.path">
                {{ attachment.name }}
              </span>
              <button
                type="button"
                class="codex-conversation-pane__attachment-remove"
                :aria-label="`Remove ${attachment.name}`"
                :disabled="effectiveDisabled"
                @click="removeAttachment(attachment.id)"
              >×</button>
            </div>
          </div>
          <CodexComposer
            :key="effectiveConversationKey ?? 'no-conversation'"
            class="codex-conversation-pane__composer"
            :autofocus="autofocus"
            :attach-enabled="effectiveAttachEnabled"
            :capabilities="effectiveCapabilities"
            :commands="effectiveCommands"
            :context-usage="effectiveContextUsage"
            :disabled="effectiveDisabled"
            :draft="localDraft"
            :draft-revision="draftRevision"
            :files="files"
            :is-sending="effectiveBusy"
            :menu-items="menuItems"
            :model-catalog-status="effectiveModelCatalogStatus"
            :models="effectiveModels"
            :placeholder="placeholder"
            :approval-preset="effectiveApprovalPreset"
            :plan-mode="effectivePlanMode"
            :selected-model-id="effectiveSelectedModelId"
            :selected-reasoning-effort="effectiveSelectedReasoningEffort"
            :skill-catalog-status="effectiveSkillCatalogStatus"
            :skills="effectiveSkills"
            :transcribe-audio="transcribeAudio"
            @attach="selectAttachments"
            @interrupt="interrupt"
            @menu-select="emit('menuSelect', $event)"
            @select-approval-preset="selectApprovalPreset"
            @send="submit"
            @steer="steer"
            @update:model-id="updateModelId"
            @update:plan-mode="updatePlanMode"
            @update:reasoning-effort="updateReasoningEffort"
          >
            <template v-if="$slots['menu-icon']" #menu-icon="scope"><slot name="menu-icon" v-bind="scope" /></template>
            <template v-if="$slots['menu-item']" #menu-item="scope"><slot name="menu-item" v-bind="scope" /></template>
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
  CodexSurfaceAttachment,
  CodexSurfaceApproval,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  SurfaceMessage,
  SendCodexMessageOptions,
} from '../../surface/types';
import type { CodexNativeAttachment } from '../../native/types';
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from '../composer-menu';
import type { Message } from '../chat/types';
import type { MessageBlock } from '../chat/message-blocks';
import type { QueuedChatPrompt } from '../chat/queued-prompts';
import { chatMessageFromInput } from '../chat/renderer-message-adapter';
import type {
  CodexContextUsage,
  CodexFileSearchItem,
  ApprovalPreset,
  CodexCapabilities,
  CodexCommandSummary,
  CodexModelOption,
  CodexSkillSummary,
  ClientRequestResponse,
  CodexChatTranscription,
  CodexConversationLink,
  ReasoningEffort,
  ThreadGoal,
  TurnGitDiff,
} from '../chat/contracts';
import { codexCapabilities } from '../chat/codex-capabilities';
import { codexCommands } from '../chat/codex-commands';
import { codexConversationLinkFromHref } from '../chat/conversation-links';
import {
  getCodexNativeRendererApi,
  ingestCodexAttachments,
  pickCodexAttachments,
  type CodexAttachmentIngester,
  type CodexAttachmentPicker,
} from '../native-capabilities';
import type { CodexSurfaceController } from '../use-codex-surface';
import ChatComposerShelf from '../chat/ChatComposerShelf.vue';
import CodexComposer from './CodexComposer.vue';
import CodexApprovalPrompt from './CodexApprovalPrompt.vue';
import CodexConversationHistoryLoader from './CodexConversationHistoryLoader.vue';
import CodexMessageList from './CodexMessageList.vue';
import CodexWorkbenchLayout from './CodexWorkbenchLayout.vue';

const props = withDefaults(defineProps<{
  ariaLabel?: string;
  actionsDisabled?: boolean;
  answeredClientRequestIds?: ReadonlySet<string>;
  approvals?: readonly CodexSurfaceApproval[];
  approvalPresets?: readonly ApprovalPreset[];
  attachEnabled?: boolean;
  attachments?: readonly CodexNativeAttachment[];
  autofocus?: boolean;
  capabilities?: CodexCapabilities;
  busy?: boolean;
  canDeleteMessage?: boolean;
  canEditMessage?: boolean;
  canRetryMessage?: boolean;
  commands?: readonly CodexCommandSummary[];
  contextUsage?: CodexContextUsage | null;
  conversationKey?: string | number | null;
  disabled?: boolean;
  emptyDescription?: string;
  emptyTitle?: string;
  error?: string | null;
  files?: readonly CodexFileSearchItem[];
  followUpsDisabled?: boolean;
  goal?: ThreadGoal | null;
  historyLoading?: boolean;
  menuItems?: readonly CodexComposerMenuItem<Payload>[];
  messages?: readonly (Message | SurfaceMessage)[];
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  models?: readonly CodexModelOption[];
  modelValue?: string;
  openConversationLink?: (link: CodexConversationLink) => void | Promise<void>;
  pickAttachments?: CodexAttachmentPicker;
  ingestAttachments?: CodexAttachmentIngester;
  placeholder?: string;
  approvalPreset?: ApprovalPreset | null;
  planMode?: boolean;
  queuedPrompts?: readonly QueuedChatPrompt[];
  selectedModelId?: string | null;
  selectedReasoningEffort?: ReasoningEffort | null;
  skillCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  skills?: readonly CodexSkillSummary[];
  surface?: CodexSurfaceController;
  transcribeAudio?: CodexChatTranscription;
  turnGitDiff?: TurnGitDiff | null;
}>(), {
  ariaLabel: 'Conversation',
  attachEnabled: true,
  attachments: () => [],
  autofocus: false,
  canDeleteMessage: true,
  canEditMessage: true,
  canRetryMessage: true,
  emptyDescription: '',
  emptyTitle: 'Start a conversation with Codex',
  menuItems: () => [],
  modelValue: '',
  placeholder: 'Ask Codex…',
});

defineSlots<{
  'after-composer'(): unknown;
  approval(props: { approval: CodexSurfaceApproval }): unknown;
  'before-composer'(): unknown;
  'composer-after'(): unknown;
  'composer-after-input'(): unknown;
  empty(props: { description: string; title: string }): unknown;
  'menu-icon'(props: { item: CodexComposerMenuItem<Payload> }): unknown;
  'menu-item'(props: { item: CodexComposerMenuItem<Payload> }): unknown;
  message(props: { index: number; message: Message }): unknown;
  'message-actions'(props: { disabled: boolean; index: number; message: Message }): unknown;
  'message-attachment'(props: {
    attachment: Extract<MessageBlock, { type: 'attachment' }>['attachment'];
    block: Extract<MessageBlock, { type: 'attachment' }>;
    index: number;
    message: Message;
  }): unknown;
  'message-block'(props: { block: MessageBlock; blockIndex: number; index: number; message: Message }): unknown;
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
  attachmentsChange: [attachments: readonly CodexNativeAttachment[]];
  cancel: [];
  clientResponse: [response: ClientRequestResponse];
  copyMessage: [index: number];
  clearGoal: [];
  deleteMessage: [index: number];
  deleteQueuedPrompt: [promptId: string];
  editGoal: [];
  editMessage: [payload: { content: string; index: number }];
  interrupt: [];
  menuSelect: [item: CodexComposerMenuSelectableItem<Payload>];
  openLink: [link: CodexConversationLink];
  resolveApproval: [
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope: CodexSurfaceApprovalScope,
  ];
  quoteMessage: [index: number];
  retryMessage: [index: number];
  selectApprovalPreset: [preset: ApprovalPreset];
  sendFollowUp: [prompt: string];
  submit: [prompt: string, options?: SendCodexMessageOptions];
  steer: [prompt: string];
  steerQueuedPrompt: [promptId: string];
  'update:modelId': [modelId: string];
  'update:modelValue': [value: string];
  'update:planMode': [enabled: boolean];
  'update:reasoningEffort': [reasoningEffort: ReasoningEffort];
}>();

const draftRevision = ref(0);
const localDraft = ref(props.modelValue);
const localError = ref<string | null>(null);
const selectedAttachments = ref<CodexNativeAttachment[]>([...props.attachments]);
const surfaceState = computed(() => props.surface?.state);
const effectiveMessages = computed(() => props.messages ?? surfaceState.value?.messages ?? []);
const effectiveAnsweredClientRequestIds = computed(() => (
  props.answeredClientRequestIds ?? props.surface?.answeredClientRequestIds
));
const effectiveApprovals = computed(() => props.approvals ?? surfaceState.value?.approvals ?? []);
const effectiveBusy = computed(() => props.busy ?? surfaceState.value?.busy ?? false);
const effectiveConversationKey = computed(() => (
  props.conversationKey !== undefined ? props.conversationKey : surfaceState.value?.activeConversationId
));
const effectiveContextUsage = computed(() => (
  props.contextUsage !== undefined ? props.contextUsage : surfaceState.value?.contextUsage
));
const effectiveDisabled = computed(() => (
  props.disabled ?? (surfaceState.value ? surfaceState.value.status !== 'ready' : false)
));
const effectiveError = computed(() => localError.value ?? props.error ?? surfaceState.value?.error ?? null);
const effectiveGoal = computed(() => (
  props.goal !== undefined ? props.goal : surfaceState.value?.goal ?? null
));
const effectiveHistoryLoading = computed(() => (
  props.historyLoading ?? surfaceState.value?.historyLoading ?? false
));
const effectiveModelCatalogStatus = computed(() => (
  props.modelCatalogStatus ?? surfaceState.value?.modelCatalogStatus
));
const effectiveModels = computed(() => props.models ?? surfaceState.value?.models);
const effectiveApprovalPreset = computed(() => (
  props.approvalPreset !== undefined ? props.approvalPreset : surfaceState.value?.approvalPreset
));
const effectivePlanMode = computed(() => props.planMode ?? surfaceState.value?.planMode);
const effectiveQueuedPrompts = computed(() => props.queuedPrompts ?? surfaceState.value?.queuedPrompts ?? []);
const effectiveSelectedModelId = computed(() => (
  props.selectedModelId !== undefined ? props.selectedModelId : surfaceState.value?.selectedModelId
));
const effectiveSelectedReasoningEffort = computed(() => (
  props.selectedReasoningEffort !== undefined
    ? props.selectedReasoningEffort
    : surfaceState.value?.selectedReasoningEffort
));
const effectiveSkillCatalogStatus = computed(() => (
  props.skillCatalogStatus ?? surfaceState.value?.skillCatalogStatus
));
const effectiveSkills = computed(() => props.skills ?? surfaceState.value?.skills);
const effectiveTurnGitDiff = computed(() => (
  props.turnGitDiff !== undefined ? props.turnGitDiff : surfaceState.value?.turnGitDiff
));
const effectiveAttachEnabled = computed(() => props.attachEnabled !== false);
const effectiveCapabilities = computed<CodexCapabilities>(() => ({
  ...codexCapabilities,
  ...props.capabilities,
  approvalPresets: props.approvalPresets
    ?? surfaceState.value?.approvalPresets
    ?? props.capabilities?.approvalPresets
    ?? codexCapabilities.approvalPresets,
}));
const effectiveCommands = computed(() => props.commands ?? codexCommands);
const effectiveActionsDisabled = computed(() => effectiveBusy.value || props.actionsDisabled);
const effectiveFollowUpsDisabled = computed(() => effectiveBusy.value || props.followUpsDisabled);
const showHistoryLoader = computed(() => effectiveHistoryLoading.value);
const started = computed(() => (
  effectiveMessages.value.length > 0 || effectiveBusy.value || effectiveApprovals.value.length > 0
));

watch(() => props.modelValue, () => {
  localDraft.value = props.modelValue;
  draftRevision.value += 1;
}, { immediate: true });

watch(() => props.attachments, (attachments) => {
  selectedAttachments.value = [...attachments];
});

watch(effectiveAttachEnabled, (enabled) => {
  if (!enabled && selectedAttachments.value.length > 0) replaceAttachments([]);
});

watch(effectiveConversationKey, () => {
  localDraft.value = '';
  selectedAttachments.value = [];
  draftRevision.value += 1;
  emit('update:modelValue', '');
  emit('attachmentsChange', []);
});

onMounted(() => {
  if (props.surface && props.surface.state.status === 'idle') {
    void runSurfaceAction(() => props.surface!.connect());
  }
});

function submit(prompt: string): void {
  updateDraft('');
  const options = sendOptionsForAttachments(selectedAttachments.value);
  if (options) emit('submit', prompt, options);
  else emit('submit', prompt);
  if (props.surface) {
    void runSurfaceAction(() => props.surface!.sendMessage(prompt, options));
  }
  replaceAttachments([]);
}

function quoteMessage(index: number): void {
  const message = effectiveMessages.value[index];
  if (!message) return;
  const chatMessage = chatMessageFromInput(message);
  if (chatMessage.role !== 'user' || !chatMessage.content.trim()) return;
  updateDraft(chatMessage.content);
  emit('quoteMessage', index);
}

function editGoal(): void {
  if (!effectiveGoal.value?.objective.trim()) return;
  updateDraft(`/goal ${effectiveGoal.value.objective}`);
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
  emit('openLink', link);
  if (props.openConversationLink) {
    void Promise.resolve(props.openConversationLink(link)).catch(setLocalError);
    return;
  }
  if (link.kind === 'external') {
    const nativeApi = getCodexNativeRendererApi();
    if (nativeApi) void nativeApi.openExternal(link.href).catch(setLocalError);
    else window.open(link.href, '_blank', 'noopener,noreferrer');
  }
}

async function selectAttachments(): Promise<void> {
  emit('attach');
  if (!effectiveAttachEnabled.value) return;
  try {
    appendAttachments(await pickCodexAttachments(props.pickAttachments));
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
  if (!effectiveAttachEnabled.value) return;
  const images = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
  if (images.length === 0) return;
  // Keep the browser's normal text paste behavior when a clipboard contains
  // both text and images; the images are ingested alongside it.
  void ingestFiles(images);
}

async function ingestFiles(files: readonly File[]): Promise<void> {
  if (!effectiveAttachEnabled.value) return;
  try {
    appendAttachments(await ingestCodexAttachments(files, props.ingestAttachments));
  } catch (error) {
    setLocalError(error);
  }
}

function appendAttachments(attachments: readonly CodexNativeAttachment[]): void {
  const byPath = new Map(selectedAttachments.value.map((attachment) => [attachment.path, attachment]));
  for (const attachment of attachments) byPath.set(attachment.path, attachment);
  replaceAttachments([...byPath.values()].slice(0, 20));
}

function removeAttachment(id: string): void {
  replaceAttachments(selectedAttachments.value.filter((attachment) => attachment.id !== id));
}

function replaceAttachments(attachments: CodexNativeAttachment[]): void {
  selectedAttachments.value = attachments;
  emit('attachmentsChange', attachments);
}

function sendOptionsForAttachments(
  attachments: readonly CodexNativeAttachment[],
): SendCodexMessageOptions | undefined {
  if (attachments.length === 0) return undefined;
  const surfaceAttachments: CodexSurfaceAttachment[] = attachments.map((attachment) => (
    attachment.type === 'image'
      ? {
        type: 'image',
        path: attachment.path,
        name: attachment.name,
        mimeType: attachment.mimeType,
        ...(attachment.previewUrl ? { previewUrl: attachment.previewUrl } : {}),
      }
      : {
        type: 'file', path: attachment.path, name: attachment.name, mimeType: attachment.mimeType,
      }
  ));
  return { attachments: surfaceAttachments };
}

function updateDraft(value: string): void {
  localDraft.value = value;
  emit('update:modelValue', value);
  draftRevision.value += 1;
}

function cancel(): void {
  emit('cancel');
  if (props.surface) void runSurfaceAction(() => props.surface!.interrupt());
}

function respondToClientRequest(response: ClientRequestResponse): void {
  emit('clientResponse', response);
  if (props.surface) void runSurfaceAction(() => props.surface!.respondToClientRequest(response));
}

function deleteMessage(index: number): void {
  emit('deleteMessage', index);
  if (props.surface) void runSurfaceAction(() => props.surface!.deleteMessage(index));
}

function editMessage(payload: { content: string; index: number }): void {
  emit('editMessage', payload);
  if (props.surface) void runSurfaceAction(() => props.surface!.editMessage(payload.index, payload.content));
}

function retryMessage(index: number): void {
  emit('retryMessage', index);
  if (props.surface) void runSurfaceAction(() => props.surface!.retryMessage(index));
}

function sendFollowUp(prompt: string): void {
  emit('sendFollowUp', prompt);
  if (props.surface) void runSurfaceAction(() => props.surface!.sendMessage(prompt));
}

function clearGoal(): void {
  emit('clearGoal');
  if (props.surface) void runSurfaceAction(() => props.surface!.clearGoal());
}

function deleteQueuedPrompt(promptId: string): void {
  emit('deleteQueuedPrompt', promptId);
  if (props.surface) void runSurfaceAction(() => props.surface!.deleteQueuedPrompt(promptId));
}

function steerQueuedPrompt(promptId: string): void {
  emit('steerQueuedPrompt', promptId);
  if (props.surface) void runSurfaceAction(() => props.surface!.steerQueuedPrompt(promptId));
}

function interrupt(): void {
  emit('interrupt');
  if (props.surface) void runSurfaceAction(() => props.surface!.interrupt());
}

function steer(prompt: string): void {
  emit('steer', prompt);
  if (props.surface) void runSurfaceAction(() => props.surface!.steerMessage(prompt));
}

function selectApprovalPreset(preset: ApprovalPreset): void {
  emit('selectApprovalPreset', preset);
  if (props.surface) void runSurfaceAction(() => props.surface!.updateConversationSettings({ approvalPreset: preset }));
}

function resolveApproval(
  approvalId: string,
  decision: CodexSurfaceApprovalDecision,
  scope: CodexSurfaceApprovalScope,
): void {
  emit('resolveApproval', approvalId, decision, scope);
  if (props.surface) void runSurfaceAction(() => props.surface!.resolveApproval(approvalId, decision, scope));
}

function updateModelId(modelId: string): void {
  emit('update:modelId', modelId);
  if (props.surface) void runSurfaceAction(() => props.surface!.updateConversationSettings({ modelId }));
}

function updatePlanMode(planMode: boolean): void {
  emit('update:planMode', planMode);
  if (props.surface) void runSurfaceAction(() => props.surface!.updateConversationSettings({ planMode }));
}

function updateReasoningEffort(reasoningEffort: ReasoningEffort): void {
  emit('update:reasoningEffort', reasoningEffort);
  if (props.surface) void runSurfaceAction(() => props.surface!.updateConversationSettings({ reasoningEffort }));
}

async function runSurfaceAction(action: () => Promise<unknown>): Promise<void> {
  localError.value = null;
  try {
    await action();
  } catch (error) {
    setLocalError(error);
  }
}

function setLocalError(error: unknown): void {
  localError.value = error instanceof Error ? error.message : String(error);
}
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
  overflow-y: auto;
  background: var(--color-shell-main);
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
  padding: 0 var(--space-4) var(--space-4);
  overflow-x: auto;
}

.codex-conversation-pane__attachment {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-3);
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

.codex-conversation-pane__attachment-remove {
  display: grid;
  width: 24px;
  height: 24px;
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
