export type SurfaceMessageTextPart = {
  type: 'text';
  text: string;
  itemId?: string;
  phase?: 'commentary' | 'final_answer';
};

export type SurfaceMessageStatusPart = {
  type: 'status';
  text: string;
};

export type SurfaceMessageAttachment = {
  kind: 'file' | 'image';
  name: string;
  path?: string;
  url?: string;
  mimeType?: string;
};

export type SurfaceMessageAttachmentPart = {
  type: 'attachment';
  attachment: SurfaceMessageAttachment;
};

export type SurfaceMessageMedia = {
  url: string;
  alt?: string;
  mimeType?: string;
  prompt?: string;
  title?: string;
};

export type SurfaceMessageMediaPart = {
  type: 'media';
  media: SurfaceMessageMedia;
  itemId?: string;
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
  | SurfaceMessageAttachmentPart
  | SurfaceMessageMediaPart
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
  /** Number of turns present on the app-server thread payload. Thread list responses may report zero. */
  turnCount: number;
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

export type CodexSurfaceAskUserQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: readonly {
    label: string;
    description: string;
  }[] | null;
};

export type CodexSurfaceClientRequest =
  | {
    id: string;
    kind: 'confirm_tool';
    conversationId: string;
    turnId: string | null;
    itemId: string;
    payload: {
      confirmation: {
        argumentsPreview: string;
        integrationId: string;
        integrationName: string;
        summary: string;
        toolName: string;
        allowConversation?: boolean;
        allowAlways?: boolean;
      };
    };
  }
  | {
    id: string;
    kind: 'ask_user';
    conversationId: string;
    turnId: string;
    itemId: string;
    payload: {
      request: {
        itemId: string;
        questions: readonly CodexSurfaceAskUserQuestion[];
        autoResolutionMs?: number;
      };
    };
  };

export type CodexSurfaceQueuedPrompt = {
  id: string;
  text: string;
  options?: SendCodexMessageOptions;
};

export type CodexSurfaceCatalogStatus = 'notLoaded' | 'loading' | 'loaded' | 'error';

export type CodexSurfaceReasoningEffortOption = {
  reasoningEffort: string;
  description: string;
};

export type CodexSurfaceServiceTier = {
  id: string;
  name: string;
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
  serviceTiers?: CodexSurfaceServiceTier[];
  defaultServiceTier?: string | null;
  isDefault?: boolean;
  providerMetadata?: Record<string, unknown>;
};

export type CodexSurfaceSkill = {
  name: string;
  description?: string;
  shortDescription?: string;
  displayName?: string;
  /** Renderer-safe bounded image data URL. Local filesystem paths are never exposed. */
  iconSmall?: string;
  /** Renderer-safe bounded image data URL. Local filesystem paths are never exposed. */
  iconLarge?: string;
  brandColor?: string;
  defaultPrompt?: string;
  path: string;
  scope?: string;
  enabled: boolean;
};

export type CodexSurfacePlugin = {
  /** Canonical app-server plugin id, suitable for matching `plugin://` mentions exactly. */
  id: string;
  name: string;
  displayName: string;
  shortDescription?: string;
  longDescription?: string;
  brandColor?: string;
  /** Renderer-safe remote URL or bounded image data URL. Local filesystem paths are never exposed. */
  iconUrl?: string;
  /** Renderer-safe dark-mode icon with the same guarantees as `iconUrl`. */
  iconUrlDark?: string;
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

export type CodexSurfaceThreadStatus =
  | { type: 'notLoaded' }
  | { type: 'idle' }
  | { type: 'systemError' }
  | {
    type: 'active';
    activeFlags: Array<'waitingOnApproval' | 'waitingOnUserInput'>;
  };

export type CodexSurfaceRateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

export type CodexSurfaceRateLimitSnapshot = {
  limitId: string | null;
  limitName: string | null;
  primary: CodexSurfaceRateLimitWindow | null;
  secondary: CodexSurfaceRateLimitWindow | null;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
  individualLimit: {
    limit: string;
    used: string;
    remainingPercent: number;
    resetsAt: number;
  } | null;
  planType: string | null;
  rateLimitReachedType: string | null;
};

export type CodexSurfaceRateLimits = {
  rateLimits: CodexSurfaceRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, CodexSurfaceRateLimitSnapshot> | null;
  rateLimitResetCredits: {
    availableCount: string;
    credits: readonly {
      id: string;
      resetType: string;
      status: string;
      grantedAt: number;
      expiresAt: number | null;
      title: string | null;
      description: string | null;
    }[] | null;
  } | null;
};

export type CodexSurfaceStatus = 'idle' | 'connecting' | 'ready' | 'error';

export type CodexSurfaceAccount =
  | { type: 'apiKey' }
  | { type: 'chatgpt'; email: string | null; planType: string }
  | { type: 'amazonBedrock'; credentialSource: 'codexManaged' | 'awsManaged' };

export type CodexSurfaceLoginStatus =
  | 'idle'
  | 'starting'
  | 'pending'
  | 'completed'
  | 'cancelled'
  | 'error';

export type CodexSurfaceLoginState = {
  status: CodexSurfaceLoginStatus;
  loginId: string | null;
  authUrl: string | null;
  error: string | null;
};

/**
 * Protocol-free projection of `account/read` plus the active managed login.
 * `requiresOpenaiAuth` deliberately preserves the app-server field; signed-out
 * hosts should check for a loaded `account === null && requiresOpenaiAuth`.
 */
export type CodexSurfaceAuthentication = {
  status: CodexSurfaceCatalogStatus;
  account: CodexSurfaceAccount | null;
  requiresOpenaiAuth: boolean | null;
  error: string | null;
  login: CodexSurfaceLoginState;
};

export type CodexSurfaceChatGptLogin = {
  loginId: string;
  authUrl: string;
};

export type CodexSurfaceSnapshot = {
  status: CodexSurfaceStatus;
  authentication: CodexSurfaceAuthentication;
  conversations: CodexConversationSummary[];
  activeConversationId: string | null;
  messages: SurfaceMessage[];
  clientRequests: CodexSurfaceClientRequest[];
  answeredClientRequestIds: string[];
  approvals: CodexSurfaceApproval[];
  models: CodexSurfaceModel[];
  modelCatalogStatus: CodexSurfaceCatalogStatus;
  skills: CodexSurfaceSkill[];
  skillCatalogStatus: CodexSurfaceCatalogStatus;
  plugins: CodexSurfacePlugin[];
  pluginCatalogStatus: CodexSurfaceCatalogStatus;
  permissionProfiles: CodexSurfacePermissionProfile[];
  approvalPresets: CodexSurfaceApprovalPreset[];
  approvalPreset: CodexSurfaceApprovalPreset | null;
  selectedModelId: string | null;
  selectedReasoningEffort: string | null;
  /** Selected app-server service tier. Optional for backwards-compatible snapshots. */
  selectedServiceTier?: string | null;
  planMode: boolean;
  contextUsage: CodexSurfaceContextUsage | null;
  goal: CodexSurfaceGoal | null;
  turnGitDiff: CodexSurfaceTurnGitDiff | null;
  threadStatus: CodexSurfaceThreadStatus | null;
  rateLimits: CodexSurfaceRateLimits | null;
  queuedPrompts: CodexSurfaceQueuedPrompt[];
  busy: boolean;
  historyLoading: boolean;
  error: string | null;
};

export type CodexConversationSnapshot = CodexSurfaceSnapshot & {
  activeConversationId: string;
  activeTurnId: string | null;
  turnIds: string[];
};

export type CodexConversationHistory = {
  conversationId: string;
  messages: SurfaceMessage[];
  threadStatus: CodexSurfaceThreadStatus | null;
};

export type CodexSurfaceEventOrigin = 'action' | 'notification' | 'lifecycle';
export type CodexSurfaceHistoryReason = 'load' | 'resume' | 'rollback' | 'resync';
export type CodexSurfaceTurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';
export type CodexSurfaceFileActivityAction = 'read' | 'edit' | 'create';
export type CodexSurfaceFileActivityStatus = 'running' | 'completed' | 'failed';
export type CodexSurfacePlanStepStatus = 'pending' | 'inProgress' | 'completed';
export type CodexSurfacePlanStep = {
  step: string;
  status: CodexSurfacePlanStepStatus;
};
export type CodexSurfaceTurnError = {
  message: string;
  additionalDetails: string | null;
  codexErrorInfo: CodexSurfaceJsonValue | null;
};

/**
 * Signed 16-bit little-endian PCM carried by a Codex realtime session.
 *
 * Realtime is an experimental app-server API. Audio remains ephemeral and is
 * intentionally not projected into conversation history.
 */
export type CodexRealtimeAudioChunk = {
  data: Uint8Array;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number | null;
  itemId: string | null;
};

export type CodexRealtimeInputAudioChunk = Omit<
  CodexRealtimeAudioChunk,
  'samplesPerChannel' | 'itemId'
> & {
  samplesPerChannel?: number | null;
  itemId?: string | null;
};

export type CodexRealtimeOutputModality = 'text' | 'audio';
export type CodexRealtimeVersion = 'v1' | 'v2';
export type CodexRealtimeTextRole = 'user' | 'developer' | 'assistant';
export type CodexRealtimeTransport =
  | { type: 'websocket' }
  | { type: 'webrtc'; sdp: string };

export type StartCodexRealtimeOptions = {
  outputModality: CodexRealtimeOutputModality;
  model?: string;
  version?: CodexRealtimeVersion;
  voice?: string;
  includeStartupContext?: boolean;
  prompt?: string | null;
  /**
   * Routes a partial transcript through Codex if the realtime transport ends
   * before the backend finalizes that transcript.
   */
  flushTranscriptTailOnSessionEnd?: boolean;
  /**
   * Websocket accepts PCM through appendAudio and requires API-key auth.
   * WebRTC accepts a browser-generated offer and carries audio over its media
   * track; app-server returns the remote SDP on the session handle.
   */
  transport?: CodexRealtimeTransport;
};

type CodexSurfaceEventEnvelope<Type extends string, Payload> = {
  readonly seq: number;
  readonly occurredAt: string;
  readonly origin: CodexSurfaceEventOrigin;
  readonly type: Type;
  readonly payload: Payload;
};

type CodexConversationEventEnvelope<Type extends string, Payload> =
  & CodexSurfaceEventEnvelope<Type, Payload>
  & { readonly conversationId: string };

type CodexTurnEventEnvelope<Type extends string, Payload> =
  & CodexConversationEventEnvelope<Type, Payload>
  & { readonly turnId: string };

/**
 * Ordered, serializable semantic events emitted by the surface after its matching
 * snapshot mutation has been applied. The union is intentionally protocol-free so
 * hosts can consume it without importing generated app-server JSON-RPC types.
 */
export type CodexSurfaceEvent =
  | CodexSurfaceEventEnvelope<'surface.statusChanged', {
    status: CodexSurfaceStatus;
    error: string | null;
  }>
  | CodexSurfaceEventEnvelope<'authentication.changed', {
    authentication: CodexSurfaceAuthentication;
  }>
  | CodexSurfaceEventEnvelope<'catalog.modelsChanged', {
    models: readonly CodexSurfaceModel[];
    status: CodexSurfaceCatalogStatus;
  }>
  | CodexSurfaceEventEnvelope<'catalog.skillsChanged', {
    cwd: string | null;
    skills: readonly CodexSurfaceSkill[];
    status: CodexSurfaceCatalogStatus;
  }>
  | CodexSurfaceEventEnvelope<'catalog.pluginsChanged', {
    plugins: readonly CodexSurfacePlugin[];
    status: CodexSurfaceCatalogStatus;
  }>
  | CodexSurfaceEventEnvelope<'catalog.permissionsChanged', {
    cwd: string | null;
    permissionProfiles: readonly CodexSurfacePermissionProfile[];
    approvalPresets: readonly CodexSurfaceApprovalPreset[];
  }>
  | CodexSurfaceEventEnvelope<'rateLimits.changed', {
    rateLimits: CodexSurfaceRateLimits | null;
  }>
  | CodexSurfaceEventEnvelope<'conversation.selected', {
    conversationId: string | null;
  }>
  | CodexConversationEventEnvelope<'conversation.summaryUpserted', {
    summary: CodexConversationSummary;
    reason: 'created' | 'listed' | 'resumed' | 'started' | 'updated';
  }>
  | CodexConversationEventEnvelope<'conversation.summaryRemoved', {
    reason: 'archived' | 'deleted';
  }>
  | CodexConversationEventEnvelope<'conversation.historyReplaced', {
    reason: CodexSurfaceHistoryReason;
    messages: readonly SurfaceMessage[];
    threadStatus: CodexSurfaceThreadStatus | null;
  }>
  | CodexConversationEventEnvelope<'conversation.historyPrepended', {
    messages: readonly SurfaceMessage[];
  }>
  | CodexConversationEventEnvelope<'conversation.activityChanged', {
    threadStatus: CodexSurfaceThreadStatus | null;
    busy: boolean;
    error: string | null;
  }>
  | CodexConversationEventEnvelope<'conversation.settingsChanged', {
    approvalPreset: CodexSurfaceApprovalPreset | null;
    selectedModelId: string | null;
    selectedReasoningEffort: string | null;
    selectedServiceTier?: string | null;
    planMode: boolean;
  }>
  | CodexConversationEventEnvelope<'conversation.goalChanged', {
    goal: CodexSurfaceGoal | null;
  }> & { readonly turnId?: string }
  | CodexTurnEventEnvelope<'conversation.contextUsageChanged', {
    contextUsage: CodexSurfaceContextUsage | null;
  }>
  | CodexConversationEventEnvelope<'conversation.skillsChanged', {
    cwd: string | null;
    skills: readonly CodexSurfaceSkill[];
    status: CodexSurfaceCatalogStatus;
  }>
  | CodexConversationEventEnvelope<'conversation.permissionsChanged', {
    cwd: string | null;
    permissionProfiles: readonly CodexSurfacePermissionProfile[];
    approvalPresets: readonly CodexSurfaceApprovalPreset[];
  }>
  | CodexConversationEventEnvelope<'conversation.diffUpdated', {
    diff: CodexSurfaceTurnGitDiff | null;
  }>
  | CodexConversationEventEnvelope<'realtime.started', {
    realtimeSessionId: string | null;
    version: CodexRealtimeVersion;
  }>
  | CodexConversationEventEnvelope<'realtime.itemAdded', {
    item: CodexSurfaceJsonValue;
  }>
  | CodexConversationEventEnvelope<'realtime.transcriptDelta', {
    role: string;
    delta: string;
  }>
  | CodexConversationEventEnvelope<'realtime.transcriptCompleted', {
    role: string;
    text: string;
  }>
  | CodexConversationEventEnvelope<'realtime.audioDelta', {
    audio: CodexRealtimeAudioChunk;
  }>
  | CodexConversationEventEnvelope<'realtime.sdp', {
    sdp: string;
  }>
  | CodexConversationEventEnvelope<'realtime.error', {
    message: string;
  }>
  | CodexConversationEventEnvelope<'realtime.closed', {
    reason: string | null;
  }>
  | CodexTurnEventEnvelope<'turn.started', {
    startedAt: string;
  }>
  | CodexTurnEventEnvelope<'turn.completed', {
    status: CodexSurfaceTurnStatus;
    error: CodexSurfaceTurnError | null;
    willRetry: boolean;
    startedAt: string | null;
    completedAt: string | null;
    durationMs: number | null;
  }>
  | CodexTurnEventEnvelope<'turn.error', {
    error: CodexSurfaceTurnError;
    willRetry: boolean;
  }>
  | CodexConversationEventEnvelope<'message.appended', {
    message: SurfaceMessage;
  }> & { readonly turnId?: string }
  | CodexTurnEventEnvelope<'message.delta', {
    messageId: string;
    itemId: string;
    delta: string;
  }>
  | CodexTurnEventEnvelope<'message.updated', {
    message: SurfaceMessage;
  }>
  | CodexTurnEventEnvelope<'tool.started', {
    messageId: string;
    toolPart: SurfaceMessageToolPart;
  }>
  | CodexTurnEventEnvelope<'tool.updated', {
    messageId: string;
    update: SurfaceMessageToolPartUpdate;
  }>
  | CodexTurnEventEnvelope<'tool.completed', {
    messageId: string;
    toolPart: SurfaceMessageToolPart;
  }>
  | CodexTurnEventEnvelope<'file.activity', {
    messageId: string;
    itemId: string;
    path: string;
    action: CodexSurfaceFileActivityAction;
    status: CodexSurfaceFileActivityStatus;
  }>
  | CodexTurnEventEnvelope<'plan.delta', {
    itemId: string;
    delta: string;
    markdown: string;
  }>
  | CodexTurnEventEnvelope<'plan.updated', {
    explanation: string | null;
    steps: readonly CodexSurfacePlanStep[];
    markdown: string;
    status: 'running' | 'completed';
  }>
  | CodexTurnEventEnvelope<'plan.completed', {
    itemId: string;
    markdown: string;
  }>
  | CodexTurnEventEnvelope<'context.compactionStarted', {
    itemId: string | null;
  }>
  | CodexTurnEventEnvelope<'context.compactionCompleted', {
    itemId: string | null;
    message: SurfaceMessage;
  }>
  | CodexConversationEventEnvelope<'approval.requested', {
    approval: CodexSurfaceApproval;
  }> & { readonly turnId?: string }
  | CodexConversationEventEnvelope<'approval.resolved', {
    approval: CodexSurfaceApproval;
    decision: CodexSurfaceApprovalDecision | null;
    scope: CodexSurfaceApprovalScope | null;
    reason: 'host' | 'server' | 'conversation_closed' | 'conversation_removed' | 'surface_disconnected';
  }> & { readonly turnId?: string }
  | CodexConversationEventEnvelope<'clientRequest.requested', {
    request: CodexSurfaceClientRequest;
  }> & { readonly turnId?: string }
  | CodexConversationEventEnvelope<'clientRequest.resolved', {
    request: CodexSurfaceClientRequest;
    response: CodexSurfaceClientRequestResponse | null;
    reason: 'host' | 'server' | 'conversation_closed' | 'conversation_removed' | 'surface_disconnected';
  }> & { readonly turnId?: string };

export type CodexConversationEvent = Extract<CodexSurfaceEvent, { conversationId: string }>;
export type CodexRealtimeEvent = Extract<CodexConversationEvent, { type: `realtime.${string}` }>;

export type ListCodexConversationsOptions = {
  archived?: boolean;
  cwd?: string | readonly string[];
  limit?: number;
  searchTerm?: string;
};

export type ListCodexModelsOptions = {
  includeHidden?: boolean;
  forceReload?: boolean;
};

export type CodexSurfacePermissionMode = 'read-only' | 'workspace-write' | 'full-access';
export type CodexSurfaceApprovalMode = 'ask' | 'never';

export type CreateCodexConversationOptions = {
  approvalPreset?: CodexSurfaceApprovalPreset;
  approvalMode?: CodexSurfaceApprovalMode;
  baseInstructions?: string;
  config?: Readonly<Record<string, CodexSurfaceJsonValue>>;
  cwd?: string;
  developerInstructions?: string;
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string | null;
  permissionMode?: CodexSurfacePermissionMode;
};

export type CreateCodexRendererConversationOptions = Pick<
  CreateCodexConversationOptions,
  'approvalPreset' | 'model' | 'reasoningEffort' | 'serviceTier'
>;

export type SendCodexMessageOptions = {
  attachments?: readonly CodexSurfaceAttachment[];
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string | null;
  planMode?: boolean;
  skills?: readonly CodexSurfaceSkillInput[];
  outputSchema?: CodexSurfaceJsonValue;
};

export type CodexSurfaceAttachment =
  | {
    type: 'image';
    path: string;
    detail?: 'auto' | 'low' | 'high' | 'original';
    name?: string;
    mimeType?: string;
    previewUrl?: string;
  }
  | {
    type: 'file';
    path: string;
    name?: string;
    mimeType?: string;
  };

export type CodexSurfaceJsonValue =
  | null
  | boolean
  | number
  | string
  | CodexSurfaceJsonValue[]
  | { [key: string]: CodexSurfaceJsonValue };

export type CodexSurfaceSkillInput = Pick<CodexSurfaceSkill, 'name' | 'path'>;

export type CodexSurfaceReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title?: string | null }
  | { type: 'custom'; instructions: string };

export type StartCodexReviewOptions = {
  target?: CodexSurfaceReviewTarget;
};

export type UpdateCodexConversationSettings = {
  approvalPreset?: CodexSurfaceApprovalPreset;
  modelId?: string;
  reasoningEffort?: string;
  serviceTier?: string | null;
  planMode?: boolean;
};

export type CodexSurfaceApi = {
  connect(): Promise<CodexSurfaceSnapshot>;
  refreshAccount(): Promise<CodexSurfaceSnapshot>;
  startChatGptLogin(): Promise<CodexSurfaceChatGptLogin>;
  cancelLogin(loginId?: string): Promise<CodexSurfaceSnapshot>;
  logout(): Promise<CodexSurfaceSnapshot>;
  clearGoal(): Promise<CodexSurfaceSnapshot>;
  refreshConversations(): Promise<CodexSurfaceSnapshot>;
  listConversations(options?: ListCodexConversationsOptions): Promise<CodexConversationSummary[]>;
  listModels(options?: ListCodexModelsOptions): Promise<CodexSurfaceModel[]>;
  createConversation(options?: CreateCodexConversationOptions): Promise<CodexSurfaceSnapshot>;
  archiveConversation(conversationId: string): Promise<CodexSurfaceSnapshot>;
  deleteConversation(conversationId: string): Promise<CodexSurfaceSnapshot>;
  unarchiveConversation(conversationId: string): Promise<CodexSurfaceSnapshot>;
  selectConversation(conversationId: string): Promise<CodexSurfaceSnapshot>;
  readConversationHistory(conversationId?: string): Promise<CodexConversationHistory>;
  renameConversation(title: string): Promise<CodexSurfaceSnapshot>;
  updateConversationSettings(settings: UpdateCodexConversationSettings): Promise<CodexSurfaceSnapshot>;
  sendMessage(prompt: string, options?: SendCodexMessageOptions): Promise<CodexSurfaceSnapshot>;
  compactConversation(): Promise<CodexSurfaceSnapshot>;
  startReview(options?: StartCodexReviewOptions): Promise<CodexSurfaceSnapshot>;
  steerMessage(prompt: string, options?: SendCodexMessageOptions): Promise<CodexSurfaceSnapshot>;
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
  onEvent(listener: (event: CodexSurfaceEvent) => void): () => void;
};

export type CodexSurfaceRendererApi = Omit<CodexSurfaceApi, 'createConversation'> & {
  createConversation(options?: CreateCodexRendererConversationOptions): Promise<CodexSurfaceSnapshot>;
};
