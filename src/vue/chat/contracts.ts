import type { CodexSpeechTranscriptionResult as NativeSpeechTranscriptionResult } from '../../native/types';
import type { CodexSurfaceServiceTier } from '../../surface/types';

export type ApprovalPreset = 'ask-for-approval' | 'approve-for-me' | 'full-access';

export type ReasoningEffort = string;

export type CodexCapabilities = {
  models: boolean;
  skills: boolean;
  reasoningEffort: boolean;
  serviceTier?: boolean;
  planMode: boolean;
  goals: boolean;
  steerPrompt: boolean;
  interrupt: boolean;
  history: boolean;
  rollback: boolean;
  editMessage: boolean;
  retryMessage: boolean;
  approvals: boolean;
  approvalPresets?: readonly ApprovalPreset[];
};

export type CodexReasoningEffortOption = {
  reasoningEffort: ReasoningEffort;
  description: string;
};

export type CodexModelOption = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: readonly CodexReasoningEffortOption[];
  defaultReasoningEffort?: ReasoningEffort | null;
  serviceTiers?: readonly CodexSurfaceServiceTier[];
  defaultServiceTier?: string | null;
  isDefault?: boolean;
  providerMetadata?: Record<string, unknown>;
};

export type CodexSkillSummary = {
  id?: string;
  name: string;
  description?: string;
  shortDescription?: string;
  displayName?: string;
  iconSmall?: string;
  iconLarge?: string;
  brandColor?: string;
  defaultPrompt?: string;
  path: string;
  scope?: string;
  enabled: boolean;
  providerMetadata?: Record<string, unknown>;
};

export type CodexCommandSummary = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  slashName?: string;
  submitOnSelect?: boolean;
  providerMetadata?: Record<string, unknown>;
};

export type CodexFileSearchItem = {
  name: string;
  path: string;
};

export type CodexConversationLink =
  | { href: string; kind: 'external' }
  | { href: string; kind: 'file'; path: string; line?: number; column?: number };

export type PromptSkillInput = {
  name: string;
  path: string;
};

export type CodexContextUsage = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  lastTotalTokens: number;
  modelContextWindow: number | null;
  usedPercent: number | null;
};

export type CodexComposerPresentation = {
  actionMenu?: boolean;
  contextUsage?: boolean;
  voice?: boolean;
};

export type CodexComposerShelfPresentation = {
  goal?: boolean;
  queuedPrompts?: boolean;
  turnGitDiff?: boolean;
};

export type CodexMessageActionsPresentation = {
  copy?: boolean;
  delete?: boolean;
  edit?: boolean;
  quote?: boolean;
  retry?: boolean;
};

export type CodexMessagesPresentation = {
  actions?: CodexMessageActionsPresentation;
  toolBlocks?: boolean;
};

/**
 * Controls the optional presentation supplied by the default conversation UI.
 * Omitted values preserve the full SDK experience. This never changes surface
 * capabilities or the operations available through the surface controller.
 */
export type CodexConversationPresentation = {
  composer?: CodexComposerPresentation;
  messages?: CodexMessagesPresentation;
  shelf?: CodexComposerShelfPresentation;
};

export type ResolvedCodexConversationPresentation = {
  readonly composer: Readonly<Required<CodexComposerPresentation>>;
  readonly messages: {
    readonly actions: Readonly<Required<CodexMessageActionsPresentation>>;
    readonly toolBlocks: boolean;
  };
  readonly shelf: Readonly<Required<CodexComposerShelfPresentation>>;
};

export const defaultCodexConversationPresentation: ResolvedCodexConversationPresentation = Object.freeze({
  composer: Object.freeze({
    actionMenu: true,
    contextUsage: true,
    voice: true,
  }),
  messages: Object.freeze({
    actions: Object.freeze({
      copy: true,
      delete: true,
      edit: true,
      quote: true,
      retry: true,
    }),
    toolBlocks: true,
  }),
  shelf: Object.freeze({
    goal: true,
    queuedPrompts: true,
    turnGitDiff: true,
  }),
});

export function resolveCodexConversationPresentation(
  presentation?: CodexConversationPresentation,
): ResolvedCodexConversationPresentation {
  return {
    composer: {
      actionMenu: presentation?.composer?.actionMenu ?? defaultCodexConversationPresentation.composer.actionMenu,
      contextUsage: presentation?.composer?.contextUsage ?? defaultCodexConversationPresentation.composer.contextUsage,
      voice: presentation?.composer?.voice ?? defaultCodexConversationPresentation.composer.voice,
    },
    messages: {
      actions: {
        copy: presentation?.messages?.actions?.copy ?? defaultCodexConversationPresentation.messages.actions.copy,
        delete: presentation?.messages?.actions?.delete ?? defaultCodexConversationPresentation.messages.actions.delete,
        edit: presentation?.messages?.actions?.edit ?? defaultCodexConversationPresentation.messages.actions.edit,
        quote: presentation?.messages?.actions?.quote ?? defaultCodexConversationPresentation.messages.actions.quote,
        retry: presentation?.messages?.actions?.retry ?? defaultCodexConversationPresentation.messages.actions.retry,
      },
      toolBlocks: presentation?.messages?.toolBlocks ?? defaultCodexConversationPresentation.messages.toolBlocks,
    },
    shelf: {
      goal: presentation?.shelf?.goal ?? defaultCodexConversationPresentation.shelf.goal,
      queuedPrompts: presentation?.shelf?.queuedPrompts ?? defaultCodexConversationPresentation.shelf.queuedPrompts,
      turnGitDiff: presentation?.shelf?.turnGitDiff ?? defaultCodexConversationPresentation.shelf.turnGitDiff,
    },
  };
}

export type ToolConfirmationDecision =
  | 'allow'
  | 'allow_conversation'
  | 'always_allow'
  | 'deny';

export type AskUserQuestionOption = {
  label: string;
  description: string;
};

export type AskUserQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  multiSelect?: boolean;
  options: AskUserQuestionOption[] | null;
};

export type AskUserAnswers = Record<string, { answers: string[] }>;

export type ClientRequestResponse = {
  id: string;
  payload?: {
    answers?: AskUserAnswers;
    cancelled?: boolean;
    decision?: ToolConfirmationDecision | null;
  };
};

export type ThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete';

export type ThreadGoal = {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export type TurnGitDiff = {
  turnId: string;
  addedLines: number;
  removedLines: number;
  diff?: string;
  updatedAt: string;
};

export type CodexSpeechTranscriptionResult = NativeSpeechTranscriptionResult;

export type CodexChatTranscription = (
  audioData: ArrayBuffer,
  options?: { locale?: string },
) => Promise<CodexSpeechTranscriptionResult>;
