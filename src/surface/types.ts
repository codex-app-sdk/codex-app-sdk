export type SurfaceMessageTextPart = {
  type: 'text';
  text: string;
  itemId?: string;
};

export type SurfaceMessageStatusPart = {
  type: 'status';
  text: string;
};

export type SurfaceMessageToolPart = {
  type: 'tool';
  id: string;
  title: string;
  kind?: string;
  status: 'running' | 'completed' | 'failed';
  statusText?: string;
  body?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
};

export type SurfaceMessageToolPartUpdate = {
  itemId: string;
  title?: string;
  status?: SurfaceMessageToolPart['status'];
  statusText?: string | null;
  body?: string;
  bodyDelta?: string;
  bodyAppend?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  fallbackToolPart?: SurfaceMessageToolPart;
};

export type SurfaceMessagePart =
  | SurfaceMessageTextPart
  | SurfaceMessageStatusPart
  | SurfaceMessageToolPart;

export type SurfaceMessage = {
  id: string;
  kind?: 'compaction' | 'steer';
  role: 'user' | 'assistant' | 'system';
  status: 'complete' | 'streaming' | 'error';
  parts: readonly SurfaceMessagePart[];
  createdAt?: string;
  turnId?: string;
  metadata?: Record<string, unknown>;
};

export type CodexConversationSummary = {
  id: string;
  title: string;
  preview: string;
  cwd: string;
  status: 'idle' | 'active' | 'error';
  createdAt: string;
  updatedAt: string;
};

export type CodexSurfaceApproval = {
  id: string;
  kind: 'command' | 'file-change' | 'permissions';
  conversationId: string;
  turnId?: string;
  itemId: string;
  title: string;
  description?: string;
  command?: string;
  cwd?: string;
  requestedPermissions?: readonly CodexSurfaceRequestedPermission[];
  allowedScopes?: readonly CodexSurfaceApprovalScope[];
  canDeny?: boolean;
};

export type CodexSurfaceRequestedPermission =
  | {
    kind: 'filesystem';
    access: 'read' | 'write' | 'deny';
    path: string;
  }
  | {
    kind: 'network';
    enabled: boolean;
    host?: string;
    protocol?: string;
  };

export type CodexSurfaceApprovalDecision = 'approve' | 'deny';
export type CodexSurfaceApprovalScope = 'once' | 'session';
export type CodexSurfaceApprovalPreset = 'ask-for-approval' | 'approve-for-me' | 'full-access';

export type CodexSurfaceAskUserAnswers = Record<string, { answers: string[] }>;
export type CodexSurfaceToolConfirmationDecision = 'allow' | 'allow_conversation' | 'always_allow' | 'deny';
export type CodexSurfaceClientRequestResponse = {
  id: string;
  payload?: {
    answers?: CodexSurfaceAskUserAnswers;
    cancelled?: boolean;
    decision?: CodexSurfaceToolConfirmationDecision | null;
  };
};

export type CodexSurfaceQueuedPrompt = {
  id: string;
  text: string;
};

export type CodexSurfaceCatalogStatus = 'notLoaded' | 'loading' | 'loaded' | 'error';

export type CodexSurfaceReasoningEffortOption = {
  reasoningEffort: string;
  description: string;
};

export type CodexSurfaceModel = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: CodexSurfaceReasoningEffortOption[];
  defaultReasoningEffort?: string | null;
  isDefault?: boolean;
  providerMetadata?: Record<string, unknown>;
};

export type CodexSurfaceSkill = {
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
};

export type CodexSurfacePermissionProfile = {
  id: string;
  description: string | null;
  allowed: boolean;
};

export type CodexSurfaceContextUsage = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  lastTotalTokens: number;
  modelContextWindow: number | null;
  usedPercent: number | null;
};

export type CodexSurfaceGoal = {
  threadId: string;
  objective: string;
  status: 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export type CodexSurfaceTurnGitDiff = {
  turnId: string;
  addedLines: number;
  removedLines: number;
  diff?: string;
  updatedAt: string;
};

export type CodexSurfaceStatus = 'idle' | 'connecting' | 'ready' | 'error';

export type CodexSurfaceSnapshot = {
  status: CodexSurfaceStatus;
  conversations: CodexConversationSummary[];
  activeConversationId: string | null;
  messages: SurfaceMessage[];
  approvals: CodexSurfaceApproval[];
  models: CodexSurfaceModel[];
  modelCatalogStatus: CodexSurfaceCatalogStatus;
  skills: CodexSurfaceSkill[];
  skillCatalogStatus: CodexSurfaceCatalogStatus;
  permissionProfiles: CodexSurfacePermissionProfile[];
  approvalPresets: CodexSurfaceApprovalPreset[];
  approvalPreset: CodexSurfaceApprovalPreset | null;
  selectedModelId: string | null;
  selectedReasoningEffort: string | null;
  planMode: boolean;
  contextUsage: CodexSurfaceContextUsage | null;
  goal: CodexSurfaceGoal | null;
  turnGitDiff: CodexSurfaceTurnGitDiff | null;
  queuedPrompts: CodexSurfaceQueuedPrompt[];
  busy: boolean;
  error: string | null;
};

export type CodexSurfacePermissionMode = 'read-only' | 'workspace-write' | 'full-access';
export type CodexSurfaceApprovalMode = 'ask' | 'never';

export type CreateCodexConversationOptions = {
  approvalPreset?: CodexSurfaceApprovalPreset;
  approvalMode?: CodexSurfaceApprovalMode;
  cwd?: string;
  model?: string;
  reasoningEffort?: string;
  permissionMode?: CodexSurfacePermissionMode;
};

export type CreateCodexRendererConversationOptions = Pick<
  CreateCodexConversationOptions,
  'approvalPreset' | 'model' | 'reasoningEffort'
>;

export type SendCodexMessageOptions = {
  model?: string;
  reasoningEffort?: string;
  planMode?: boolean;
};

export type UpdateCodexConversationSettings = {
  approvalPreset?: CodexSurfaceApprovalPreset;
  modelId?: string;
  reasoningEffort?: string;
  planMode?: boolean;
};

export type CodexSurfaceApi = {
  connect(): Promise<CodexSurfaceSnapshot>;
  clearGoal(): Promise<CodexSurfaceSnapshot>;
  refreshConversations(): Promise<CodexSurfaceSnapshot>;
  createConversation(options?: CreateCodexConversationOptions): Promise<CodexSurfaceSnapshot>;
  selectConversation(conversationId: string): Promise<CodexSurfaceSnapshot>;
  updateConversationSettings(settings: UpdateCodexConversationSettings): Promise<CodexSurfaceSnapshot>;
  sendMessage(prompt: string, options?: SendCodexMessageOptions): Promise<CodexSurfaceSnapshot>;
  steerMessage(prompt: string): Promise<CodexSurfaceSnapshot>;
  interrupt(): Promise<CodexSurfaceSnapshot>;
  deleteMessage(index: number): Promise<CodexSurfaceSnapshot>;
  editMessage(index: number, content: string): Promise<CodexSurfaceSnapshot>;
  retryMessage(index: number): Promise<CodexSurfaceSnapshot>;
  deleteQueuedPrompt(promptId: string): Promise<CodexSurfaceSnapshot>;
  steerQueuedPrompt(promptId: string): Promise<CodexSurfaceSnapshot>;
  respondToClientRequest(response: CodexSurfaceClientRequestResponse): Promise<CodexSurfaceSnapshot>;
  resolveApproval(
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope?: CodexSurfaceApprovalScope,
  ): Promise<CodexSurfaceSnapshot>;
  setGoal(objective: string, tokenBudget?: number | null): Promise<CodexSurfaceSnapshot>;
  getSnapshot(): Promise<CodexSurfaceSnapshot>;
  onStateChange(listener: (snapshot: CodexSurfaceSnapshot) => void): () => void;
};

export type CodexSurfaceRendererApi = Omit<CodexSurfaceApi, 'createConversation'> & {
  createConversation(options?: CreateCodexRendererConversationOptions): Promise<CodexSurfaceSnapshot>;
};
