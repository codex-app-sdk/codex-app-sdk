export type ApprovalPreset = 'ask-for-approval' | 'approve-for-me' | 'full-access';

export type ReasoningEffort = string;

export type CodexCapabilities = {
  models: boolean;
  skills: boolean;
  reasoningEffort: boolean;
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
import type { CodexSpeechTranscriptionResult as NativeSpeechTranscriptionResult } from '../../native/types';
