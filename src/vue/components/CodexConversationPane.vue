<template>
  <section class="codex-conversation-pane" :aria-busy="busy">
    <header v-if="title || $slots.header" class="codex-conversation-pane__header">
      <slot name="header" :title="title">
        <h1 class="codex-conversation-pane__title">{{ title }}</h1>
      </slot>
    </header>

    <CodexMessageList
      :actions-disabled="actionsDisabled"
      :answered-client-request-ids="answeredClientRequestIds"
      :aria-label="ariaLabel"
      :can-delete-message="canDeleteMessage"
      :can-edit-message="canEditMessage"
      :can-retry-message="canRetryMessage"
      :empty-label="emptyLabel"
      :follow-ups-disabled="followUpsDisabled"
      :messages="messages"
      @cancel="emit('cancel')"
      @client-response="emit('clientResponse', $event)"
      @copy-message="emit('copyMessage', $event)"
      @delete-message="emit('deleteMessage', $event)"
      @edit-message="emit('editMessage', $event)"
      @quote-message="quoteMessage"
      @review-file="emit('reviewFile', $event)"
      @retry-message="emit('retryMessage', $event)"
      @send-follow-up="emit('sendFollowUp', $event)"
      @undo-change-set="emit('undoChangeSet', $event)"
    >
      <template v-if="$slots.empty" #empty><slot name="empty" /></template>
      <template v-if="$slots.message" #message="scope"><slot name="message" v-bind="scope" /></template>
    </CodexMessageList>

    <p v-if="error" class="codex-conversation-pane__error" role="alert">{{ error }}</p>

    <footer class="codex-conversation-pane__footer">
      <div v-if="approvals.length > 0" class="codex-conversation-pane__approvals">
        <template v-for="approval in approvals" :key="approval.id">
          <slot name="approval" :approval="approval">
            <CodexApprovalPrompt
              :approval="approval"
              :disabled="disabled"
              @resolve="(decision, scope) => emit('resolveApproval', approval.id, decision, scope)"
            />
          </slot>
        </template>
      </div>
      <slot name="before-composer" />
      <ChatComposerShelf
        :goal="goal"
        :queued-prompts="queuedPrompts"
        :turn-git-diff="turnGitDiff"
        @clear-goal="emit('clearGoal')"
        @delete-queued-prompt="emit('deleteQueuedPrompt', $event)"
        @edit-goal="editGoal"
        @steer-queued-prompt="emit('steerQueuedPrompt', $event)"
      />
      <CodexComposer
        :autofocus="autofocus"
        :attach-enabled="attachEnabled"
        :backend-capabilities="backendCapabilities"
        :commands="commands"
        :context-usage="contextUsage"
        :disabled="disabled"
        :draft="modelValue"
        :draft-revision="draftRevision"
        :files="files"
        :is-sending="busy"
        :menu-items="menuItems"
        :model-catalog-status="modelCatalogStatus"
        :models="models"
        :placeholder="placeholder"
        :approval-preset="approvalPreset"
        :plan-mode="planMode"
        :selected-model-id="selectedModelId"
        :selected-reasoning-effort="selectedReasoningEffort"
        :skill-catalog-status="skillCatalogStatus"
        :skills="skills"
        :transcribe-audio="transcribeAudio"
        @attach="emit('attach')"
        @interrupt="emit('interrupt')"
        @menu-select="emit('menuSelect', $event)"
        @select-approval-preset="emit('selectApprovalPreset', $event)"
        @send="submit"
        @steer="emit('steer', $event)"
        @update:model-id="emit('update:modelId', $event)"
        @update:plan-mode="emit('update:planMode', $event)"
        @update:reasoning-effort="emit('update:reasoningEffort', $event)"
      >
        <template v-if="$slots['menu-icon']" #menu-icon="scope"><slot name="menu-icon" v-bind="scope" /></template>
        <template v-if="$slots['menu-item']" #menu-item="scope"><slot name="menu-item" v-bind="scope" /></template>
        <template v-if="$slots['composer-after-input']" #after-input><slot name="composer-after-input" /></template>
        <template v-if="$slots['composer-after']" #after><slot name="composer-after" /></template>
      </CodexComposer>
      <slot name="after-composer" />
    </footer>
  </section>
</template>

<script setup lang="ts" generic="Payload = unknown">
import { ref, watch } from 'vue';
import type {
  CodexSurfaceApproval,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  SurfaceMessage,
} from '../../surface/types';
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from '../composer-menu';
import type { Message } from '../chat/types';
import type { QueuedChatPrompt } from '../chat/queued-prompts';
import { chatMessageFromInput } from '../chat/renderer-message-adapter';
import type {
  AgentContextUsage,
  AgentFileSearchItem,
  ApprovalPreset,
  BackendCapabilities,
  BackendCommandSummary,
  BackendModelOption,
  BackendSkillSummary,
  ClientRequestResponse,
  CodexChatTranscription,
  ReasoningEffort,
  ThreadGoal,
  TurnGitDiff,
} from '../chat/contracts';
import ChatComposerShelf from '../chat/ChatComposerShelf.vue';
import CodexComposer from './CodexComposer.vue';
import CodexApprovalPrompt from './CodexApprovalPrompt.vue';
import CodexMessageList from './CodexMessageList.vue';

const props = withDefaults(defineProps<{
  ariaLabel?: string;
  actionsDisabled?: boolean;
  answeredClientRequestIds?: Set<string>;
  approvals?: readonly CodexSurfaceApproval[];
  attachEnabled?: boolean;
  autofocus?: boolean;
  backendCapabilities?: BackendCapabilities;
  busy?: boolean;
  canDeleteMessage?: boolean;
  canEditMessage?: boolean;
  canRetryMessage?: boolean;
  commands?: readonly BackendCommandSummary[];
  contextUsage?: AgentContextUsage | null;
  disabled?: boolean;
  emptyLabel?: string;
  error?: string | null;
  files?: readonly AgentFileSearchItem[];
  followUpsDisabled?: boolean;
  goal?: ThreadGoal | null;
  menuItems?: readonly CodexComposerMenuItem<Payload>[];
  messages: readonly (Message | SurfaceMessage)[];
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  models?: readonly BackendModelOption[];
  modelValue: string;
  placeholder?: string;
  approvalPreset?: ApprovalPreset | null;
  planMode?: boolean;
  queuedPrompts?: readonly QueuedChatPrompt[];
  selectedModelId?: string | null;
  selectedReasoningEffort?: ReasoningEffort | null;
  skillCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  skills?: readonly BackendSkillSummary[];
  title?: string;
  transcribeAudio?: CodexChatTranscription;
  turnGitDiff?: TurnGitDiff | null;
}>(), {
  ariaLabel: 'Conversation',
  approvals: () => [],
  autofocus: false,
  busy: false,
  canDeleteMessage: true,
  canEditMessage: true,
  canRetryMessage: true,
  disabled: false,
  emptyLabel: 'Start a conversation with Codex',
  error: null,
  goal: null,
  menuItems: () => [],
  placeholder: 'Ask Codex…',
  queuedPrompts: () => [],
  title: '',
  turnGitDiff: null,
});

const emit = defineEmits<{
  attach: [];
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
  resolveApproval: [
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope: CodexSurfaceApprovalScope,
  ];
  quoteMessage: [index: number];
  reviewFile: [path: string];
  retryMessage: [index: number];
  selectApprovalPreset: [preset: ApprovalPreset];
  sendFollowUp: [prompt: string];
  submit: [prompt: string];
  steer: [prompt: string];
  steerQueuedPrompt: [promptId: string];
  undoChangeSet: [changeSetId: string];
  'update:modelId': [modelId: string];
  'update:modelValue': [value: string];
  'update:planMode': [enabled: boolean];
  'update:reasoningEffort': [reasoningEffort: ReasoningEffort];
}>();

const draftRevision = ref(0);

watch(() => props.modelValue, () => {
  draftRevision.value += 1;
}, { immediate: true });

function submit(prompt: string): void {
  emit('update:modelValue', '');
  emit('submit', prompt);
}

function quoteMessage(index: number): void {
  const message = props.messages[index];
  if (!message) return;
  const chatMessage = chatMessageFromInput(message);
  if (chatMessage.role !== 'user' || !chatMessage.content.trim()) return;
  emit('update:modelValue', chatMessage.content);
  emit('quoteMessage', index);
  draftRevision.value += 1;
}

function editGoal(): void {
  if (!props.goal?.objective.trim()) return;
  emit('update:modelValue', `/goal ${props.goal.objective}`);
  emit('editGoal');
  draftRevision.value += 1;
}
</script>

<style scoped>
.codex-conversation-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  height: 100%;
  flex-direction: column;
  color: var(--codex-text-color, #202124);
  background: var(--codex-surface-color, #fff);
}

.codex-conversation-pane__header {
  flex: 0 0 auto;
  min-height: 52px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--codex-border-color, #e1e3e6);
  box-sizing: border-box;
  -webkit-app-region: drag;
}

.codex-conversation-pane__title {
  margin: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  line-height: 32px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-conversation-pane__error {
  margin: 0 20px 8px;
  color: var(--codex-danger-color, #b3261e);
  font-size: 13px;
}

.codex-conversation-pane__footer {
  flex: 0 0 auto;
  width: min(100%, var(--codex-composer-content-width, 900px));
  margin: 0 auto;
  padding: 12px 16px 20px;
  box-sizing: border-box;
}
</style>
