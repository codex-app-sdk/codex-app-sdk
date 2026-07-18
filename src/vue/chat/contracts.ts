export type AgentBackend = 'codex' | 'claude';

export type ApprovalPreset = 'ask-for-approval' | 'approve-for-me' | 'full-access';

export type ReasoningEffort = string;

export type BackendPlanModeSupport = 'native' | 'prompted' | 'unsupported';

export type BackendCapabilities = {
  models: boolean;
  skills: boolean;
  reasoningEffort: boolean;
  thinkingBudget: boolean;
  planMode: BackendPlanModeSupport;
  goals: boolean;
  steerPrompt: boolean;
  interrupt: boolean;
  history: boolean;
  rollback: boolean;
  editMessage: boolean;
  retryMessage: boolean;
  approvals: boolean;
  approvalPresets?: ApprovalPreset[];
};

export type BackendReasoningEffortOption = {
  reasoningEffort: ReasoningEffort;
  description: string;
};

export type BackendModelOption = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: BackendReasoningEffortOption[];
  defaultReasoningEffort?: ReasoningEffort | null;
  isDefault?: boolean;
  capabilities?: Partial<BackendCapabilities>;
  providerMetadata?: Record<string, unknown>;
};

export type BackendSkillSummary = {
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

export type BackendCommandSummary = {
  id: string;
  backend: AgentBackend;
  name: string;
  displayName?: string;
  description?: string;
  slashName?: string;
  submitOnSelect?: boolean;
  providerMetadata?: Record<string, unknown>;
};

export type AgentFileSearchItem = {
  name: string;
  path: string;
};

export type PromptSkillInput = {
  name: string;
  path: string;
};

export type AgentContextUsage = {
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

export type AppleSpeechTranscriptionResult = {
  text: string;
  error?: string;
};

export type CodexChatTranscription = (
  audioData: ArrayBuffer,
  options?: { locale?: string },
) => Promise<AppleSpeechTranscriptionResult>;
