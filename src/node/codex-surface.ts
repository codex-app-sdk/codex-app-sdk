import { basename, extname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CodexAppServerClient,
  type CodexServerRequestResponder,
  type ServerRequest,
  type ServerNotification,
  type v2,
} from '../codex/index';
import type {
  CodexConversationSummary,
  CodexConversationEvent,
  CodexConversationHistory,
  CodexConversationSnapshot,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalMode,
  CodexSurfaceApprovalPreset,
  CodexSurfaceApprovalScope,
  CodexSurfaceAttachment,
  CodexSurfaceAuthentication,
  CodexSurfaceChatGptLogin,
  CodexSurfaceClientRequest,
  CodexSurfaceClientRequestResponse,
  CodexSurfaceContextUsage,
  CodexSurfaceEvent,
  CodexSurfaceEventOrigin,
  CodexSurfaceJsonValue,
  CodexSurfaceModel,
  CodexSurfacePermissionMode,
  CodexSurfacePlugin,
  CodexSurfaceRateLimitSnapshot,
  CodexSurfaceRateLimits,
  CodexSurfaceReviewTarget,
  CodexSurfaceSnapshot,
  CodexSurfaceSkill,
  CodexSurfaceSkillInput,
  CodexSurfaceThreadStatus,
  CodexSurfaceTurnError,
  CreateCodexConversationOptions,
  ListCodexConversationsOptions,
  ListCodexModelsOptions,
  SendCodexMessageOptions,
  StartCodexReviewOptions,
  SurfaceMessage,
  SurfaceMessageAttachmentPart,
  SurfaceMessageMediaPart,
  SurfaceMessageToolPart,
  SurfaceMessageToolPartUpdate,
  UpdateCodexConversationSettings,
} from '../surface/types';
import {
  codexItemToMediaPart,
  codexItemToSurfaceMessage,
  codexItemToToolPart,
  codexThreadToSurfaceMessages,
  codexTurnToSurfaceMessages,
} from './codex-conversation-history';
import {
  commandOutputDeltaToToolPartUpdate,
  fileChangePatchToToolPartUpdate,
  mcpProgressToToolPartUpdate,
  lineDiffFromUnifiedDiff,
  shouldForwardCommandExecutionOutput,
} from './codex-tool-part-adapter';
import { rawResponseItemToEvent } from './codex-raw-response-item-adapter';
import { registerCodexApprovalHandlers, type PendingCodexApproval } from './codex-approvals';
import {
  CodexAppServerStdioTransport,
  type CodexAppServerStdioTransportOptions,
} from './codex-stdio-transport';

type StateListener = (snapshot: CodexSurfaceSnapshot) => void;
type ConversationStateListener = (snapshot: CodexConversationSnapshot) => void;
type SurfaceEventListener = (event: CodexSurfaceEvent) => void;
type ConversationEventListener = (event: CodexConversationEvent) => void;
const CONVERSATION_HISTORY_PAGE_SIZE = 5;
const MAX_CATALOG_ICON_BYTES = 256 * 1024;
const MAX_CATALOG_ICON_BASE64_LENGTH = Math.ceil(MAX_CATALOG_ICON_BYTES / 3) * 4;
type SurfaceEventInput = CodexSurfaceEvent extends infer Event
  ? Event extends CodexSurfaceEvent
    ? Omit<Event, 'seq' | 'occurredAt' | 'origin'>
    : never
  : never;

export type CodexDynamicToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; imageUrl: string };

export type CodexDynamicToolResult = string | {
  content: readonly CodexDynamicToolContent[];
  success?: boolean;
};

export type CodexDynamicToolCall = {
  callId: string;
  conversationId: string;
  turnId: string;
  arguments: CodexSurfaceJsonValue;
  extensionContext?: unknown;
};

export type CodexDynamicTool = {
  name: string;
  description: string;
  inputSchema: CodexSurfaceJsonValue;
  deferLoading?: boolean;
  execute(call: CodexDynamicToolCall): CodexDynamicToolResult | Promise<CodexDynamicToolResult>;
};

export type CodexThreadStartExtension = {
  baseInstructions?: string;
  config?: Readonly<Record<string, CodexSurfaceJsonValue>>;
  developerInstructions?: string;
};

export type CodexMcpServerToolApprovalMode = 'auto' | 'prompt' | 'writes' | 'approve';

export type CodexMcpServerTransport =
  | {
    type: 'stdio';
    command: string;
    args?: readonly string[];
    cwd?: string;
    env?: Readonly<Record<string, string>>;
    /** Environment variable names inherited by the app-server-launched process. */
    envVars?: readonly string[];
  }
  | {
    type: 'http';
    url: string;
  };

/** Trusted main-process configuration for an app-owned MCP server. */
export type CodexMcpServerDefinition = {
  name: string;
  transport: CodexMcpServerTransport;
  toolApprovalMode?: CodexMcpServerToolApprovalMode;
  required?: boolean;
  enabledTools?: readonly string[];
  startupTimeoutMs?: number;
  toolTimeoutMs?: number;
};

export type CodexConversationHostOptions = {
  extensionContext?: unknown;
  /** Replaces the surface MCP definitions for this conversation. Main-process only. */
  mcpServers?: readonly CodexMcpServerDefinition[];
};

export type CodexConversationDefaults = Pick<
  CreateCodexConversationOptions,
  'model' | 'reasoningEffort'
>;

export type CodexConversationLoadOptions = CodexConversationHostOptions & {
  cwd?: string;
};

export type ListCodexSkillsOptions = {
  cwd?: string;
  forceReload?: boolean;
};

export type CodexSurfaceExtension = {
  dynamicTools?: readonly CodexDynamicTool[];
  configureConversation?: (context: {
    operation: 'start' | 'resume';
    conversationId: string | null;
    cwd?: string;
    createOptions?: Readonly<CreateCodexConversationOptions>;
    extensionContext?: unknown;
  }) => CodexThreadStartExtension | Promise<CodexThreadStartExtension>;
};

export type CodexConversation = {
  readonly id: string;
  load(options?: CodexConversationLoadOptions): Promise<CodexConversationSnapshot>;
  select(): Promise<CodexConversationSnapshot>;
  readHistory(): Promise<CodexConversationHistory>;
  rename(title: string): Promise<CodexConversationSnapshot>;
  updateSettings(settings: UpdateCodexConversationSettings): Promise<CodexConversationSnapshot>;
  sendMessage(prompt: string, options?: SendCodexMessageOptions): Promise<CodexConversationSnapshot>;
  compact(): Promise<CodexConversationSnapshot>;
  startReview(options?: StartCodexReviewOptions): Promise<CodexConversationSnapshot>;
  steerMessage(prompt: string): Promise<CodexConversationSnapshot>;
  interrupt(): Promise<CodexConversationSnapshot>;
  deleteMessage(index: number): Promise<CodexConversationSnapshot>;
  editMessage(index: number, content: string): Promise<CodexConversationSnapshot>;
  retryMessage(index: number): Promise<CodexConversationSnapshot>;
  rollbackToTurn(turnId: string): Promise<CodexConversationSnapshot>;
  deleteQueuedPrompt(promptId: string): Promise<CodexConversationSnapshot>;
  steerQueuedPrompt(promptId: string): Promise<CodexConversationSnapshot>;
  respondToClientRequest(response: CodexSurfaceClientRequestResponse): Promise<CodexConversationSnapshot>;
  resolveApproval(
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope?: CodexSurfaceApprovalScope,
  ): Promise<CodexConversationSnapshot>;
  setGoal(objective: string, tokenBudget?: number | null): Promise<CodexConversationSnapshot>;
  clearGoal(): Promise<CodexConversationSnapshot>;
  getSnapshot(): CodexConversationSnapshot;
  onStateChange(listener: (snapshot: CodexConversationSnapshot) => void): () => void;
  onEvent(listener: (event: CodexConversationEvent) => void): () => void;
};

type ToolInputRequest = Extract<ServerRequest, { method: 'item/tool/requestUserInput' }>;
type McpElicitationRequest = Extract<ServerRequest, { method: 'mcpServer/elicitation/request' }>;
type DynamicToolRequest = Extract<ServerRequest, { method: 'item/tool/call' }>;
type PendingClientRequest =
  | {
    kind: 'ask_user';
    itemId: string;
    request: Extract<CodexSurfaceClientRequest, { kind: 'ask_user' }>;
    threadId: string;
    turnId: string;
    responder: CodexServerRequestResponder<'item/tool/requestUserInput'>;
  }
  | {
    kind: 'mcp_tool_approval';
    displayTurnId: string;
    itemId: string;
    request: Extract<CodexSurfaceClientRequest, { kind: 'confirm_tool' }>;
    threadId: string;
    turnId: string | null;
    responder: CodexServerRequestResponder<'mcpServer/elicitation/request'>;
  };

type ThreadRuntimeState = {
  threadId: string;
  cwd: string | null;
  hydrated: boolean;
  activeTurnId: string | null;
  turnIds: string[];
  messages: SurfaceMessage[];
  answeredClientRequestIds: string[];
  approvalPreset: CodexSurfaceApprovalPreset | null;
  approvalPresets: CodexSurfaceApprovalPreset[];
  permissionProfiles: CodexSurfaceSnapshot['permissionProfiles'];
  skills: CodexSurfaceSkill[];
  skillCatalogStatus: CodexSurfaceSnapshot['skillCatalogStatus'];
  selectedModelId: string | null;
  selectedReasoningEffort: string | null;
  planMode: boolean;
  contextUsage: CodexSurfaceSnapshot['contextUsage'];
  goal: CodexSurfaceSnapshot['goal'];
  turnGitDiff: CodexSurfaceSnapshot['turnGitDiff'];
  threadStatus: CodexSurfaceThreadStatus | null;
  queuedPrompts: CodexSurfaceSnapshot['queuedPrompts'];
  busy: boolean;
  turnStartPending: boolean;
  historyLoading: boolean;
  fullHistoryHydrated: boolean;
  error: string | null;
  planMarkdownByTurn: Map<string, string>;
};

type ThreadRuntimePatch = Partial<Omit<ThreadRuntimeState, 'threadId' | 'planMarkdownByTurn'>>;

type ConversationCatalogs = Pick<
  ThreadRuntimeState,
  'approvalPresets' | 'permissionProfiles' | 'skillCatalogStatus' | 'skills'
>;

export type CodexSurfaceOptions = {
  approvalPreset?: CodexSurfaceApprovalPreset;
  approvalMode?: CodexSurfaceApprovalMode;
  clientInfo?: {
    name: string;
    title?: string;
    version: string;
  };
  /** Host-owned defaults used by explicit and implicit conversation creation. */
  conversationDefaults?: Readonly<CodexConversationDefaults>;
  conversationLimit?: number;
  /** Trusted main-process CODEX_HOME for this app-server child. Never expose this through renderer IPC. */
  codexHome?: string;
  cwd?: string;
  autoSelectFirstConversation?: boolean;
  extensions?: readonly CodexSurfaceExtension[];
  /** App-owned MCP servers applied to every started or resumed conversation. Main-process only. */
  mcpServers?: readonly CodexMcpServerDefinition[];
  /** Receives notifications added by a newer app-server than this SDK schema. */
  onUnknownNotification?: (notification: { method: string; params?: unknown }) => void;
  permissionMode?: CodexSurfacePermissionMode;
  transport?: CodexAppServerStdioTransportOptions;
  /** Test and advanced embedding seam. Most apps should let the SDK create the client. */
  client?: CodexAppServerClient;
};

export class CodexSurface {
  private readonly client: CodexAppServerClient;
  private readonly listeners = new Set<StateListener>();
  private readonly eventListeners = new Set<SurfaceEventListener>();
  private readonly conversationListeners = new Map<string, Set<ConversationStateListener>>();
  private readonly conversationHandles = new Map<string, CodexConversation>();
  private readonly dynamicTools = new Map<string, CodexDynamicTool>();
  private readonly defaultMcpServers: readonly CodexMcpServerDefinition[];
  private readonly hydrationPromises = new Map<string, Promise<void>>();
  private readonly historyHydrationPromises = new Map<string, Promise<void>>();
  private readonly catalogIconDataUrls = new Map<string, Promise<string | undefined>>();
  private readonly hostOptionsByThread = new Map<string, CodexConversationLoadOptions>();
  private readonly pendingApprovals = new Map<string, PendingCodexApproval>();
  private readonly pendingClientRequests = new Map<string, PendingClientRequest>();
  private readonly runtimes = new Map<string, ThreadRuntimeState>();
  private readonly commandOutputForwardItemIds = new Set<string>();
  private readonly semanticEventValues = new Map<string, string>();
  private readonly unsubscribeApprovals: () => void;
  private readonly unsubscribeDisconnect: () => void;
  private readonly unsubscribeNotification: () => void;
  private readonly unsubscribeToolInputRequests: () => void;
  private readonly unsubscribeMcpElicitationRequests: () => void;
  private readonly unsubscribeServerRequestPolicies: () => void;
  private connectPromise: Promise<CodexSurfaceSnapshot> | null = null;
  private pluginCatalogPromise: Promise<void> | null = null;
  private pluginCatalogLastAttemptedCwdsKey: string | null = null;
  private pluginCatalogRefreshRequested = false;
  private accountRefreshPromise: Promise<CodexSurfaceSnapshot> | null = null;
  private accountRefreshRequested = false;
  private accountRefreshForceBootstrap = false;
  private accountRefreshOrigin: CodexSurfaceEventOrigin = 'action';
  private chatGptLoginPromise: Promise<CodexSurfaceChatGptLogin> | null = null;
  private surfaceBootstrapPromise: Promise<void> | null = null;
  private bootstrappedAuthenticationKey: string | null = null;
  private lastLoadedAuthenticationIdentityKey: string | null = null;
  private eventSequence = 0;
  private closed = false;
  private state: CodexSurfaceSnapshot = {
    status: 'idle',
    authentication: initialAuthentication(),
    conversations: [],
    activeConversationId: null,
    messages: [],
    clientRequests: [],
    answeredClientRequestIds: [],
    approvals: [],
    models: [],
    modelCatalogStatus: 'notLoaded',
    skills: [],
    skillCatalogStatus: 'notLoaded',
    plugins: [],
    pluginCatalogStatus: 'notLoaded',
    permissionProfiles: [],
    approvalPresets: [],
    approvalPreset: null,
    selectedModelId: null,
    selectedReasoningEffort: null,
    planMode: false,
    contextUsage: null,
    goal: null,
    turnGitDiff: null,
    threadStatus: null,
    rateLimits: null,
    queuedPrompts: [],
    busy: false,
    historyLoading: false,
    error: null,
  };

  constructor(private readonly options: CodexSurfaceOptions = {}) {
    this.defaultMcpServers = normalizeMcpServers(options.mcpServers ?? []);
    for (const extension of options.extensions ?? []) {
      for (const tool of extension.dynamicTools ?? []) {
        const name = tool.name.trim();
        if (!name) throw new Error('Dynamic tool names cannot be empty');
        if (this.dynamicTools.has(name)) throw new Error(`Duplicate dynamic tool '${name}'`);
        this.dynamicTools.set(name, { ...tool, name });
      }
    }
    const transportOptions = surfaceTransportOptions(options);
    this.client = options.client ?? new CodexAppServerClient(new CodexAppServerStdioTransport(
      transportOptions,
    ));
    this.unsubscribeNotification = this.client.onNotification((notification) => this.handleNotification(notification));
    this.unsubscribeDisconnect = this.client.onDisconnect((error) => this.handleDisconnect(error));
    this.unsubscribeApprovals = registerCodexApprovalHandlers(this.client, (pending) => {
      this.pendingApprovals.set(pending.approval.id, pending);
      const runtime = this.createRuntime(pending.approval.conversationId, { busy: true });
      if (pending.approval.turnId) this.markRuntimeTurnActive(runtime, pending.approval.turnId);
      this.patchRuntime(pending.approval.conversationId, { busy: true });
      this.patchConversationStatus(pending.approval.conversationId, 'active');
      this.refreshActiveApprovals();
      this.emitEvent('notification', {
        type: 'approval.requested',
        conversationId: pending.approval.conversationId,
        ...(pending.approval.turnId ? { turnId: pending.approval.turnId } : {}),
        payload: { approval: structuredClone(pending.approval) },
      });
      this.emitConversationActivity(pending.approval.conversationId, 'notification');
    });
    this.unsubscribeToolInputRequests = this.client.onServerRequest(
      'item/tool/requestUserInput',
      (request, responder) => this.handleToolInputRequest(request, responder),
    );
    this.unsubscribeMcpElicitationRequests = this.client.onServerRequest(
      'mcpServer/elicitation/request',
      (request, responder) => this.handleMcpElicitationRequest(request, responder),
    );
    const policyUnsubscribers = [
      this.client.onServerRequest('item/tool/call', async (request, responder) => {
        await this.handleDynamicToolCall(request, responder);
        return true;
      }),
      this.client.onServerRequest('account/chatgptAuthTokens/refresh', (_request, responder) => {
        responder.reject({ code: -32601, message: 'ChatGPT token refresh must be provided by the host application' });
        return true;
      }),
      this.client.onServerRequest('attestation/generate', (_request, responder) => {
        responder.reject({ code: -32601, message: 'Client attestation must be provided by the host application' });
        return true;
      }),
      this.client.onServerRequest('currentTime/read', (_request, responder) => {
        responder.resolve({ currentTimeAt: Math.floor(Date.now() / 1000) });
        return true;
      }),
    ];
    this.unsubscribeServerRequestPolicies = () => {
      for (const unsubscribe of policyUnsubscribers) unsubscribe();
    };
  }

  connect(): Promise<CodexSurfaceSnapshot> {
    if (this.state.status === 'ready') {
      return Promise.resolve(this.getSnapshot());
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    if (this.closed) {
      return Promise.reject(new Error('Codex surface is closed'));
    }

    this.patch({ status: 'connecting', error: null });
    this.emitSurfaceStatus('lifecycle');
    this.connectPromise = (async () => {
      try {
        // A restarted app-server must repopulate global state even when the
        // authenticated account is unchanged from the previous process.
        this.bootstrappedAuthenticationKey = null;
        this.pluginCatalogLastAttemptedCwdsKey = null;
        this.pluginCatalogRefreshRequested = true;
        this.catalogIconDataUrls.clear();
        this.resetAppServerSessionState();
        await this.client.start();
        const clientInfo = this.options.clientInfo ?? {
          name: 'codex_app_sdk',
          title: 'Codex Surface',
          version: '0.1.0',
        };
        await this.client.initialize({
          clientInfo: {
            name: clientInfo.name,
            title: clientInfo.title ?? null,
            version: clientInfo.version,
          },
          capabilities: { experimentalApi: true, requestAttestation: false },
        });
        const authenticationChanged = await this.loadAuthentication('lifecycle');
        if (authenticationChanged || this.authenticationBlocksBootstrap()) {
          await this.clearAuthenticatedSurfaceData();
        }
        if (!this.authenticationBlocksBootstrap()) await this.bootstrapSurfaceData();
        this.patch({ status: 'ready', error: null });
        this.emitSurfaceStatus('lifecycle');
        if (!this.authenticationBlocksBootstrap()) this.schedulePluginCatalogRefresh();
        return this.getSnapshot();
      } catch (error) {
        this.patch({ status: 'error', error: errorMessage(error) });
        this.emitSurfaceStatus('lifecycle');
        throw error;
      } finally {
        this.connectPromise = null;
      }
    })();
    return this.connectPromise;
  }

  async refreshAccount(): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    return this.refreshAuthentication('action', true);
  }

  async startChatGptLogin(): Promise<CodexSurfaceChatGptLogin> {
    await this.ensureConnected();
    const current = this.state.authentication.login;
    if (current.status === 'pending' && current.loginId && current.authUrl) {
      return { loginId: current.loginId, authUrl: current.authUrl };
    }
    if (this.chatGptLoginPromise) return this.chatGptLoginPromise;
    const start = (async () => {
      this.patchAuthentication({
        login: { status: 'starting', loginId: null, authUrl: null, error: null },
      }, 'action');
      try {
        const response = await this.client.request('account/login/start', { type: 'chatgpt' });
        if (response.type !== 'chatgpt') {
          throw new Error(`Codex account/login/start returned unexpected login type '${response.type}'`);
        }
        const loginId = normalizedLoginId(response.loginId);
        const authUrl = safeLoginUrl(response.authUrl);
        this.patchAuthentication({
          login: { status: 'pending', loginId, authUrl, error: null },
        }, 'action');
        return { loginId, authUrl };
      } catch (error) {
        this.patchAuthentication({
          login: {
            status: 'error',
            loginId: null,
            authUrl: null,
            error: errorMessage(error),
          },
        }, 'action');
        throw error;
      }
    })();
    this.chatGptLoginPromise = start;
    void start.finally(() => {
      if (this.chatGptLoginPromise === start) this.chatGptLoginPromise = null;
    }).catch(() => undefined);
    return start;
  }

  async cancelLogin(loginId = this.state.authentication.login.loginId ?? ''): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const normalized = normalizedLoginId(loginId);
    const response = await this.client.request('account/login/cancel', { loginId: normalized });
    this.patchAuthentication({
      login: {
        status: response.status === 'canceled' ? 'cancelled' : 'idle',
        loginId: null,
        authUrl: null,
        error: null,
      },
    }, 'action');
    return this.getSnapshot();
  }

  async logout(): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    await this.client.request('account/logout', undefined);
    this.patchAuthentication({
      login: { status: 'idle', loginId: null, authUrl: null, error: null },
    }, 'action');
    const authenticationChanged = await this.loadAuthentication('action');
    if (authenticationChanged || this.authenticationBlocksBootstrap()) {
      await this.clearAuthenticatedSurfaceData();
    }
    if (!this.authenticationBlocksBootstrap()) await this.bootstrapSurfaceData(true);
    return this.getSnapshot();
  }

  private refreshAuthentication(
    origin: CodexSurfaceEventOrigin,
    forceBootstrap = false,
  ): Promise<CodexSurfaceSnapshot> {
    this.accountRefreshRequested = true;
    this.accountRefreshForceBootstrap ||= forceBootstrap;
    this.accountRefreshOrigin = origin;
    if (this.accountRefreshPromise) return this.accountRefreshPromise;
    const refresh = (async () => {
      while (this.accountRefreshRequested) {
        const refreshOrigin = this.accountRefreshOrigin;
        const refreshForceBootstrap = this.accountRefreshForceBootstrap;
        this.accountRefreshRequested = false;
        this.accountRefreshForceBootstrap = false;
        try {
          const authenticationChanged = await this.loadAuthentication(refreshOrigin);
          if (authenticationChanged || this.authenticationBlocksBootstrap()) {
            await this.clearAuthenticatedSurfaceData();
          }
          if (!this.authenticationBlocksBootstrap()) {
            await this.bootstrapSurfaceData(refreshForceBootstrap);
          }
        } catch (error) {
          if (!this.accountRefreshRequested) throw error;
          this.accountRefreshForceBootstrap ||= refreshForceBootstrap;
        }
      }
      return this.getSnapshot();
    })();
    this.accountRefreshPromise = refresh;
    void refresh.finally(() => {
      if (this.accountRefreshPromise === refresh) this.accountRefreshPromise = null;
    }).catch(() => undefined);
    return refresh;
  }

  private async loadAuthentication(origin: CodexSurfaceEventOrigin): Promise<boolean> {
    const previousAuthenticationIdentityKey = this.lastLoadedAuthenticationIdentityKey;
    this.patchAuthentication({ status: 'loading', error: null }, origin);
    try {
      const response = await this.client.request('account/read', { refreshToken: false });
      const account = response.account ? surfaceAccount(response.account) : null;
      const authentication = {
        ...this.state.authentication,
        account,
        requiresOpenaiAuth: response.requiresOpenaiAuth,
      };
      const authenticationIdentityKey = surfaceAuthenticationIdentityKey(authentication);
      this.patchAuthentication({
        status: 'loaded',
        account,
        requiresOpenaiAuth: response.requiresOpenaiAuth,
        error: null,
      }, origin);
      this.lastLoadedAuthenticationIdentityKey = authenticationIdentityKey;
      return previousAuthenticationIdentityKey !== null
        && previousAuthenticationIdentityKey !== authenticationIdentityKey;
    } catch (error) {
      this.patchAuthentication({
        status: 'error',
        error: errorMessage(error),
      }, origin);
      throw error;
    }
  }

  private authenticationBlocksBootstrap(): boolean {
    const authentication = this.state.authentication;
    return authentication.status === 'loaded'
      && authentication.account === null
      && authentication.requiresOpenaiAuth === true;
  }

  private bootstrapSurfaceData(force = false): Promise<void> {
    const authenticationKey = surfaceAuthenticationKey(this.state.authentication);
    if (!force && this.bootstrappedAuthenticationKey === authenticationKey) return Promise.resolve();
    if (this.surfaceBootstrapPromise) {
      const pending = this.surfaceBootstrapPromise;
      return pending.then(() => {
        if (this.surfaceBootstrapPromise === pending) this.surfaceBootstrapPromise = null;
        return this.bootstrapSurfaceData(force);
      });
    }
    const bootstrap = (async () => {
      await Promise.all([
        this.loadModels(),
        this.loadSkills(force),
        this.loadPermissionProfiles(),
        this.loadRateLimits(),
        this.loadConversations(),
      ]);
      const activeConversation = this.state.activeConversationId
        ? this.state.conversations.find((conversation) => conversation.id === this.state.activeConversationId)
        : undefined;
      const conversationToResume = activeConversation
        ?? (this.options.autoSelectFirstConversation === false ? undefined : this.state.conversations[0]);
      if (conversationToResume && !this.runtimes.get(conversationToResume.id)?.hydrated) {
        await this.resumeConversation(conversationToResume.id);
      }
      this.bootstrappedAuthenticationKey = authenticationKey;
      this.schedulePluginCatalogRefresh(force);
    })();
    this.surfaceBootstrapPromise = bootstrap;
    void bootstrap.finally(() => {
      if (this.surfaceBootstrapPromise === bootstrap) this.surfaceBootstrapPromise = null;
    }).catch(() => undefined);
    return bootstrap;
  }

  private resetAppServerSessionState(): void {
    this.runtimes.clear();
    this.hydrationPromises.clear();
    this.historyHydrationPromises.clear();
    this.commandOutputForwardItemIds.clear();
    this.semanticEventValues.clear();
  }

  private async clearAuthenticatedSurfaceData(): Promise<void> {
    const pendingBootstrap = this.surfaceBootstrapPromise;
    if (pendingBootstrap) await pendingBootstrap.catch(() => undefined);
    for (const pending of this.pendingApprovals.values()) pending.resolve('deny', 'once');
    for (const pending of this.pendingClientRequests.values()) pending.responder.reject('Codex account signed out');
    this.pendingApprovals.clear();
    this.pendingClientRequests.clear();
    this.runtimes.clear();
    this.hydrationPromises.clear();
    this.historyHydrationPromises.clear();
    this.conversationHandles.clear();
    this.hostOptionsByThread.clear();
    this.commandOutputForwardItemIds.clear();
    this.catalogIconDataUrls.clear();
    this.semanticEventValues.clear();
    this.bootstrappedAuthenticationKey = null;
    this.pluginCatalogLastAttemptedCwdsKey = null;
    this.pluginCatalogRefreshRequested = true;
    this.patch({
      conversations: [],
      activeConversationId: null,
      messages: [],
      clientRequests: [],
      answeredClientRequestIds: [],
      approvals: [],
      models: [],
      modelCatalogStatus: 'notLoaded',
      skills: [],
      skillCatalogStatus: 'notLoaded',
      plugins: [],
      pluginCatalogStatus: 'notLoaded',
      permissionProfiles: [],
      approvalPresets: [],
      approvalPreset: null,
      selectedModelId: null,
      selectedReasoningEffort: null,
      planMode: false,
      contextUsage: null,
      goal: null,
      turnGitDiff: null,
      threadStatus: null,
      rateLimits: null,
      queuedPrompts: [],
      busy: false,
      historyLoading: false,
      error: null,
    });
  }

  private patchAuthentication(
    patch: Partial<CodexSurfaceAuthentication>,
    origin: CodexSurfaceEventOrigin,
  ): void {
    const authentication = { ...this.state.authentication, ...patch };
    this.patch({ authentication });
    this.emitEvent(origin, {
      type: 'authentication.changed',
      payload: { authentication: structuredClone(authentication) },
    });
  }

  async refreshConversations(): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    return this.loadConversations();
  }

  private async loadConversations(): Promise<CodexSurfaceSnapshot> {
    const conversations = await this.requestConversations({ limit: this.options.conversationLimit });
    this.patch({ conversations });
    this.schedulePluginCatalogRefresh(true);
    for (const summary of conversations) {
      this.emitSummaryUpserted(summary, 'listed', 'action');
    }
    return this.getSnapshot();
  }

  async listConversations(options: ListCodexConversationsOptions = {}): Promise<CodexConversationSummary[]> {
    await this.ensureConnected();
    return structuredClone(await this.requestConversations(options));
  }

  async archiveConversation(conversationId: string): Promise<CodexSurfaceSnapshot> {
    const threadId = normalizedConversationId(conversationId);
    await this.ensureConnected();
    await this.client.request('thread/archive', { threadId });
    this.removeThread(threadId, 'archived', 'action');
    return this.getSnapshot();
  }

  async deleteConversation(conversationId: string): Promise<CodexSurfaceSnapshot> {
    const threadId = normalizedConversationId(conversationId);
    await this.ensureConnected();
    await this.client.request('thread/delete', { threadId });
    this.removeThread(threadId, 'deleted', 'action');
    return this.getSnapshot();
  }

  async unarchiveConversation(conversationId: string): Promise<CodexSurfaceSnapshot> {
    const threadId = normalizedConversationId(conversationId);
    await this.ensureConnected();
    const response = await this.client.request('thread/unarchive', { threadId });
    if (response.thread.id !== threadId) {
      throw new Error(`Codex thread/unarchive returned '${response.thread.id}' for requested thread '${threadId}'`);
    }
    const summary = this.summaryWithKnownTurnCount(response.thread);
    this.patch({ conversations: upsertConversation(this.state.conversations, summary) });
    this.emitSummaryUpserted(summary, 'updated', 'action');
    return this.getSnapshot();
  }

  private async requestConversations(
    options: ListCodexConversationsOptions = {},
  ): Promise<CodexConversationSummary[]> {
    const conversations: CodexConversationSummary[] = [];
    const totalLimit = options.limit === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(options.limit));
    let cursor: string | null | undefined = null;
    do {
      const limit = Math.min(100, totalLimit - conversations.length);
      if (limit <= 0) break;
      const response: v2.ThreadListResponse = await this.client.request('thread/list', {
        archived: options.archived ?? false,
        cursor,
        limit,
        sortDirection: 'desc',
        sortKey: 'updated_at',
        ...(options.cwd === undefined
          ? {}
          : { cwd: typeof options.cwd === 'string' ? options.cwd : [...options.cwd] }),
        ...(options.searchTerm === undefined ? {} : { searchTerm: options.searchTerm }),
      });
      conversations.push(...response.data.map((thread) => this.summaryWithKnownTurnCount(thread)));
      cursor = response.nextCursor;
    } while (cursor && conversations.length < totalLimit);
    return conversations;
  }

  private hydrateCompleteConversationHistory(threadId: string): Promise<void> {
    const runtime = this.requireRuntime(threadId);
    if (runtime.fullHistoryHydrated) return Promise.resolve();
    const existing = this.historyHydrationPromises.get(threadId);
    if (existing) return existing;
    const hydration = (async () => {
      try {
        const requestedCursors = new Set<string>();
        let cursor: string | null = null;
        do {
          if (cursor !== null) {
            if (requestedCursors.has(cursor)) {
              throw new Error(`Codex app-server repeated a thread history cursor for '${threadId}'`);
            }
            requestedCursors.add(cursor);
          }
          const response: v2.ThreadTurnsListResponse = await this.client.request('thread/turns/list', {
            threadId,
            cursor,
            limit: CONVERSATION_HISTORY_PAGE_SIZE,
            sortDirection: 'desc',
            itemsView: 'full',
          });
          this.mergeHydratedHistoryPage(threadId, [...response.data].reverse());
          cursor = response.nextCursor;
        } while (cursor !== null);
        if (!this.runtimes.has(threadId)) return;
        this.patchRuntime(threadId, { fullHistoryHydrated: true });
        this.emitHistoryReplaced(threadId, 'resync', 'action');
      } catch (error) {
        if (this.runtimes.has(threadId)) {
          this.patchRuntime(threadId, { error: `Could not load complete conversation history: ${errorMessage(error)}` });
        }
        throw error;
      }
    })();
    this.historyHydrationPromises.set(threadId, hydration);
    void hydration.finally(() => {
      if (this.historyHydrationPromises.get(threadId) === hydration) {
        this.historyHydrationPromises.delete(threadId);
      }
    }).catch(() => undefined);
    return hydration;
  }

  private mergeHydratedHistoryPage(threadId: string, turns: readonly v2.Turn[]): void {
    const current = this.runtimes.get(threadId);
    if (!current) return;
    const protectedTurnIds = new Set<string>();
    if (current.activeTurnId) protectedTurnIds.add(current.activeTurnId);
    for (const turn of turns) {
      if (turn.status === 'inProgress' && current.turnIds.includes(turn.id)) protectedTurnIds.add(turn.id);
    }
    const replaceableTurnIds = new Set(turns
      .filter((turn) => !protectedTurnIds.has(turn.id))
      .map((turn) => turn.id));
    const historicalTurns = turns.filter((turn) => replaceableTurnIds.has(turn.id));
    const preservedTurnIds = current.turnIds.filter((turnId) => !replaceableTurnIds.has(turnId));
    const preservedMessages = current.messages.filter((message) => (
      message.turnId === undefined || !replaceableTurnIds.has(message.turnId)
    ));
    const messages = historicalTurns.flatMap((turn) => codexTurnToSurfaceMessages(threadId, turn));
    this.patchRuntime(threadId, {
      turnIds: [...historicalTurns.map((turn) => turn.id), ...preservedTurnIds],
      messages: [...messages, ...preservedMessages],
    });
    const turnCount = this.requireRuntime(threadId).turnIds.length;
    this.patch({
      conversations: this.state.conversations.map((conversation) => conversation.id === threadId
        ? { ...conversation, turnCount }
        : conversation),
    });
    const summary = this.state.conversations.find((conversation) => conversation.id === threadId);
    if (summary) this.emitSummaryUpserted(summary, 'updated', 'action');
  }

  private async refreshCompleteConversationHistory(threadId: string): Promise<void> {
    const existing = this.historyHydrationPromises.get(threadId);
    if (existing) await existing.catch(() => undefined);
    this.requireRuntime(threadId).fullHistoryHydrated = false;
    await this.hydrateCompleteConversationHistory(threadId);
  }

  private async requestModels(includeHidden: boolean): Promise<CodexSurfaceModel[]> {
    const models: CodexSurfaceModel[] = [];
    let cursor: string | null | undefined = null;
    do {
      const response: v2.ModelListResponse = await this.client.request('model/list', {
        cursor,
        includeHidden,
      });
      models.push(...response.data.map(codexModelToSurfaceModel));
      cursor = response.nextCursor;
    } while (cursor);
    return models;
  }

  async listModels(options: ListCodexModelsOptions = {}): Promise<CodexSurfaceModel[]> {
    await this.ensureConnected();
    const includeHidden = options.includeHidden ?? false;
    const forceReload = options.forceReload ?? true;
    if (!forceReload && !includeHidden && this.state.modelCatalogStatus === 'loaded') {
      return structuredClone(this.state.models);
    }
    const models = await this.requestModels(includeHidden);
    if (!includeHidden) {
      const selected = selectedModel(models, this.state.selectedModelId);
      this.patch({
        models,
        modelCatalogStatus: 'loaded',
        selectedModelId: selected?.id ?? null,
        selectedReasoningEffort: selected ? defaultReasoningEffort(selected) : null,
      });
      this.emitEvent('action', {
        type: 'catalog.modelsChanged',
        payload: { models: structuredClone(models), status: 'loaded' },
      });
    }
    return structuredClone(models);
  }

  private async loadModels(): Promise<void> {
    this.patch({ modelCatalogStatus: 'loading' });
    this.emitEvent('action', {
      type: 'catalog.modelsChanged',
      payload: { models: [], status: 'loading' },
    });
    try {
      const models = await this.requestModels(false);
      const selected = selectedModel(models, this.state.selectedModelId);
      this.patch({
        models,
        modelCatalogStatus: 'loaded',
        selectedModelId: selected?.id ?? null,
        selectedReasoningEffort: selected ? defaultReasoningEffort(selected) : null,
      });
      this.emitEvent('action', {
        type: 'catalog.modelsChanged',
        payload: { models: structuredClone(models), status: 'loaded' },
      });
    } catch {
      this.patch({ modelCatalogStatus: 'error', models: [] });
      this.emitEvent('action', {
        type: 'catalog.modelsChanged',
        payload: { models: [], status: 'error' },
      });
    }
  }

  private async loadSkills(
    forceReload = false,
    origin: CodexSurfaceEventOrigin = 'action',
  ): Promise<void> {
    if (forceReload) this.catalogIconDataUrls.clear();
    this.patch({ skillCatalogStatus: 'loading' });
    this.emitEvent(origin, {
      type: 'catalog.skillsChanged',
      payload: { cwd: this.options.cwd ?? null, skills: [], status: 'loading' },
    });
    try {
      const response = await this.client.request('skills/list', {
        ...(this.options.cwd ? { cwds: [this.options.cwd] } : {}),
        forceReload,
      });
      const skills = await surfaceSkills(
        response.data.flatMap((entry) => entry.skills),
        (path) => this.catalogIconDataUrl(path),
      );
      this.patch({ skills, skillCatalogStatus: 'loaded' });
      this.emitEvent(origin, {
        type: 'catalog.skillsChanged',
        payload: { cwd: this.options.cwd ?? null, skills: structuredClone(skills), status: 'loaded' },
      });
    } catch {
      this.patch({ skills: [], skillCatalogStatus: 'error' });
      this.emitEvent(origin, {
        type: 'catalog.skillsChanged',
        payload: { cwd: this.options.cwd ?? null, skills: [], status: 'error' },
      });
    }
  }

  private schedulePluginCatalogRefresh(force = false): void {
    if (this.closed || this.state.status !== 'ready' || this.authenticationBlocksBootstrap()) return;
    const scope = this.pluginCatalogScope();
    if (force) {
      this.pluginCatalogLastAttemptedCwdsKey = null;
      this.pluginCatalogRefreshRequested = true;
    }
    if (this.pluginCatalogPromise) return;
    if (!this.pluginCatalogRefreshRequested && this.pluginCatalogLastAttemptedCwdsKey === scope.key) return;
    this.pluginCatalogRefreshRequested = false;
    this.patch({ pluginCatalogStatus: 'loading' });
    this.emitEvent('action', {
      type: 'catalog.pluginsChanged',
      payload: { plugins: structuredClone(this.state.plugins), status: 'loading' },
    });
    const loading = this.loadPluginCatalog(scope.cwds, scope.key);
    this.pluginCatalogPromise = loading;
    void loading.finally(() => {
      if (this.pluginCatalogPromise === loading) this.pluginCatalogPromise = null;
      if (this.pluginCatalogRefreshRequested || this.pluginCatalogScope().key !== scope.key) {
        this.schedulePluginCatalogRefresh();
      }
    }).catch(() => undefined);
  }

  private pluginCatalogScope(): { cwds: string[]; key: string } {
    const cwds = [...new Set([
      this.options.cwd,
      ...this.state.conversations.map((conversation) => conversation.cwd),
      ...[...this.runtimes.values()].map((runtime) => runtime.cwd ?? undefined),
    ].filter((cwd): cwd is string => typeof cwd === 'string' && cwd.trim().length > 0))].sort();
    return { cwds, key: JSON.stringify(cwds) };
  }

  private async loadPluginCatalog(cwds: readonly string[], key: string): Promise<void> {
    this.pluginCatalogLastAttemptedCwdsKey = key;
    try {
      const response = await this.client.request('plugin/installed', {
        ...(cwds.length > 0 ? { cwds: [...cwds] } : {}),
      });
      const summaries = new Map<string, v2.PluginSummary>();
      for (const marketplace of response.marketplaces) {
        for (const plugin of marketplace.plugins) {
          if (!summaries.has(plugin.id)) summaries.set(plugin.id, plugin);
        }
      }
      const plugins = await Promise.all(
        [...summaries.values()].map((plugin) => surfacePlugin(plugin, (path) => this.catalogIconDataUrl(path))),
      );
      if (this.closed || this.authenticationBlocksBootstrap()) return;
      this.patch({ plugins, pluginCatalogStatus: 'loaded' });
      this.emitEvent('action', {
        type: 'catalog.pluginsChanged',
        payload: { plugins: structuredClone(plugins), status: 'loaded' },
      });
    } catch {
      if (this.closed || this.authenticationBlocksBootstrap()) return;
      this.pluginCatalogLastAttemptedCwdsKey = null;
      this.patch({ pluginCatalogStatus: 'error' });
      this.emitEvent('action', {
        type: 'catalog.pluginsChanged',
        payload: { plugins: structuredClone(this.state.plugins), status: 'error' },
      });
    }
  }

  private catalogIconDataUrl(path: string): Promise<string | undefined> {
    const existing = this.catalogIconDataUrls.get(path);
    if (existing) return existing;
    const materialized = this.readCatalogIconDataUrl(path);
    this.catalogIconDataUrls.set(path, materialized);
    return materialized;
  }

  private async readCatalogIconDataUrl(path: string): Promise<string | undefined> {
    if (!isAbsolute(path)) return undefined;
    const mimeType = catalogIconMimeType(path);
    if (!mimeType) return undefined;
    try {
      const response = await this.client.request('fs/readFile', { path });
      return boundedImageDataUrl(mimeType, response.dataBase64);
    } catch {
      return undefined;
    }
  }

  async listSkills(options: ListCodexSkillsOptions = {}): Promise<CodexSurfaceSkill[]> {
    await this.ensureConnected();
    if (options.forceReload) this.catalogIconDataUrls.clear();
    const response = await this.client.request('skills/list', {
      ...(options.cwd ? { cwds: [options.cwd] } : {}),
      forceReload: options.forceReload ?? false,
    });
    const skills = await surfaceSkills(
      response.data.flatMap((entry) => entry.skills),
      (path) => this.catalogIconDataUrl(path),
    );
    for (const runtime of this.runtimes.values()) {
      if (runtime.cwd !== (options.cwd ?? null)) continue;
      this.patchRuntime(runtime.threadId, { skills, skillCatalogStatus: 'loaded' });
      this.emitConversationSkills(runtime.threadId, 'action');
    }
    this.emitEvent('action', {
      type: 'catalog.skillsChanged',
      payload: { cwd: options.cwd ?? null, skills: structuredClone(skills), status: 'loaded' },
    });
    return structuredClone(skills);
  }

  private async loadPermissionProfiles(): Promise<void> {
    try {
      const profiles: CodexSurfaceSnapshot['permissionProfiles'] = [];
      let cursor: string | null | undefined = null;
      do {
        const response: v2.PermissionProfileListResponse = await this.client.request('permissionProfile/list', {
          cursor,
          ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
        });
        profiles.push(...response.data);
        cursor = response.nextCursor;
      } while (cursor);
      const requirements = (await this.client.request('configRequirements/read', undefined)).requirements;
      const approvalPresets = approvalPresetsForProfiles(profiles, requirements);
      const preferred = this.preferredApprovalPreset();
      this.patch({
        permissionProfiles: profiles,
        approvalPresets,
        approvalPreset: preferred
          ? (approvalPresets.includes(preferred) ? preferred : approvalPresets[0] ?? null)
          : null,
      });
      this.emitEvent('action', {
        type: 'catalog.permissionsChanged',
        payload: {
          cwd: this.options.cwd ?? null,
          permissionProfiles: structuredClone(profiles),
          approvalPresets: [...approvalPresets],
        },
      });
    } catch {
      this.patch({
        permissionProfiles: [],
        approvalPresets: [],
        approvalPreset: null,
      });
      this.emitEvent('action', {
        type: 'catalog.permissionsChanged',
        payload: { cwd: this.options.cwd ?? null, permissionProfiles: [], approvalPresets: [] },
      });
    }
  }

  private async loadRateLimits(): Promise<void> {
    try {
      const rateLimits = await this.client.request('account/rateLimits/read', undefined);
      this.patch({ rateLimits: surfaceRateLimits(rateLimits) });
      this.emitEvent('action', {
        type: 'rateLimits.changed',
        payload: { rateLimits: structuredClone(this.state.rateLimits) },
      });
    } catch {
      // Rate limits are account-dependent and unavailable for some app-server sessions.
      this.patch({ rateLimits: null });
      this.emitEvent('action', { type: 'rateLimits.changed', payload: { rateLimits: null } });
    }
  }

  private async loadConversationCatalogs(cwd: string | undefined, forceReload = false): Promise<ConversationCatalogs> {
    if (!forceReload && cwd === this.options.cwd && this.state.skillCatalogStatus !== 'notLoaded') {
      return {
        skills: [...this.state.skills],
        skillCatalogStatus: this.state.skillCatalogStatus,
        permissionProfiles: [...this.state.permissionProfiles],
        approvalPresets: [...this.state.approvalPresets],
      };
    }
    const [skillResult, permissionResult] = await Promise.allSettled([
      this.client.request('skills/list', {
        ...(cwd ? { cwds: [cwd] } : {}),
        forceReload,
      }),
      (async () => {
        const profiles: CodexSurfaceSnapshot['permissionProfiles'] = [];
        let cursor: string | null | undefined = null;
        do {
          const response: v2.PermissionProfileListResponse = await this.client.request('permissionProfile/list', {
            cursor,
            ...(cwd ? { cwd } : {}),
          });
          profiles.push(...response.data);
          cursor = response.nextCursor;
        } while (cursor);
        const requirements = (await this.client.request('configRequirements/read', undefined)).requirements;
        return { profiles, requirements };
      })(),
    ]);
    const skills = skillResult.status === 'fulfilled'
      ? await surfaceSkills(
        skillResult.value.data.flatMap((entry) => entry.skills),
        (path) => this.catalogIconDataUrl(path),
      )
      : [];
    const permissionProfiles = permissionResult.status === 'fulfilled'
      ? permissionResult.value.profiles
      : [];
    return {
      skills,
      skillCatalogStatus: skillResult.status === 'fulfilled' ? 'loaded' : 'error',
      permissionProfiles,
      approvalPresets: permissionResult.status === 'fulfilled'
        ? approvalPresetsForProfiles(permissionProfiles, permissionResult.value.requirements)
        : [],
    };
  }

  async createConversation(
    options: CreateCodexConversationOptions = {},
    hostOptions: CodexConversationHostOptions = {},
  ): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    options = { ...this.options.conversationDefaults, ...options };
    const cwd = options.cwd ?? this.options.cwd;
    const catalogs = await this.loadConversationCatalogs(cwd);
    if (options.approvalPreset && !catalogs.approvalPresets.includes(options.approvalPreset)) {
      throw new Error(`Approval preset '${options.approvalPreset}' is not available`);
    }
    const inheritedApprovalPreset = options.approvalPreset
      ?? (options.approvalMode === undefined
        && options.permissionMode === undefined
        && this.state.approvalPreset
        && catalogs.approvalPresets.includes(this.state.approvalPreset)
        ? this.state.approvalPreset
        : undefined);
    const settings = this.threadStartSettings({
      ...options,
      ...(inheritedApprovalPreset ? { approvalPreset: inheritedApprovalPreset } : {}),
    }, catalogs.approvalPresets);
    const currentModel = selectedModel(this.state.models, this.state.selectedModelId);
    const requestedModel = options.model
      ? requireCatalogModel(this.state.models, options.model)
      : currentModel;
    const model = requestedModel?.model;
    const requestedReasoningEffort = options.reasoningEffort
      ?? (requestedModel?.id === currentModel?.id
        ? this.state.selectedReasoningEffort
        : requestedModel ? defaultReasoningEffort(requestedModel) : null)
      ?? undefined;
    validateReasoningEffort(requestedModel, requestedReasoningEffort);
    const mcpServers = hostOptions.mcpServers === undefined
      ? this.defaultMcpServers
      : normalizeMcpServers(hostOptions.mcpServers);
    const extension = await this.conversationExtension({
      operation: 'start',
      conversationId: null,
      cwd,
      createOptions: options,
      extensionContext: hostOptions.extensionContext,
    }, options, mcpServers);
    const response = await this.client.request('thread/start', {
      ...(cwd ? { cwd } : {}),
      ...(model ? { model } : {}),
      ...(extension.baseInstructions === undefined ? {} : { baseInstructions: extension.baseInstructions }),
      ...(extension.developerInstructions === undefined
        ? {}
        : { developerInstructions: extension.developerInstructions }),
      ...(extension.config === undefined ? {} : { config: extension.config as v2.ThreadStartParams['config'] }),
      ...(this.dynamicTools.size === 0 ? {} : { dynamicTools: this.dynamicToolSpecs() }),
      ...settings,
      serviceName: 'codex_app_sdk',
    });
    const selection = sessionSelection(response, this.state.models, this.state);
    if (requestedReasoningEffort) {
      await this.client.request('thread/settings/update', {
        threadId: response.thread.id,
        effort: requestedReasoningEffort,
        ...(requestedModel ? {
          collaborationMode: collaborationMode(
            this.state.planMode,
            requestedModel.model,
            requestedReasoningEffort,
          ),
        } : {}),
      });
      selection.selectedReasoningEffort = requestedReasoningEffort;
    }
    if (requestedModel) selection.selectedModelId = requestedModel.id;
    if (inheritedApprovalPreset) selection.approvalPreset = inheritedApprovalPreset;
    const runtime = this.createRuntime(response.thread.id, {
      hydrated: true,
      cwd: response.cwd ?? response.thread.cwd,
      activeTurnId: null,
      turnIds: [],
      messages: [],
      answeredClientRequestIds: [],
      threadStatus: surfaceThreadStatus(response.thread.status),
      ...catalogs,
      ...selection,
    });
    this.hostOptionsByThread.set(response.thread.id, {
      ...(cwd ? { cwd } : {}),
      ...hostOptions,
      mcpServers,
    });
    const summary = threadToSummary(response.thread);
    this.patch({
      activeConversationId: response.thread.id,
      conversations: upsertConversation(this.state.conversations, summary),
      ...this.runtimeProjection(runtime),
    });
    this.emitSummaryUpserted(summary, 'created', 'action');
    this.emitEvent('action', {
      type: 'conversation.selected',
      payload: { conversationId: response.thread.id },
    });
    this.emitConversationActivity(response.thread.id, 'action');
    this.emitConversationSettings(response.thread.id, 'action');
    this.emitConversationSkills(response.thread.id, 'action');
    this.emitConversationPermissions(response.thread.id, 'action');
    return this.getSnapshot();
  }

  async selectConversation(conversationId: string): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const runtime = this.runtimes.get(conversationId);
    if (runtime?.hydrated && (runtime.busy || runtime.activeTurnId !== null)) {
      this.activateRuntime(runtime);
      return this.getSnapshot();
    }
    return this.resumeConversation(conversationId);
  }

  private async resumeConversation(
    conversationId: string,
    activate = true,
    loadOptions: CodexConversationLoadOptions = {},
    historyReason: 'load' | 'resume' = 'resume',
  ): Promise<CodexSurfaceSnapshot> {
    const requestedHostOptions = { ...this.hostOptionsByThread.get(conversationId), ...loadOptions };
    const hostOptions = {
      ...requestedHostOptions,
      mcpServers: requestedHostOptions.mcpServers === undefined
        ? this.defaultMcpServers
        : normalizeMcpServers(requestedHostOptions.mcpServers),
    };
    this.hostOptionsByThread.set(conversationId, hostOptions);
    const extension = await this.conversationExtension({
      operation: 'resume',
      conversationId,
      cwd: hostOptions.cwd,
      extensionContext: hostOptions.extensionContext,
    }, {}, hostOptions.mcpServers);
    const loadingRuntime = this.createRuntime(conversationId, { historyLoading: true, error: null });
    if (activate) this.activateRuntime(loadingRuntime);
    try {
      const [response, goal] = await Promise.all([
        this.client.request('thread/resume', {
          threadId: conversationId,
          excludeTurns: true,
          initialTurnsPage: {
            limit: CONVERSATION_HISTORY_PAGE_SIZE,
            sortDirection: 'desc',
            itemsView: 'summary',
          },
          ...(hostOptions.cwd ? { cwd: hostOptions.cwd } : {}),
          ...(extension.baseInstructions === undefined ? {} : { baseInstructions: extension.baseInstructions }),
          ...(extension.developerInstructions === undefined
            ? {}
            : { developerInstructions: extension.developerInstructions }),
          ...(extension.config === undefined ? {} : { config: extension.config as v2.ThreadResumeParams['config'] }),
        }),
        this.client.request('thread/goal/get', { threadId: conversationId })
          .then((result) => result.goal)
          .catch(() => null),
      ]);
      if (response.thread.id !== conversationId) {
        throw new Error(`Codex thread/resume returned '${response.thread.id}' for requested thread '${conversationId}'`);
      }
      const initialPage = response.initialTurnsPage ?? await this.client.request('thread/turns/list', {
        threadId: response.thread.id,
        cursor: null,
        limit: CONVERSATION_HISTORY_PAGE_SIZE,
        sortDirection: 'desc',
        itemsView: 'summary',
      });
      const turns = [...initialPage.data].reverse();
      const cwd = response.cwd ?? response.thread.cwd ?? hostOptions.cwd;
      const catalogs = await this.loadConversationCatalogs(cwd);
      const runningTurnId = activeTurnId(turns);
      const historyMessages = codexThreadToSurfaceMessages({ ...response.thread, turns });
      const messages = runningTurnId
        ? ensureAssistantTurnMessage(historyMessages, response.thread.id, runningTurnId)
        : historyMessages;
      const runtime = this.createRuntime(response.thread.id, {
        hydrated: true,
        fullHistoryHydrated: false,
        cwd: cwd ?? null,
        historyLoading: false,
        activeTurnId: runningTurnId,
        turnIds: turns.map((turn) => turn.id),
        messages,
        busy: Boolean(runningTurnId),
        goal: goal ? { ...goal } : null,
        threadStatus: surfaceThreadStatus(response.thread.status),
        ...catalogs,
        ...sessionSelection(response, this.state.models, this.snapshotForRuntime(loadingRuntime)),
      });
      const summary = { ...threadToSummary(response.thread), turnCount: turns.length };
      this.patch({
        conversations: upsertConversation(this.state.conversations, summary),
        ...(this.state.activeConversationId === response.thread.id ? this.runtimeProjection(runtime) : {}),
      });
      this.emitSummaryUpserted(summary, 'resumed', 'action');
      this.emitHistoryReplaced(response.thread.id, historyReason, 'action');
      this.emitConversationActivity(response.thread.id, 'action');
      this.emitConversationSettings(response.thread.id, 'action');
      this.emitConversationSkills(response.thread.id, 'action');
      this.emitConversationPermissions(response.thread.id, 'action');
      void this.hydrateCompleteConversationHistory(response.thread.id).catch(() => undefined);
      return this.getSnapshot();
    } catch (error) {
      this.patchRuntime(conversationId, { historyLoading: false, error: errorMessage(error) });
      throw error;
    }
  }

  async readConversationHistory(conversationId = this.state.activeConversationId ?? ''): Promise<CodexConversationHistory> {
    await this.ensureConnected();
    if (!conversationId) throw new Error('There is no active conversation');
    const existing = await this.ensureThreadReady(conversationId);
    if (existing?.busy) {
      return {
        conversationId,
        messages: structuredClone(existing.messages),
        threadStatus: structuredClone(existing.threadStatus),
      };
    }
    const loadingRuntime = this.createRuntime(conversationId, { historyLoading: true, error: null });
    if (this.state.activeConversationId === conversationId) this.activateRuntime(loadingRuntime);
    try {
      const [response] = await Promise.all([
        this.client.request('thread/read', { threadId: conversationId, includeTurns: false }),
        this.refreshCompleteConversationHistory(conversationId),
      ]);
      if (response.thread.id !== conversationId) {
        throw new Error(`Codex thread/read returned '${response.thread.id}' for requested thread '${conversationId}'`);
      }
      const hydratedRuntime = this.requireRuntime(conversationId);
      const runningTurnId = hydratedRuntime.activeTurnId;
      const runtime = this.createRuntime(conversationId, {
        hydrated: true,
        historyLoading: false,
        activeTurnId: runningTurnId,
        turnIds: hydratedRuntime.turnIds,
        messages: hydratedRuntime.messages,
        busy: Boolean(runningTurnId),
        threadStatus: surfaceThreadStatus(response.thread.status),
      });
      const summary = { ...threadToSummary(response.thread), turnCount: runtime.turnIds.length };
      this.patch({
        conversations: upsertConversation(this.state.conversations, summary),
        ...(this.state.activeConversationId === conversationId ? this.runtimeProjection(runtime) : {}),
      });
      this.emitSummaryUpserted(summary, 'updated', 'action');
      this.emitHistoryReplaced(conversationId, 'resync', 'action');
      this.emitConversationActivity(conversationId, 'action');
      return {
        conversationId,
        messages: structuredClone(runtime.messages),
        threadStatus: structuredClone(runtime.threadStatus),
      };
    } catch (error) {
      this.patchRuntime(conversationId, { historyLoading: false, error: errorMessage(error) });
      throw error;
    }
  }

  async renameConversation(title: string): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    await this.renameConversationForThread(threadId, title);
    return this.getSnapshot();
  }

  private async renameConversationForThread(threadId: string, title: string): Promise<void> {
    await this.ensureThreadReady(threadId);
    const name = title.trim();
    if (!name) throw new Error('Conversation title cannot be empty');
    await this.client.request('thread/name/set', { threadId, name });
    this.patch({
      conversations: this.state.conversations.map((conversation) => conversation.id === threadId
        ? { ...conversation, title: name }
        : conversation),
    });
    const summary = this.state.conversations.find((conversation) => conversation.id === threadId);
    if (summary) this.emitSummaryUpserted(summary, 'updated', 'action');
  }

  async updateConversationSettings(settings: UpdateCodexConversationSettings): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) {
      const next = nextSelection(this.state, settings);
      if (settings.approvalPreset && !this.state.approvalPresets.includes(settings.approvalPreset)) {
        throw new Error(`Approval preset '${settings.approvalPreset}' is not available`);
      }
      this.patch(next);
      return this.getSnapshot();
    }
    await this.updateConversationSettingsForThread(threadId, settings);
    return this.getSnapshot();
  }

  private async updateConversationSettingsForThread(
    threadId: string,
    settings: UpdateCodexConversationSettings,
  ): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    const runtimeSnapshot = this.snapshotForRuntime(runtime);
    const next = nextSelection(runtimeSnapshot, settings);
    const changed = runtime.approvalPreset !== next.approvalPreset
      || runtime.selectedModelId !== next.selectedModelId
      || runtime.selectedReasoningEffort !== next.selectedReasoningEffort
      || runtime.planMode !== next.planMode;
    if (settings.approvalPreset && !runtimeSnapshot.approvalPresets.includes(settings.approvalPreset)) {
      throw new Error(`Approval preset '${settings.approvalPreset}' is not available`);
    }

    const model = selectedModel(this.state.models, next.selectedModelId);
    await this.client.request('thread/settings/update', {
      threadId,
      ...(settings.approvalPreset ? approvalPresetUpdateParams(settings.approvalPreset) : {}),
      ...(settings.modelId && model ? { model: model.model } : {}),
      ...(settings.reasoningEffort || settings.modelId ? { effort: next.selectedReasoningEffort } : {}),
      ...(model && (
        typeof settings.planMode === 'boolean'
        || Boolean(settings.modelId)
        || Boolean(settings.reasoningEffort)
      )
        ? { collaborationMode: collaborationMode(next.planMode, model.model, next.selectedReasoningEffort) }
        : {}),
    });
    this.patchRuntime(threadId, next);
    if (changed) this.emitConversationSettings(threadId, 'action');
  }

  async setGoal(objective: string, tokenBudget?: number | null): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    if (!this.state.activeConversationId) await this.createConversation();
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('Codex did not create a conversation');
    await this.setGoalForThread(threadId, objective, tokenBudget);
    return this.getSnapshot();
  }

  private async setGoalForThread(threadId: string, objective: string, tokenBudget?: number | null): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    const normalizedObjective = objective.trim();
    if (!normalizedObjective) throw new Error('Goal objective cannot be empty');
    const response = await this.client.request('thread/goal/set', {
      threadId,
      objective: normalizedObjective,
      status: 'active',
      ...(tokenBudget === undefined ? {} : { tokenBudget }),
    });
    if (response.goal.threadId !== threadId) {
      throw new Error(`Codex thread/goal/set returned a goal for '${response.goal.threadId}' instead of '${threadId}'`);
    }
    const changed = !sameValue(runtime.goal, response.goal);
    this.patchRuntime(threadId, { goal: { ...response.goal } });
    if (changed) {
      this.emitEvent('action', {
        type: 'conversation.goalChanged',
        conversationId: threadId,
        payload: { goal: structuredClone(response.goal) },
      });
    }
  }

  async clearGoal(): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const threadId = this.state.activeConversationId;
    if (!threadId) return this.getSnapshot();
    await this.clearGoalForThread(threadId);
    return this.getSnapshot();
  }

  private async clearGoalForThread(threadId: string): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    await this.client.request('thread/goal/clear', { threadId });
    const changed = runtime.goal !== null;
    this.patchRuntime(threadId, { goal: null });
    if (changed) {
      this.emitEvent('action', {
        type: 'conversation.goalChanged',
        conversationId: threadId,
        payload: { goal: null },
      });
    }
  }

  async sendMessage(prompt: string, options: SendCodexMessageOptions = {}): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    let text = prompt.trim();
    if (!text) throw new Error('Cannot send an empty message');
    if (!this.state.activeConversationId) {
      const planCommand = parsePlanSlashCommand(text);
      if (planCommand) {
        await this.createConversation();
        await this.updateConversationSettings({ planMode: true });
        if (!planCommand.prompt) return this.getSnapshot();
        text = planCommand.prompt;
        options = { ...options, planMode: true };
      }
      const goalCommand = parseGoalSlashCommand(text);
      if (goalCommand) {
        if (goalCommand.action === 'clear' || goalCommand.action === 'show' || goalCommand.action === 'edit') {
          return this.getSnapshot();
        }
        if (goalCommand.action === 'set') return this.setGoal(goalCommand.objective);
        throw new Error('Pausing and resuming goals is not supported by Codex app-server');
      }
      if (text === '/compact') return this.getSnapshot();
      const reviewCommand = parseReviewSlashCommand(text);
      if (reviewCommand) {
        await this.createConversation();
        return this.startReview({ target: reviewCommand });
      }
      await this.createConversation();
    }
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('Codex did not create a conversation');
    await this.sendMessageToThread(threadId, text, options);
    return this.getSnapshot();
  }

  private async sendMessageToThread(
    threadId: string,
    prompt: string,
    options: SendCodexMessageOptions = {},
  ): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    let text = prompt.trim();
    if (!text) {
      throw new Error('Cannot send an empty message');
    }
    const planCommand = parsePlanSlashCommand(text);
    if (planCommand) {
      await this.updateConversationSettingsForThread(threadId, { planMode: true });
      if (!planCommand.prompt) return;
      text = planCommand.prompt;
      options = { ...options, planMode: true };
    }
    const goalCommand = parseGoalSlashCommand(text);
    if (goalCommand) {
      if (goalCommand.action === 'clear') return this.clearGoalForThread(threadId);
      if (goalCommand.action === 'set') return this.setGoalForThread(threadId, goalCommand.objective);
      if (goalCommand.action === 'unsupported') {
        throw new Error('Pausing and resuming goals is not supported by Codex app-server');
      }
      return;
    }
    if (text === '/compact') return this.compactConversationForThread(threadId);
    const reviewCommand = parseReviewSlashCommand(text);
    if (reviewCommand) {
      return this.startReviewForThread(threadId, { target: reviewCommand });
    }
    options = {
      ...validatedSendOptions(this.snapshotForRuntime(runtime), options),
      ...(options.skills ? { skills: validateSkillInputs(options.skills, runtime.skills) } : {}),
    };
    await this.sendPromptToThread(threadId, text, options);
  }

  private async sendPromptToThread(
    threadId: string,
    text: string,
    options: SendCodexMessageOptions = {},
  ): Promise<void> {
    const runtime = this.requireRuntime(threadId);
    const normalizedOptions = validatedSendOptions(
      this.snapshotForRuntime(runtime),
      options,
    );
    const skillInputs = mergeSkillInputs(
      promptSkillInputsFromText(text, runtime.skills),
      validateSkillInputs(normalizedOptions.skills ?? [], runtime.skills),
    );
    const attachments = validateAttachments(normalizedOptions.attachments ?? []);
    if (runtime.busy) {
      this.patchRuntime(threadId, {
        queuedPrompts: [
          ...runtime.queuedPrompts,
          {
            id: createQueuedPromptId(),
            text,
            ...(Object.keys(normalizedOptions).length > 0 ? { options: normalizedOptions } : {}),
          },
        ],
      });
      return;
    }

    const messageId = createMessageId();
    const optimisticMessage: SurfaceMessage = {
      id: messageId,
      role: 'user',
      status: 'complete',
      parts: [
        { type: 'text', text },
        ...attachments.map(surfaceAttachmentPart),
      ],
      createdAt: new Date().toISOString(),
      metadata: {
        conversationId: threadId,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    };
    this.patchRuntime(threadId, {
      busy: true,
      turnStartPending: true,
      error: null,
      messages: [...runtime.messages, optimisticMessage],
    });
    this.patchConversationStatus(threadId, 'active', 'action');
    this.emitEvent('action', {
      type: 'message.appended',
      conversationId: threadId,
      payload: { message: structuredClone(optimisticMessage) },
    });
    this.emitConversationActivity(threadId, 'action');

    try {
      const response = await this.client.request('turn/start', {
        threadId,
        clientUserMessageId: messageId,
        input: [
          { type: 'text', text, text_elements: [] },
          ...attachments.map(attachmentInput),
          ...skillInputs.map((skill) => ({ type: 'skill' as const, name: skill.name, path: skill.path })),
        ],
        ...turnSettings({ ...this.state, ...this.runtimeProjection(runtime) }, normalizedOptions),
        ...(normalizedOptions.outputSchema === undefined
          ? {}
          : { outputSchema: normalizedOptions.outputSchema as v2.TurnStartParams['outputSchema'] }),
      });
      const wasKnownTurn = runtime.turnIds.includes(response.turn.id);
      runtime.activeTurnId = response.turn.status === 'inProgress' ? response.turn.id : null;
      if (!runtime.turnIds.includes(response.turn.id)) runtime.turnIds.push(response.turn.id);
      this.patchConversationTurnCount(threadId, runtime.turnIds.length, 'action');
      const busy = response.turn.status === 'inProgress';
      const messages = runtime.messages.map((message) => message.id === messageId
        ? {
          ...message,
          turnId: response.turn.id,
          metadata: { ...message.metadata, turnId: response.turn.id },
        }
        : message);
      this.patchRuntime(threadId, {
        busy,
        turnStartPending: false,
        messages: busy ? ensureAssistantTurnMessage(messages, threadId, response.turn.id) : messages,
      });
      this.patchConversationStatus(threadId, busy ? 'active' : 'idle', 'action');
      if (busy && !wasKnownTurn) {
        this.emitEvent('action', {
          type: 'turn.started',
          conversationId: threadId,
          turnId: response.turn.id,
          payload: { startedAt: timestampToIso(response.turn.startedAt) },
        });
      }
      this.emitConversationActivity(threadId, 'action');
    } catch (error) {
      this.patchRuntime(threadId, { busy: false, turnStartPending: false, error: errorMessage(error) });
      this.patchConversationStatus(threadId, 'error', 'action');
      this.emitConversationActivity(threadId, 'action');
      throw error;
    }
  }

  async compactConversation(): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) return this.getSnapshot();
    await this.compactConversationForThread(threadId);
    return this.getSnapshot();
  }

  private async compactConversationForThread(threadId: string): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    if (runtime.busy) throw new Error('Cannot compact while Codex is responding');
    await this.client.request('thread/compact/start', { threadId });
    const turnId = runtime.activeTurnId ?? runtime.turnIds.at(-1);
    if (turnId) {
      this.emitEvent('action', {
        type: 'context.compactionStarted',
        conversationId: threadId,
        turnId,
        payload: { itemId: null },
      });
    }
  }

  async startReview(options: StartCodexReviewOptions = {}): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    if (!this.state.activeConversationId) await this.createConversation();
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('Codex did not create a conversation');
    await this.startReviewForThread(threadId, options);
    return this.getSnapshot();
  }

  private async startReviewForThread(threadId: string, options: StartCodexReviewOptions = {}): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    if (runtime.busy) throw new Error('The conversation is already responding');
    const response = await this.client.request('review/start', {
      threadId,
      target: normalizeReviewTarget(options.target ?? { type: 'uncommittedChanges' }),
      delivery: 'inline',
    });
    if (response.reviewThreadId !== threadId) {
      throw new Error(`Codex review/start returned unexpected review thread '${response.reviewThreadId}' for inline review on thread '${threadId}'`);
    }
    const wasKnownTurn = runtime.turnIds.includes(response.turn.id);
    runtime.activeTurnId = response.turn.status === 'inProgress' ? response.turn.id : null;
    if (!runtime.turnIds.includes(response.turn.id)) runtime.turnIds.push(response.turn.id);
    this.patchConversationTurnCount(threadId, runtime.turnIds.length, 'action');
    this.patchRuntime(threadId, {
      busy: runtime.activeTurnId !== null,
      messages: runtime.activeTurnId
        ? ensureAssistantTurnMessage(runtime.messages, threadId, response.turn.id)
        : runtime.messages,
    });
    this.patchConversationStatus(threadId, runtime.activeTurnId ? 'active' : 'idle', 'action');
    if (runtime.activeTurnId && !wasKnownTurn) {
      this.emitEvent('action', {
        type: 'turn.started',
        conversationId: threadId,
        turnId: response.turn.id,
        payload: { startedAt: timestampToIso(response.turn.startedAt) },
      });
    }
    this.emitConversationActivity(threadId, 'action');
  }

  async steerMessage(prompt: string): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    await this.steerMessageForThread(threadId, prompt);
    return this.getSnapshot();
  }

  private async steerMessageForThread(threadId: string, prompt: string): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    const text = prompt.trim();
    if (!text) throw new Error('Cannot steer with an empty message');
    if (!runtime.activeTurnId) throw new Error('There is no active turn to steer');

    const messageId = createMessageId();
    const optimisticSteer: SurfaceMessage = {
      id: messageId,
      kind: 'steer',
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text }],
      createdAt: new Date().toISOString(),
      turnId: runtime.activeTurnId,
      metadata: { conversationId: threadId, turnId: runtime.activeTurnId },
    };
    const messages = ensureAssistantTurnMessage([
      ...runtime.messages,
      optimisticSteer,
    ], threadId, runtime.activeTurnId, { forceSegment: true });
    this.patchRuntime(threadId, {
      error: null,
      messages,
    });
    this.emitEvent('action', {
      type: 'message.appended',
      conversationId: threadId,
      turnId: runtime.activeTurnId,
      payload: { message: structuredClone(optimisticSteer) },
    });
    try {
      const response = await this.client.request('turn/steer', {
        threadId,
        expectedTurnId: runtime.activeTurnId,
        clientUserMessageId: messageId,
        input: [{ type: 'text', text, text_elements: [] }],
      });
      const wasKnownTurn = runtime.turnIds.includes(response.turnId);
      runtime.activeTurnId = response.turnId;
      if (!runtime.turnIds.includes(response.turnId)) runtime.turnIds.push(response.turnId);
      this.patchConversationTurnCount(threadId, runtime.turnIds.length, 'action');
      const steeredMessages = runtime.messages.map((message) => message.id === messageId
        ? {
          ...message,
          turnId: response.turnId,
          metadata: { ...message.metadata, turnId: response.turnId },
        }
        : message);
      this.patchRuntime(threadId, {
        messages: ensureAssistantTurnMessage(steeredMessages, threadId, response.turnId),
      });
      if (!wasKnownTurn) {
        this.emitEvent('action', {
          type: 'turn.started',
          conversationId: threadId,
          turnId: response.turnId,
          payload: { startedAt: new Date().toISOString() },
        });
      }
    } catch (error) {
      this.patchRuntime(threadId, { error: errorMessage(error) });
      throw error;
    }
  }

  async interrupt(): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) return this.getSnapshot();
    await this.interruptThread(threadId);
    return this.getSnapshot();
  }

  private async interruptThread(threadId: string): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    if (!runtime.activeTurnId) return;
    await this.client.request('turn/interrupt', { threadId, turnId: runtime.activeTurnId });
  }

  async deleteMessage(index: number): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    await this.deleteMessageForThread(threadId, index);
    return this.getSnapshot();
  }

  private async deleteMessageForThread(threadId: string, index: number): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    const message = messageAt(runtime.messages, index);
    await this.rollbackToTurn(threadId, messageTurnId(message));
  }

  async editMessage(index: number, content: string): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    await this.editMessageForThread(threadId, index, content);
    return this.getSnapshot();
  }

  private async editMessageForThread(threadId: string, index: number, content: string): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    const message = messageAt(runtime.messages, index);
    if (message.role !== 'user') throw new Error('Only user messages can be edited');
    const text = content.trim();
    if (!text) throw new Error('Cannot replace a message with empty content');
    const attachments = surfaceMessageAttachments(message);
    await this.rollbackToTurn(threadId, messageTurnId(message));
    await this.sendMessageToThread(threadId, text, attachments.length > 0 ? { attachments } : {});
  }

  async retryMessage(index: number): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    await this.retryMessageForThread(threadId, index);
    return this.getSnapshot();
  }

  private async retryMessageForThread(threadId: string, index: number): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    const message = messageAt(runtime.messages, index);
    const turnId = messageTurnId(message);
    const prompt = [...runtime.messages.slice(0, index + 1)].reverse().find((candidate) => (
      candidate.role === 'user' && messageTurnIdOrNull(candidate) === turnId
    ));
    const text = prompt ? surfaceMessageText(prompt) : '';
    if (!text) throw new Error('Could not find the user prompt for this turn');
    const attachments = prompt ? surfaceMessageAttachments(prompt) : [];
    await this.rollbackToTurn(threadId, turnId);
    await this.sendMessageToThread(threadId, text, attachments.length > 0 ? { attachments } : {});
  }

  async deleteQueuedPrompt(promptId: string): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    await this.deleteQueuedPromptForThread(threadId, promptId);
    return this.getSnapshot();
  }

  private async deleteQueuedPromptForThread(threadId: string, promptId: string): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    const queuedPrompts = runtime.queuedPrompts.filter((prompt) => prompt.id !== promptId);
    if (queuedPrompts.length === runtime.queuedPrompts.length) {
      throw new Error(`Unknown queued prompt '${promptId}'`);
    }
    this.patchRuntime(runtime.threadId, { queuedPrompts });
  }

  async steerQueuedPrompt(promptId: string): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    await this.steerQueuedPromptForThread(threadId, promptId);
    return this.getSnapshot();
  }

  private async steerQueuedPromptForThread(threadId: string, promptId: string): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    const prompt = runtime.queuedPrompts.find((candidate) => candidate.id === promptId);
    if (!prompt) throw new Error(`Unknown queued prompt '${promptId}'`);
    if (runtime.busy && (prompt.options?.attachments?.length ?? 0) > 0) {
      throw new Error('Queued prompts with attachments cannot be steered and remain queued');
    }
    this.patchRuntime(runtime.threadId, {
      queuedPrompts: runtime.queuedPrompts.filter((candidate) => candidate.id !== promptId),
    });
    if (runtime.busy) await this.steerMessageForThread(threadId, prompt.text);
    else await this.sendMessageToThread(threadId, prompt.text, prompt.options);
  }

  async respondToClientRequest(response: CodexSurfaceClientRequestResponse): Promise<CodexSurfaceSnapshot> {
    await this.respondToClientRequestForThread(undefined, response);
    return this.getSnapshot();
  }

  private async respondToClientRequestForThread(
    threadId: string | undefined,
    response: CodexSurfaceClientRequestResponse,
  ): Promise<void> {
    const pending = this.pendingClientRequests.get(response.id);
    if (!pending) throw new Error(`Unknown client request '${response.id}'`);
    if (threadId !== undefined && pending.threadId !== threadId) {
      throw new Error(`Client request '${response.id}' belongs to conversation '${pending.threadId}', not '${threadId}'`);
    }
    const confirmationDecision = response.payload?.decision ?? 'deny';
    if (
      pending.kind === 'mcp_tool_approval'
      && !['allow', 'allow_conversation', 'always_allow', 'deny'].includes(confirmationDecision)
    ) {
      throw new Error(`Invalid tool confirmation decision '${String(confirmationDecision)}'`);
    }
    this.pendingClientRequests.delete(response.id);
    const runtime = this.requireRuntime(pending.threadId);
    const answeredClientRequestIds = addUnique(runtime.answeredClientRequestIds, response.id);
    if (pending.kind === 'ask_user') {
      const answers = response.payload?.answers ?? {};
      pending.responder.resolve({ answers });
      this.patchRuntime(pending.threadId, {
        answeredClientRequestIds,
        messages: updateAssistantToolPart(runtime.messages, pending.threadId, pending.turnId, {
          itemId: pending.itemId,
          output: { answers },
        }),
      });
    } else {
      const decision = confirmationDecision;
      pending.responder.resolve(mcpElicitationResponse(decision));
      this.patchRuntime(pending.threadId, {
        answeredClientRequestIds,
        messages: updateAssistantToolPart(runtime.messages, pending.threadId, pending.displayTurnId, {
          itemId: pending.itemId,
          output: { decision },
        }),
      });
    }
    this.maybeClearWaitingBusy(pending.threadId);
    this.emitEvent('action', {
      type: 'clientRequest.resolved',
      conversationId: pending.threadId,
      ...(pending.turnId ? { turnId: pending.turnId } : {}),
      payload: {
        request: structuredClone(pending.request),
        response: structuredClone(response),
        reason: 'host',
      },
    });
    this.emitConversationActivity(pending.threadId, 'action');
  }

  private async rollbackToTurn(threadId: string, turnId: string): Promise<void> {
    const runtime = await this.ensureThreadReady(threadId);
    if (runtime.busy) throw new Error('Cannot roll back while Codex is responding');
    let targetIndex = runtime.turnIds.indexOf(turnId);
    if (targetIndex < 0) {
      await this.hydrateCompleteConversationHistory(threadId);
      targetIndex = runtime.turnIds.indexOf(turnId);
    }
    if (targetIndex < 0) throw new Error(`Cannot roll back to unknown Codex turn '${turnId}'`);
    const response = await this.client.request('thread/rollback', {
      threadId,
      numTurns: runtime.turnIds.length - targetIndex,
    });
    if (response.thread.id !== threadId) {
      throw new Error(`Codex thread/rollback returned '${response.thread.id}' for requested thread '${threadId}'`);
    }
    runtime.turnIds = response.thread.turns.map((turn) => turn.id);
    runtime.activeTurnId = null;
    const summary = threadToSummary(response.thread);
    this.patch({
      conversations: upsertConversation(this.state.conversations, summary),
    });
    this.patchRuntime(threadId, {
      messages: codexThreadToSurfaceMessages(response.thread),
      answeredClientRequestIds: [],
      busy: false,
      turnStartPending: false,
      error: null,
      contextUsage: null,
      turnGitDiff: null,
    });
    this.emitSummaryUpserted(summary, 'updated', 'action');
    this.emitHistoryReplaced(threadId, 'rollback', 'action');
    this.emitConversationActivity(threadId, 'action');
  }

  async resolveApproval(
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope: CodexSurfaceApprovalScope = 'once',
  ): Promise<CodexSurfaceSnapshot> {
    await this.resolveApprovalForThread(undefined, approvalId, decision, scope);
    return this.getSnapshot();
  }

  private async resolveApprovalForThread(
    threadId: string | undefined,
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope: CodexSurfaceApprovalScope = 'once',
  ): Promise<void> {
    if (decision !== 'approve' && decision !== 'deny') {
      throw new Error(`Invalid approval decision '${String(decision)}'`);
    }
    if (scope !== 'once' && scope !== 'session') {
      throw new Error(`Invalid approval scope '${String(scope)}'`);
    }
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) throw new Error(`Unknown approval '${approvalId}'`);
    if (threadId !== undefined && pending.approval.conversationId !== threadId) {
      throw new Error(`Approval '${approvalId}' belongs to conversation '${pending.approval.conversationId}', not '${threadId}'`);
    }
    if (
      decision === 'approve'
      && pending.approval.allowedScopes
      && !pending.approval.allowedScopes.includes(scope)
    ) {
      throw new Error(`Approval decision '${decision}:${scope}' is not available for '${approvalId}'`);
    }
    pending.resolve(decision, scope);
    this.pendingApprovals.delete(approvalId);
    this.refreshActiveApprovals();
    this.maybeClearWaitingBusy(pending.approval.conversationId);
    this.emitEvent('action', {
      type: 'approval.resolved',
      conversationId: pending.approval.conversationId,
      ...(pending.approval.turnId ? { turnId: pending.approval.turnId } : {}),
      payload: {
        approval: structuredClone(pending.approval),
        decision,
        scope,
        reason: 'host',
      },
    });
    this.emitConversationActivity(pending.approval.conversationId, 'action');
  }

  conversation(conversationId: string): CodexConversation {
    const id = normalizedConversationId(conversationId);
    const existing = this.conversationHandles.get(id);
    if (existing) return existing;
    const snapshot = () => this.getConversationSnapshot(id);
    const handle: CodexConversation = {
      id,
      load: async (options) => {
        await this.ensureThreadReady(id, options);
        return snapshot();
      },
      select: async () => {
        await this.selectConversation(id);
        return snapshot();
      },
      readHistory: () => this.readConversationHistory(id),
      rename: async (title) => {
        await this.renameConversationForThread(id, title);
        return snapshot();
      },
      updateSettings: async (settings) => {
        await this.updateConversationSettingsForThread(id, settings);
        return snapshot();
      },
      sendMessage: async (prompt, options) => {
        await this.sendMessageToThread(id, prompt, options);
        return snapshot();
      },
      compact: async () => {
        await this.compactConversationForThread(id);
        return snapshot();
      },
      startReview: async (options) => {
        await this.startReviewForThread(id, options);
        return snapshot();
      },
      steerMessage: async (prompt) => {
        await this.steerMessageForThread(id, prompt);
        return snapshot();
      },
      interrupt: async () => {
        await this.interruptThread(id);
        return snapshot();
      },
      deleteMessage: async (index) => {
        await this.deleteMessageForThread(id, index);
        return snapshot();
      },
      editMessage: async (index, content) => {
        await this.editMessageForThread(id, index, content);
        return snapshot();
      },
      retryMessage: async (index) => {
        await this.retryMessageForThread(id, index);
        return snapshot();
      },
      rollbackToTurn: async (turnId) => {
        await this.rollbackToTurn(id, turnId);
        return snapshot();
      },
      deleteQueuedPrompt: async (promptId) => {
        await this.deleteQueuedPromptForThread(id, promptId);
        return snapshot();
      },
      steerQueuedPrompt: async (promptId) => {
        await this.steerQueuedPromptForThread(id, promptId);
        return snapshot();
      },
      respondToClientRequest: async (response) => {
        await this.respondToClientRequestForThread(id, response);
        return snapshot();
      },
      resolveApproval: async (approvalId, decision, scope) => {
        await this.resolveApprovalForThread(id, approvalId, decision, scope);
        return snapshot();
      },
      setGoal: async (objective, tokenBudget) => {
        await this.setGoalForThread(id, objective, tokenBudget);
        return snapshot();
      },
      clearGoal: async () => {
        await this.clearGoalForThread(id);
        return snapshot();
      },
      getSnapshot: snapshot,
      onStateChange: (listener) => this.onConversationStateChange(id, listener),
      onEvent: (listener) => this.onConversationEvent(id, listener),
    };
    this.conversationHandles.set(id, handle);
    return handle;
  }

  getConversationSnapshot(conversationId: string): CodexConversationSnapshot {
    const runtime = this.requireRuntime(conversationId);
    return structuredClone({
      ...this.state,
      activeConversationId: conversationId,
      ...this.runtimeProjection(runtime),
      activeTurnId: runtime.activeTurnId,
      turnIds: runtime.turnIds,
    });
  }

  onConversationStateChange(conversationId: string, listener: ConversationStateListener): () => void {
    const listeners = this.conversationListeners.get(conversationId) ?? new Set<ConversationStateListener>();
    listeners.add(listener);
    this.conversationListeners.set(conversationId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.conversationListeners.delete(conversationId);
    };
  }

  onConversationEvent(conversationId: string, listener: ConversationEventListener): () => void {
    return this.onEvent((event) => {
      if ('conversationId' in event && event.conversationId === conversationId) {
        listener(event as CodexConversationEvent);
      }
    });
  }

  getSnapshot(): CodexSurfaceSnapshot {
    return structuredClone(this.state);
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: SurfaceEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeNotification();
    this.unsubscribeToolInputRequests();
    this.unsubscribeMcpElicitationRequests();
    this.unsubscribeServerRequestPolicies();
    this.unsubscribeDisconnect();
    this.unsubscribeApprovals();
    this.pendingApprovals.clear();
    this.pendingClientRequests.clear();
    this.commandOutputForwardItemIds.clear();
    this.catalogIconDataUrls.clear();
    for (const runtime of this.runtimes.values()) {
      runtime.activeTurnId = null;
      runtime.busy = false;
      runtime.turnStartPending = false;
    }
    await this.client.close();
    this.patch({ status: 'idle', busy: false, approvals: [], clientRequests: [], historyLoading: false });
    this.emitSurfaceStatus('lifecycle');
  }

  private async ensureConnected(): Promise<void> {
    if (this.state.status !== 'ready') {
      await this.connect();
    }
    while (true) {
      const pending = this.accountRefreshPromise ?? this.surfaceBootstrapPromise;
      if (!pending) return;
      await pending;
    }
  }

  private async ensureThreadReady(
    threadId: string,
    loadOptions: CodexConversationLoadOptions = {},
  ): Promise<ThreadRuntimeState> {
    await this.ensureConnected();
    const runtime = this.runtimes.get(threadId);
    const hasLoadOptions = Object.keys(loadOptions).length > 0;
    if (runtime?.hydrated && !hasLoadOptions) return runtime;
    let hydration = this.hydrationPromises.get(threadId);
    if (!hydration) {
      hydration = this.resumeConversation(threadId, false, loadOptions, 'load').then(() => undefined);
      this.hydrationPromises.set(threadId, hydration);
      void hydration.finally(() => {
        if (this.hydrationPromises.get(threadId) === hydration) this.hydrationPromises.delete(threadId);
      }).catch(() => undefined);
    }
    await hydration;
    return this.requireRuntime(threadId);
  }

  private createRuntime(threadId: string, patch: ThreadRuntimePatch = {}): ThreadRuntimeState {
    const existing = this.runtimes.get(threadId);
    if (existing) {
      Object.assign(existing, patch);
      return existing;
    }
    const runtime: ThreadRuntimeState = {
      threadId,
      cwd: null,
      hydrated: false,
      activeTurnId: null,
      turnIds: [],
      messages: [],
      answeredClientRequestIds: [],
      approvalPreset: this.state.approvalPreset,
      approvalPresets: [...this.state.approvalPresets],
      permissionProfiles: [...this.state.permissionProfiles],
      skills: [...this.state.skills],
      skillCatalogStatus: this.state.skillCatalogStatus,
      selectedModelId: this.state.selectedModelId,
      selectedReasoningEffort: this.state.selectedReasoningEffort,
      planMode: false,
      contextUsage: null,
      goal: null,
      turnGitDiff: null,
      threadStatus: null,
      queuedPrompts: [],
      busy: false,
      turnStartPending: false,
      historyLoading: false,
      fullHistoryHydrated: false,
      error: null,
      planMarkdownByTurn: new Map(),
      ...patch,
    };
    this.runtimes.set(threadId, runtime);
    return runtime;
  }

  private requireRuntime(threadId: string): ThreadRuntimeState {
    return this.runtimes.get(threadId) ?? this.createRuntime(threadId);
  }

  private runtimeProjection(runtime: ThreadRuntimeState): Pick<
    CodexSurfaceSnapshot,
    | 'approvalPreset'
    | 'approvalPresets'
    | 'answeredClientRequestIds'
    | 'approvals'
    | 'busy'
    | 'clientRequests'
    | 'contextUsage'
    | 'error'
    | 'goal'
    | 'historyLoading'
    | 'messages'
    | 'permissionProfiles'
    | 'planMode'
    | 'queuedPrompts'
    | 'selectedModelId'
    | 'selectedReasoningEffort'
    | 'skillCatalogStatus'
    | 'skills'
    | 'threadStatus'
    | 'turnGitDiff'
  > {
    return {
      approvalPreset: runtime.approvalPreset,
      approvalPresets: runtime.approvalPresets,
      answeredClientRequestIds: runtime.answeredClientRequestIds,
      approvals: this.approvalsForThread(runtime.threadId),
      busy: runtime.busy,
      clientRequests: this.clientRequestsForThread(runtime.threadId),
      contextUsage: runtime.contextUsage,
      error: runtime.error,
      goal: runtime.goal,
      historyLoading: runtime.historyLoading,
      messages: runtime.messages,
      permissionProfiles: runtime.permissionProfiles,
      planMode: runtime.planMode,
      queuedPrompts: runtime.queuedPrompts,
      selectedModelId: runtime.selectedModelId,
      selectedReasoningEffort: runtime.selectedReasoningEffort,
      skillCatalogStatus: runtime.skillCatalogStatus,
      skills: runtime.skills,
      threadStatus: runtime.threadStatus,
      turnGitDiff: runtime.turnGitDiff,
    };
  }

  private snapshotForRuntime(runtime: ThreadRuntimeState): CodexSurfaceSnapshot {
    return { ...this.state, ...this.runtimeProjection(runtime) };
  }

  private activateRuntime(runtime: ThreadRuntimeState): void {
    this.patch({
      activeConversationId: runtime.threadId,
      ...this.runtimeProjection(runtime),
    });
    this.emitEvent('action', {
      type: 'conversation.selected',
      payload: { conversationId: runtime.threadId },
    });
  }

  private patchRuntime(threadId: string, patch: ThreadRuntimePatch): void {
    const runtime = this.requireRuntime(threadId);
    Object.assign(runtime, patch);
    if (this.state.activeConversationId === threadId) {
      this.patch(this.runtimeProjection(runtime));
    } else {
      this.notifyConversationListeners(threadId);
    }
  }

  private emitSurfaceStatus(origin: CodexSurfaceEventOrigin): void {
    this.emitEvent(origin, {
      type: 'surface.statusChanged',
      payload: { status: this.state.status, error: this.state.error },
    });
  }

  private emitSummaryUpserted(
    summary: CodexConversationSummary,
    reason: Extract<CodexSurfaceEvent, { type: 'conversation.summaryUpserted' }>['payload']['reason'],
    origin: CodexSurfaceEventOrigin,
  ): void {
    this.schedulePluginCatalogRefresh();
    const fingerprint = JSON.stringify({
      id: summary.id,
      title: summary.title,
      preview: summary.preview,
      cwd: summary.cwd,
      status: summary.status,
      turnCount: summary.turnCount,
      createdAt: summary.createdAt,
    });
    if (this.semanticEventValues.get(`summary:${summary.id}`) === fingerprint) return;
    this.semanticEventValues.set(`summary:${summary.id}`, fingerprint);
    this.emitEvent(origin, {
      type: 'conversation.summaryUpserted',
      conversationId: summary.id,
      payload: { summary: structuredClone(summary), reason },
    });
  }

  private emitConversationActivity(threadId: string, origin: CodexSurfaceEventOrigin): void {
    const runtime = this.requireRuntime(threadId);
    const payload = {
      threadStatus: structuredClone(runtime.threadStatus),
      busy: runtime.busy,
      error: runtime.error,
    };
    const fingerprint = JSON.stringify(payload);
    if (this.semanticEventValues.get(`activity:${threadId}`) === fingerprint) return;
    this.semanticEventValues.set(`activity:${threadId}`, fingerprint);
    this.emitEvent(origin, {
      type: 'conversation.activityChanged',
      conversationId: threadId,
      payload,
    });
  }

  private emitConversationSettings(threadId: string, origin: CodexSurfaceEventOrigin): void {
    const runtime = this.requireRuntime(threadId);
    const payload = {
      approvalPreset: runtime.approvalPreset,
      selectedModelId: runtime.selectedModelId,
      selectedReasoningEffort: runtime.selectedReasoningEffort,
      planMode: runtime.planMode,
    };
    const fingerprint = JSON.stringify(payload);
    if (this.semanticEventValues.get(`settings:${threadId}`) === fingerprint) return;
    this.semanticEventValues.set(`settings:${threadId}`, fingerprint);
    this.emitEvent(origin, {
      type: 'conversation.settingsChanged',
      conversationId: threadId,
      payload,
    });
  }

  private emitConversationSkills(threadId: string, origin: CodexSurfaceEventOrigin): void {
    const runtime = this.requireRuntime(threadId);
    const payload = {
      cwd: runtime.cwd,
      skills: structuredClone(runtime.skills),
      status: runtime.skillCatalogStatus,
    };
    this.emitEvent(origin, {
      type: 'conversation.skillsChanged',
      conversationId: threadId,
      payload,
    });
  }

  private emitConversationPermissions(threadId: string, origin: CodexSurfaceEventOrigin): void {
    const runtime = this.requireRuntime(threadId);
    const payload = {
      cwd: runtime.cwd,
      permissionProfiles: structuredClone(runtime.permissionProfiles),
      approvalPresets: [...runtime.approvalPresets],
    };
    this.emitEvent(origin, {
      type: 'conversation.permissionsChanged',
      conversationId: threadId,
      payload,
    });
  }

  private emitHistoryReplaced(
    threadId: string,
    reason: Extract<CodexSurfaceEvent, { type: 'conversation.historyReplaced' }>['payload']['reason'],
    origin: CodexSurfaceEventOrigin,
  ): void {
    const runtime = this.requireRuntime(threadId);
    this.emitEvent(origin, {
      type: 'conversation.historyReplaced',
      conversationId: threadId,
      payload: {
        reason,
        messages: structuredClone(runtime.messages),
        threadStatus: structuredClone(runtime.threadStatus),
      },
    });
  }

  private messageContainingTool(threadId: string, turnId: string, itemId: string): SurfaceMessage | null {
    const runtime = this.requireRuntime(threadId);
    return runtime.messages.find((message) => (
      message.metadata?.turnId === turnId
      && message.parts.some((part) => part.type === 'tool' && part.id === itemId)
    )) ?? null;
  }

  private assistantMessageForTurn(threadId: string, turnId: string): SurfaceMessage | null {
    const runtime = this.requireRuntime(threadId);
    return [...runtime.messages].reverse().find((message) => (
      message.role === 'assistant'
      && message.kind === undefined
      && message.metadata?.turnId === turnId
    )) ?? null;
  }

  private notifyConversationListeners(threadId: string): void {
    const listeners = this.conversationListeners.get(threadId);
    if (!listeners || listeners.size === 0) return;
    const snapshot = this.getConversationSnapshot(threadId);
    for (const listener of listeners) listener(snapshot);
  }

  private markRuntimeTurnActive(runtime: ThreadRuntimeState, turnId: string): void {
    runtime.activeTurnId = turnId;
    runtime.busy = true;
    runtime.turnStartPending = false;
    if (!runtime.turnIds.includes(turnId)) runtime.turnIds.push(turnId);
  }

  private approvalsForThread(threadId: string): CodexSurfaceSnapshot['approvals'] {
    return [...this.pendingApprovals.values()]
      .map((pending) => pending.approval)
      .filter((approval) => approval.conversationId === threadId);
  }

  private clientRequestsForThread(threadId: string): CodexSurfaceClientRequest[] {
    return [...this.pendingClientRequests.values()]
      .filter((pending) => pending.threadId === threadId)
      .map((pending) => pending.request);
  }

  private refreshActiveApprovals(): void {
    const threadId = this.state.activeConversationId;
    this.patch({ approvals: threadId ? this.approvalsForThread(threadId) : [] });
  }

  private maybeClearWaitingBusy(threadId: string): void {
    const runtime = this.runtimes.get(threadId);
    if (!runtime || runtime.turnStartPending || runtime.activeTurnId !== null) return;
    const hasApproval = [...this.pendingApprovals.values()]
      .some((pending) => pending.approval.conversationId === threadId);
    const hasClientRequest = [...this.pendingClientRequests.values()]
      .some((pending) => pending.threadId === threadId);
    if (!hasApproval && !hasClientRequest) this.patchRuntime(threadId, { busy: false });
  }

  private patchConversationStatus(
    threadId: string,
    status: CodexConversationSummary['status'],
    origin: CodexSurfaceEventOrigin = 'notification',
  ): void {
    this.patch({
      conversations: this.state.conversations.map((conversation) => conversation.id === threadId
        ? { ...conversation, status, updatedAt: new Date().toISOString() }
        : conversation),
    });
    const summary = this.state.conversations.find((conversation) => conversation.id === threadId);
    if (summary) this.emitSummaryUpserted(summary, 'updated', origin);
  }

  private patchConversationTurnCount(
    threadId: string,
    turnCount: number,
    origin: CodexSurfaceEventOrigin = 'notification',
  ): void {
    this.patch({
      conversations: this.state.conversations.map((conversation) => conversation.id === threadId
        ? { ...conversation, turnCount, updatedAt: new Date().toISOString() }
        : conversation),
    });
    const summary = this.state.conversations.find((conversation) => conversation.id === threadId);
    if (summary) this.emitSummaryUpserted(summary, 'updated', origin);
  }

  private summaryWithKnownTurnCount(thread: v2.Thread): CodexConversationSummary {
    const summary = threadToSummary(thread);
    const runtime = this.runtimes.get(thread.id);
    if (runtime?.hydrated) return { ...summary, turnCount: runtime.turnIds.length };
    const existing = this.state.conversations.find((conversation) => conversation.id === thread.id);
    return existing ? { ...summary, turnCount: existing.turnCount } : summary;
  }

  private clearPendingForThread(
    threadId: string,
    reason: string,
    eventReason: 'conversation_closed' | 'conversation_removed' | 'surface_disconnected',
  ): void {
    const resolvedApprovals: PendingCodexApproval[] = [];
    for (const [approvalId, pending] of this.pendingApprovals) {
      if (pending.approval.conversationId !== threadId) continue;
      pending.resolve('deny', 'once');
      this.pendingApprovals.delete(approvalId);
      resolvedApprovals.push(pending);
    }
    const resolvedRequests: PendingClientRequest[] = [];
    for (const [requestId, pending] of this.pendingClientRequests) {
      if (pending.threadId !== threadId) continue;
      pending.responder.reject(reason);
      this.pendingClientRequests.delete(requestId);
      resolvedRequests.push(pending);
    }
    this.refreshActiveApprovals();
    this.patchRuntime(threadId, {});
    for (const pending of resolvedApprovals) {
      this.emitEvent('notification', {
        type: 'approval.resolved',
        conversationId: threadId,
        ...(pending.approval.turnId ? { turnId: pending.approval.turnId } : {}),
        payload: {
          approval: structuredClone(pending.approval),
          decision: 'deny',
          scope: 'once',
          reason: eventReason,
        },
      });
    }
    for (const pending of resolvedRequests) {
      this.emitEvent('notification', {
        type: 'clientRequest.resolved',
        conversationId: threadId,
        ...(pending.turnId ? { turnId: pending.turnId } : {}),
        payload: {
          request: structuredClone(pending.request),
          response: null,
          reason: eventReason,
        },
      });
    }
  }

  private removeThread(
    threadId: string,
    reason: 'archived' | 'deleted',
    origin: CodexSurfaceEventOrigin = 'notification',
  ): void {
    const known = this.state.activeConversationId === threadId
      || this.state.conversations.some((conversation) => conversation.id === threadId)
      || this.runtimes.has(threadId)
      || [...this.pendingApprovals.values()].some((pending) => pending.approval.conversationId === threadId)
      || [...this.pendingClientRequests.values()].some((pending) => pending.threadId === threadId);
    if (!known) return;
    this.clearPendingForThread(threadId, 'Codex thread is no longer available', 'conversation_removed');
    this.runtimes.delete(threadId);
    this.hostOptionsByThread.delete(threadId);
    this.hydrationPromises.delete(threadId);
    this.historyHydrationPromises.delete(threadId);
    this.conversationHandles.delete(threadId);
    this.semanticEventValues.delete(`summary:${threadId}`);
    const conversations = this.state.conversations.filter((conversation) => conversation.id !== threadId);
    if (this.state.activeConversationId !== threadId) {
      this.patch({ conversations });
      this.emitEvent(origin, {
        type: 'conversation.summaryRemoved',
        conversationId: threadId,
        payload: { reason },
      });
      return;
    }
    this.patch({
      conversations,
      activeConversationId: null,
      messages: [],
      answeredClientRequestIds: [],
      approvals: [],
      contextUsage: null,
      goal: null,
      turnGitDiff: null,
      threadStatus: null,
      queuedPrompts: [],
      busy: false,
      historyLoading: false,
      error: null,
    });
    this.emitEvent(origin, {
      type: 'conversation.summaryRemoved',
      conversationId: threadId,
      payload: { reason },
    });
    this.emitEvent(origin, {
      type: 'conversation.selected',
      payload: { conversationId: null },
    });
  }

  private async conversationExtension(
    context: Parameters<NonNullable<CodexSurfaceExtension['configureConversation']>>[0],
    createOptions: CreateCodexConversationOptions = {},
    mcpServers: readonly CodexMcpServerDefinition[] = this.defaultMcpServers,
  ): Promise<CodexThreadStartExtension> {
    const config: Record<string, CodexSurfaceJsonValue> = mcpServerConfig(mcpServers);
    const developerInstructions: string[] = [];
    let baseInstructions: string | undefined;
    for (const extension of this.options.extensions ?? []) {
      if (!extension.configureConversation) continue;
      const contribution = await extension.configureConversation(context);
      if (contribution.config) {
        assertNoMcpConfigCollision(contribution.config, mcpServers);
        Object.assign(config, contribution.config);
      }
      if (contribution.baseInstructions !== undefined) baseInstructions = contribution.baseInstructions;
      if (contribution.developerInstructions?.trim()) {
        developerInstructions.push(contribution.developerInstructions.trim());
      }
    }
    if (createOptions.config) {
      assertNoMcpConfigCollision(createOptions.config, mcpServers);
      Object.assign(config, createOptions.config);
    }
    if (createOptions.baseInstructions !== undefined) baseInstructions = createOptions.baseInstructions;
    if (createOptions.developerInstructions?.trim()) {
      developerInstructions.push(createOptions.developerInstructions.trim());
    }
    return {
      ...(baseInstructions === undefined ? {} : { baseInstructions }),
      ...(Object.keys(config).length === 0 ? {} : { config }),
      ...(developerInstructions.length === 0
        ? {}
        : { developerInstructions: developerInstructions.join('\n\n') }),
    };
  }

  private dynamicToolSpecs(): v2.DynamicToolSpec[] {
    return [...this.dynamicTools.values()].map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as v2.DynamicToolFunctionSpec['inputSchema'],
      ...(tool.deferLoading === undefined ? {} : { deferLoading: tool.deferLoading }),
    }));
  }

  private async handleDynamicToolCall(
    request: DynamicToolRequest,
    responder: CodexServerRequestResponder<'item/tool/call'>,
  ): Promise<void> {
    if (request.params.namespace !== null) {
      responder.reject({
        code: -32601,
        message: `Dynamic tool namespace '${request.params.namespace}' is not configured`,
      });
      return;
    }
    const tool = this.dynamicTools.get(request.params.tool);
    if (!tool) {
      responder.reject({ code: -32601, message: `Unknown dynamic host tool '${request.params.tool}'` });
      return;
    }
    try {
      const result = await tool.execute({
        callId: request.params.callId,
        conversationId: request.params.threadId,
        turnId: request.params.turnId,
        arguments: request.params.arguments as CodexSurfaceJsonValue,
        extensionContext: this.hostOptionsByThread.get(request.params.threadId)?.extensionContext,
      });
      const normalized = typeof result === 'string'
        ? { content: [{ type: 'text' as const, text: result }], success: true }
        : { content: result.content, success: result.success ?? true };
      responder.resolve({
        success: normalized.success,
        contentItems: normalized.content.map((item) => item.type === 'image'
          ? { type: 'inputImage' as const, imageUrl: item.imageUrl }
          : { type: 'inputText' as const, text: item.text }),
      });
    } catch (error) {
      responder.resolve({
        success: false,
        contentItems: [{ type: 'inputText', text: errorMessage(error) }],
      });
    }
  }

  private threadStartSettings(
    options: CreateCodexConversationOptions,
    availablePresets: readonly CodexSurfaceApprovalPreset[],
  ): {
    approvalPolicy: v2.AskForApproval;
    approvalsReviewer?: v2.ApprovalsReviewer;
    permissions?: string;
    sandbox?: v2.SandboxMode;
  } {
    const preset = options.approvalPreset ?? (
      options.approvalMode === undefined && options.permissionMode === undefined
        ? (availablePresets.includes(this.preferredApprovalPreset() ?? 'ask-for-approval')
          ? this.preferredApprovalPreset()
          : availablePresets[0] ?? null)
        : null
    );
    if (preset) return approvalPresetStartParams(preset);
    const approvalMode = options.approvalMode ?? this.options.approvalMode ?? 'never';
    const permissionMode = options.permissionMode ?? this.options.permissionMode ?? 'read-only';
    return {
      approvalPolicy: approvalMode === 'ask' ? 'on-request' : 'never',
      sandbox: permissionMode === 'full-access' ? 'danger-full-access' : permissionMode,
    };
  }

  private preferredApprovalPreset(): CodexSurfaceApprovalPreset | null {
    if (this.options.approvalPreset) return this.options.approvalPreset;
    if (this.options.approvalMode !== undefined || this.options.permissionMode !== undefined) {
      if (this.options.permissionMode === 'full-access' && this.options.approvalMode !== 'ask') return 'full-access';
      if (this.options.permissionMode === 'workspace-write' && this.options.approvalMode === 'ask') return 'ask-for-approval';
      return null;
    }
    return 'ask-for-approval';
  }

  private refreshAuthenticationFromNotification(forceBootstrap = false): void {
    void this.refreshAuthentication('notification', forceBootstrap).catch((error) => {
      this.patch({ error: errorMessage(error) });
    });
  }

  private handleAccountLoginCompleted(params: v2.AccountLoginCompletedNotification): void {
    const current = this.state.authentication.login;
    const loginId = params.loginId ?? current.loginId;
    if (!params.success) {
      this.patchAuthentication({
        login: {
          status: 'error',
          loginId,
          authUrl: current.authUrl,
          error: params.error ?? 'Codex sign-in failed',
        },
      }, 'notification');
      return;
    }
    this.patchAuthentication({
      login: {
        status: 'completed',
        loginId,
        authUrl: current.authUrl,
        error: null,
      },
    }, 'notification');
    this.refreshAuthenticationFromNotification();
  }

  private handleNotification(notification: ServerNotification): void {
    switch (notification.method) {
      case 'thread/started': {
        this.createRuntime(notification.params.thread.id, {
          threadStatus: surfaceThreadStatus(notification.params.thread.status),
        });
        const summary = threadToSummary(notification.params.thread);
        this.patch({
          conversations: upsertConversation(this.state.conversations, summary),
        });
        this.emitSummaryUpserted(summary, 'started', 'notification');
        this.emitConversationActivity(notification.params.thread.id, 'notification');
        return;
      }
      case 'thread/status/changed': {
        const { threadId, status } = notification.params;
        const runtime = this.requireRuntime(threadId);
        const systemError = status.type === 'systemError';
        if (systemError) runtime.activeTurnId = null;
        this.patchRuntime(threadId, {
          threadStatus: surfaceThreadStatus(status),
          busy: systemError
            ? false
            : runtime.turnStartPending || status.type === 'active' || runtime.activeTurnId !== null,
          ...(systemError
            ? { turnStartPending: false, error: 'Codex app-server reported a system error' }
            : {}),
        });
        this.patch({
          conversations: this.state.conversations.map((conversation) => conversation.id === threadId
            ? { ...conversation, status: conversationStatus(status) }
            : conversation),
        });
        const summary = this.state.conversations.find((conversation) => conversation.id === threadId);
        if (summary) this.emitSummaryUpserted(summary, 'updated', 'notification');
        this.emitConversationActivity(threadId, 'notification');
        return;
      }
      case 'thread/archived':
      case 'thread/deleted':
        this.removeThread(
          notification.params.threadId,
          notification.method === 'thread/archived' ? 'archived' : 'deleted',
        );
        return;
      case 'thread/unarchived':
        void this.loadConversations().catch((error) => {
          this.patch({ error: errorMessage(error) });
        });
        return;
      case 'thread/closed': {
        const runtime = this.runtimes.get(notification.params.threadId);
        if (runtime) {
          runtime.activeTurnId = null;
          this.patchRuntime(notification.params.threadId, {
            busy: false,
            turnStartPending: false,
            threadStatus: { type: 'idle' },
          });
        }
        this.clearPendingForThread(notification.params.threadId, 'Codex thread closed', 'conversation_closed');
        this.patchConversationStatus(notification.params.threadId, 'idle');
        this.emitConversationActivity(notification.params.threadId, 'notification');
        return;
      }
      case 'skills/changed':
        void this.loadSkills(true, 'notification');
        for (const runtime of this.runtimes.values()) {
          void this.loadConversationCatalogs(runtime.cwd ?? undefined, true).then((catalogs) => {
            this.patchRuntime(runtime.threadId, catalogs);
            this.emitConversationSkills(runtime.threadId, 'notification');
            this.emitConversationPermissions(runtime.threadId, 'notification');
          });
        }
        return;
      case 'thread/name/updated': {
        const previous = this.state.conversations.find((conversation) => conversation.id === notification.params.threadId);
        const title = notification.params.threadName?.trim() || previous?.preview || 'Untitled conversation';
        if (previous?.title === title) return;
        this.patch({
          conversations: this.state.conversations.map((conversation) => conversation.id === notification.params.threadId
            ? { ...conversation, title }
            : conversation),
        });
        const summary = this.state.conversations.find((conversation) => conversation.id === notification.params.threadId);
        if (summary) this.emitSummaryUpserted(summary, 'updated', 'notification');
        return;
      }
      case 'thread/settings/updated': {
        const runtime = this.requireRuntime(notification.params.threadId);
        const next = threadSettingsSelection(
          notification.params.threadSettings,
          this.state.models,
          this.snapshotForRuntime(runtime),
        );
        const changed = runtime.approvalPreset !== next.approvalPreset
          || runtime.selectedModelId !== next.selectedModelId
          || runtime.selectedReasoningEffort !== next.selectedReasoningEffort
          || runtime.planMode !== next.planMode;
        this.patchRuntime(notification.params.threadId, next);
        if (changed) this.emitConversationSettings(notification.params.threadId, 'notification');
        return;
      }
      case 'thread/goal/updated': {
        const runtime = this.requireRuntime(notification.params.threadId);
        if (sameValue(runtime.goal, notification.params.goal)) return;
        this.patchRuntime(notification.params.threadId, { goal: { ...notification.params.goal } });
        this.emitEvent('notification', {
          type: 'conversation.goalChanged',
          conversationId: notification.params.threadId,
          ...(notification.params.turnId ? { turnId: notification.params.turnId } : {}),
          payload: { goal: structuredClone(notification.params.goal) },
        });
        return;
      }
      case 'thread/goal/cleared':
        if (this.requireRuntime(notification.params.threadId).goal === null) return;
        this.patchRuntime(notification.params.threadId, { goal: null });
        this.emitEvent('notification', {
          type: 'conversation.goalChanged',
          conversationId: notification.params.threadId,
          payload: { goal: null },
        });
        return;
      case 'thread/tokenUsage/updated': {
        const contextUsage = surfaceContextUsage(notification.params.tokenUsage);
        this.patchRuntime(notification.params.threadId, {
          contextUsage,
        });
        this.emitEvent('notification', {
          type: 'conversation.contextUsageChanged',
          conversationId: notification.params.threadId,
          turnId: notification.params.turnId,
          payload: { contextUsage: structuredClone(contextUsage) },
        });
        return;
      }
      case 'turn/started': {
        const runtime = this.requireRuntime(notification.params.threadId);
        const alreadyActive = runtime.activeTurnId === notification.params.turn.id;
        this.markRuntimeTurnActive(runtime, notification.params.turn.id);
        this.patchConversationTurnCount(notification.params.threadId, runtime.turnIds.length);
        this.patchRuntime(notification.params.threadId, {
          busy: true,
          turnStartPending: false,
          error: null,
          turnGitDiff: null,
          messages: ensureAssistantTurnMessage(
            runtime.messages,
            notification.params.threadId,
            notification.params.turn.id,
            { createdAt: timestampToIso(notification.params.turn.startedAt) },
          ),
        });
        this.patchConversationStatus(notification.params.threadId, 'active');
        if (!alreadyActive) {
          this.emitEvent('notification', {
            type: 'turn.started',
            conversationId: notification.params.threadId,
            turnId: notification.params.turn.id,
            payload: { startedAt: timestampToIso(notification.params.turn.startedAt) },
          });
        }
        this.emitConversationActivity(notification.params.threadId, 'notification');
        return;
      }
      case 'item/agentMessage/delta':
        this.applyAgentDelta(notification.params);
        return;
      case 'item/plan/delta':
        this.applyPlanDelta(notification.params);
        return;
      case 'item/started':
      case 'item/completed':
        this.applyItem(notification.params, notification.method === 'item/completed');
        return;
      case 'item/commandExecution/outputDelta':
        if (!this.commandOutputForwardItemIds.has(threadItemKey(
          notification.params.threadId,
          notification.params.itemId,
        ))) return;
        this.applyToolUpdate(
          notification.params.threadId,
          notification.params.turnId,
          commandOutputDeltaToToolPartUpdate(notification.params.itemId, notification.params.delta),
        );
        return;
      case 'item/fileChange/patchUpdated':
        this.applyToolUpdate(
          notification.params.threadId,
          notification.params.turnId,
          fileChangePatchToToolPartUpdate(notification.params.itemId, notification.params.changes),
        );
        return;
      case 'item/mcpToolCall/progress':
        this.applyToolUpdate(
          notification.params.threadId,
          notification.params.turnId,
          mcpProgressToToolPartUpdate(notification.params.itemId, notification.params.message),
        );
        return;
      case 'rawResponseItem/completed':
        this.applyRawResponseItem(notification.params);
        return;
      case 'turn/plan/updated':
        this.applyPlanUpdated(notification.params);
        return;
      case 'serverRequest/resolved': {
        const requestId = String(notification.params.requestId);
        const pending = this.pendingClientRequests.get(requestId);
        const pendingApproval = this.pendingApprovals.get(requestId);
        this.pendingClientRequests.delete(requestId);
        this.pendingApprovals.delete(requestId);
        this.refreshActiveApprovals();
        if (pending) {
          const runtime = this.requireRuntime(pending.threadId);
          this.patchRuntime(pending.threadId, {
            answeredClientRequestIds: addUnique(runtime.answeredClientRequestIds, requestId),
          });
        }
        this.maybeClearWaitingBusy(notification.params.threadId);
        if (pending) {
          this.emitEvent('notification', {
            type: 'clientRequest.resolved',
            conversationId: pending.threadId,
            ...(pending.turnId ? { turnId: pending.turnId } : {}),
            payload: {
              request: structuredClone(pending.request),
              response: null,
              reason: 'server',
            },
          });
        }
        if (pendingApproval) {
          this.emitEvent('notification', {
            type: 'approval.resolved',
            conversationId: pendingApproval.approval.conversationId,
            ...(pendingApproval.approval.turnId ? { turnId: pendingApproval.approval.turnId } : {}),
            payload: {
              approval: structuredClone(pendingApproval.approval),
              decision: null,
              scope: null,
              reason: 'server',
            },
          });
        }
        this.emitConversationActivity(notification.params.threadId, 'notification');
        return;
      }
      case 'turn/diff/updated': {
        const counts = lineDiffFromUnifiedDiff(notification.params.diff);
        this.patchRuntime(notification.params.threadId, {
          turnGitDiff: {
            turnId: notification.params.turnId,
            addedLines: counts.addedLines,
            removedLines: counts.removedLines,
            diff: notification.params.diff,
            updatedAt: new Date().toISOString(),
          },
        });
        this.emitEvent('notification', {
          type: 'conversation.diffUpdated',
          conversationId: notification.params.threadId,
          payload: { diff: structuredClone(this.requireRuntime(notification.params.threadId).turnGitDiff) },
        });
        return;
      }
      case 'thread/compacted': {
        this.patchRuntime(notification.params.threadId, {
          messages: appendCompactionMarker(
            this.requireRuntime(notification.params.threadId).messages,
            notification.params.threadId,
            notification.params.turnId,
          ),
        });
        const message = this.requireRuntime(notification.params.threadId).messages.find((candidate) => (
          candidate.kind === 'compaction' && candidate.metadata?.turnId === notification.params.turnId
        ));
        if (message) {
          this.emitEvent('notification', {
            type: 'context.compactionCompleted',
            conversationId: notification.params.threadId,
            turnId: notification.params.turnId,
            payload: { itemId: null, message: structuredClone(message) },
          });
        }
        return;
      }
      case 'turn/completed':
        this.applyTurnCompleted(notification.params);
        return;
      case 'error': {
        const runtime = this.requireRuntime(notification.params.threadId);
        const terminalCurrentTurn = !notification.params.willRetry
          && runtime.activeTurnId === notification.params.turnId;
        if (terminalCurrentTurn) runtime.activeTurnId = null;
        this.patchRuntime(notification.params.threadId, {
          error: notification.params.error.message,
          ...(terminalCurrentTurn ? { busy: false, turnStartPending: false } : {}),
        });
        if (terminalCurrentTurn) this.patchConversationStatus(notification.params.threadId, 'error');
        this.emitEvent('notification', {
          type: 'turn.error',
          conversationId: notification.params.threadId,
          turnId: notification.params.turnId,
          payload: {
            error: surfaceTurnError(notification.params.error)!,
            willRetry: notification.params.willRetry,
          },
        });
        this.emitConversationActivity(notification.params.threadId, 'notification');
        return;
      }
      case 'account/rateLimits/updated':
        this.patch({ rateLimits: mergeSurfaceRateLimits(this.state.rateLimits, notification.params.rateLimits) });
        this.emitEvent('notification', {
          type: 'rateLimits.changed',
          payload: { rateLimits: structuredClone(this.state.rateLimits) },
        });
        return;
      case 'account/updated':
        this.refreshAuthenticationFromNotification();
        return;
      case 'account/login/completed':
        this.handleAccountLoginCompleted(notification.params);
        return;
      case 'hook/started':
      case 'hook/completed':
      case 'item/autoApprovalReview/started':
      case 'item/autoApprovalReview/completed':
      case 'command/exec/outputDelta':
      case 'process/outputDelta':
      case 'process/exited':
      case 'item/commandExecution/terminalInteraction':
      case 'item/fileChange/outputDelta':
      case 'mcpServer/oauthLogin/completed':
      case 'mcpServer/startupStatus/updated':
      case 'app/list/updated':
      case 'remoteControl/status/changed':
      case 'externalAgentConfig/import/progress':
      case 'externalAgentConfig/import/completed':
      case 'fs/changed':
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/summaryPartAdded':
      case 'item/reasoning/textDelta':
      case 'model/rerouted':
      case 'model/verification':
      case 'turn/moderationMetadata':
      case 'model/safetyBuffering/updated':
      case 'warning':
      case 'guardianWarning':
      case 'deprecationNotice':
      case 'configWarning':
      case 'fuzzyFileSearch/sessionUpdated':
      case 'fuzzyFileSearch/sessionCompleted':
      case 'thread/realtime/started':
      case 'thread/realtime/itemAdded':
      case 'thread/realtime/transcript/delta':
      case 'thread/realtime/transcript/done':
      case 'thread/realtime/outputAudio/delta':
      case 'thread/realtime/sdp':
      case 'thread/realtime/error':
      case 'thread/realtime/closed':
      case 'windows/worldWritableWarning':
      case 'windowsSandbox/setupCompleted':
        return;
      default:
        return this.handleUnknownNotification(notification);
    }
  }

  private handleUnknownNotification(notification: never): void {
    const runtimeNotification = notification as unknown as { method: string; params?: unknown };
    this.options.onUnknownNotification?.({
      method: runtimeNotification.method,
      ...('params' in runtimeNotification ? { params: runtimeNotification.params } : {}),
    });
  }

  private handleDisconnect(error: Error): void {
    if (this.closed) return;
    this.pluginCatalogLastAttemptedCwdsKey = null;
    this.pluginCatalogRefreshRequested = false;
    this.catalogIconDataUrls.clear();
    for (const runtime of this.runtimes.values()) {
      this.clearPendingForThread(runtime.threadId, error.message, 'surface_disconnected');
      runtime.activeTurnId = null;
      runtime.busy = false;
      runtime.turnStartPending = false;
      runtime.historyLoading = false;
      runtime.error = error.message;
    }
    this.pendingApprovals.clear();
    this.pendingClientRequests.clear();
    this.commandOutputForwardItemIds.clear();
    this.patch({
      status: 'error',
      busy: false,
      clientRequests: [],
      historyLoading: false,
      approvals: [],
      error: error.message,
    });
    this.emitSurfaceStatus('lifecycle');
    for (const runtime of this.runtimes.values()) {
      this.emitConversationActivity(runtime.threadId, 'lifecycle');
    }
  }

  private applyAgentDelta(params: v2.AgentMessageDeltaNotification): void {
    const runtime = this.requireRuntime(params.threadId);
    this.markRuntimeTurnActive(runtime, params.turnId);
    this.patchRuntime(params.threadId, {
      messages: appendAssistantTextDelta(
        runtime.messages,
        params.threadId,
        params.turnId,
        params.itemId,
        params.delta,
      ),
    });
    const message = this.assistantMessageForTurn(params.threadId, params.turnId);
    if (message) {
      this.emitEvent('notification', {
        type: 'message.delta',
        conversationId: params.threadId,
        turnId: params.turnId,
        payload: {
          messageId: message.id,
          itemId: params.itemId,
          delta: params.delta,
        },
      });
    }
  }

  private applyPlanDelta(params: v2.PlanDeltaNotification): void {
    const runtime = this.requireRuntime(params.threadId);
    this.markRuntimeTurnActive(runtime, params.turnId);
    const markdown = `${runtime.planMarkdownByTurn.get(params.turnId) ?? ''}${params.delta}`;
    runtime.planMarkdownByTurn.set(params.turnId, markdown);
    this.patchRuntime(params.threadId, {
      messages: upsertAssistantToolPart(
        runtime.messages,
        params.threadId,
        params.turnId,
        planProgressToolPart(params.turnId, markdown, 'running'),
      ),
    });
    this.emitEvent('notification', {
      type: 'plan.delta',
      conversationId: params.threadId,
      turnId: params.turnId,
      payload: {
        itemId: params.itemId,
        delta: params.delta,
        markdown,
      },
    });
  }

  private applyPlanUpdated(params: v2.TurnPlanUpdatedNotification): void {
    const runtime = this.requireRuntime(params.threadId);
    this.markRuntimeTurnActive(runtime, params.turnId);
    const markdown = formatPlanMarkdown(params.explanation, params.plan);
    const status = 'completed' as const;
    runtime.planMarkdownByTurn.set(params.turnId, markdown);
    this.patchRuntime(params.threadId, {
      messages: upsertAssistantToolPart(
        runtime.messages,
        params.threadId,
        params.turnId,
        planProgressToolPart(params.turnId, markdown, 'completed'),
      ),
    });
    this.emitEvent('notification', {
      type: 'plan.updated',
      conversationId: params.threadId,
      turnId: params.turnId,
      payload: {
        explanation: params.explanation,
        steps: structuredClone(params.plan),
        markdown,
        status,
      },
    });
  }

  private applyRawResponseItem(params: v2.RawResponseItemCompletedNotification): void {
    const runtime = this.requireRuntime(params.threadId);
    this.markRuntimeTurnActive(runtime, params.turnId);
    const event = rawResponseItemToEvent(params.item);
    if (!event) return;
    if (event.type === 'item.updated') {
      this.applyToolUpdate(params.threadId, params.turnId, event.payload);
      return;
    }
    this.patchRuntime(params.threadId, {
      messages: upsertAssistantToolPart(
        runtime.messages,
        params.threadId,
        params.turnId,
        event.payload.toolPart,
      ),
    });
    const message = this.messageContainingTool(params.threadId, params.turnId, event.payload.toolPart.id);
    if (message) {
      this.emitEvent('notification', {
        type: event.type === 'item.completed' ? 'tool.completed' : 'tool.started',
        conversationId: params.threadId,
        turnId: params.turnId,
        payload: {
          messageId: message.id,
          toolPart: structuredClone(event.payload.toolPart),
        },
      });
    }
  }

  private handleToolInputRequest(
    request: ToolInputRequest,
    responder: CodexServerRequestResponder<'item/tool/requestUserInput'>,
  ): boolean {
    const { threadId, turnId, itemId, questions } = request.params;
    if (questions.length === 0) return false;
    const runtime = this.requireRuntime(threadId);
    this.markRuntimeTurnActive(runtime, turnId);
    const requestId = String(request.id);
    const normalizedQuestions = questions.map((question) => ({
      ...question,
      options: question.options?.map((option) => ({ ...option })) ?? null,
    }));
    const clientRequest: Extract<CodexSurfaceClientRequest, { kind: 'ask_user' }> = {
      id: requestId,
      kind: 'ask_user',
      conversationId: threadId,
      turnId,
      itemId,
      payload: {
        request: {
          itemId,
          questions: normalizedQuestions,
          ...(request.params.autoResolutionMs === null
            ? {}
            : { autoResolutionMs: request.params.autoResolutionMs }),
        },
      },
    };
    this.pendingClientRequests.set(requestId, {
      kind: 'ask_user',
      itemId,
      request: clientRequest,
      threadId,
      turnId,
      responder,
    });
    this.patchRuntime(threadId, {
      busy: true,
      messages: upsertAssistantToolPart(runtime.messages, threadId, turnId, {
        type: 'tool',
        id: itemId,
        kind: 'generic',
        title: 'ask_user_question',
        status: 'running',
        statusText: JSON.stringify({
          source: 'codex',
          action: 'ask_user_question',
          phase: 'running',
          params: { requestId, questions: normalizedQuestions },
        }),
        input: normalizedQuestions,
        metadata: { requestId, question: normalizedQuestions[0]?.question },
      }),
    });
    const requestToolMessage = this.messageContainingTool(threadId, turnId, itemId);
    const requestToolPart = requestToolMessage?.parts.find((part) => part.type === 'tool' && part.id === itemId);
    if (requestToolMessage && requestToolPart?.type === 'tool') {
      this.emitEvent('notification', {
        type: 'tool.started',
        conversationId: threadId,
        turnId,
        payload: { messageId: requestToolMessage.id, toolPart: structuredClone(requestToolPart) },
      });
    }
    this.emitEvent('notification', {
      type: 'clientRequest.requested',
      conversationId: threadId,
      turnId,
      payload: { request: structuredClone(clientRequest) },
    });
    this.emitConversationActivity(threadId, 'notification');
    return true;
  }

  private handleMcpElicitationRequest(
    request: McpElicitationRequest,
    responder: CodexServerRequestResponder<'mcpServer/elicitation/request'>,
  ): boolean {
    const params = request.params;
    const meta = params.mode === 'form' ? params._meta : null;
    if (
      params.mode !== 'form'
      || !isRecord(meta)
      || meta.codex_approval_kind !== 'mcp_tool_call'
    ) return false;
    const requestId = String(request.id);
    const toolName = stringValue(meta.tool_name) ?? stringValue(meta.tool_title) ?? 'tool';
    const runtime = this.requireRuntime(params.threadId);
    if (params.turnId) this.markRuntimeTurnActive(runtime, params.turnId);
    const displayTurnId = params.turnId ?? runtime.activeTurnId ?? `client-request-${requestId}`;
    const existingTool = findPendingMcpToolPart(
      runtime.messages,
      displayTurnId,
      params.serverName,
      toolName,
    );
    const itemId = existingTool?.id ?? `approval-${requestId}`;
    const clientRequest: Extract<CodexSurfaceClientRequest, { kind: 'confirm_tool' }> = {
      id: requestId,
      kind: 'confirm_tool',
      conversationId: params.threadId,
      turnId: params.turnId,
      itemId,
      payload: {
        confirmation: {
          argumentsPreview: argumentsPreview(meta),
          integrationId: params.serverName,
          integrationName: stringValue(meta.connector_name) ?? params.serverName,
          summary: params.message.trim() || `Allow ${params.serverName} to run ${toolName}?`,
          toolName,
          ...(persistSupports(meta.persist, 'session') ? { allowConversation: true } : {}),
          ...(persistSupports(meta.persist, 'always') ? { allowAlways: true } : {}),
        },
      },
    };
    this.pendingClientRequests.set(requestId, {
      kind: 'mcp_tool_approval',
      displayTurnId,
      itemId,
      request: clientRequest,
      threadId: params.threadId,
      turnId: params.turnId,
      responder,
    });
    const statusText = JSON.stringify({
        source: 'mcp',
        action: 'confirm_tool',
        phase: 'running',
        params: {
          requestId,
          confirmationSummary: params.message.trim() || `Allow ${params.serverName} to run ${toolName}?`,
          argumentsPreview: argumentsPreview(meta),
          allowConversation: persistSupports(meta.persist, 'session'),
          allowAlways: persistSupports(meta.persist, 'always'),
        },
    });
    const toolPart: SurfaceMessageToolPart = {
      type: 'tool',
      id: itemId,
      kind: 'mcp',
      title: `${params.serverName}.${toolName}`,
      status: 'running',
      statusText,
      input: meta.tool_params,
      metadata: {
        ...(existingTool?.metadata ?? {}),
        requestId,
        confirmationRequestId: requestId,
        server: params.serverName,
        tool: toolName,
      },
    };
    this.patchRuntime(params.threadId, {
      busy: true,
      messages: upsertAssistantToolPart(runtime.messages, params.threadId, displayTurnId, toolPart),
    });
    const toolMessage = this.messageContainingTool(params.threadId, displayTurnId, itemId);
    if (toolMessage) {
      this.emitEvent('notification', {
        type: 'tool.started',
        conversationId: params.threadId,
        turnId: displayTurnId,
        payload: { messageId: toolMessage.id, toolPart: structuredClone(toolPart) },
      });
    }
    this.emitEvent('notification', {
      type: 'clientRequest.requested',
      conversationId: params.threadId,
      ...(params.turnId ? { turnId: params.turnId } : {}),
      payload: { request: structuredClone(clientRequest) },
    });
    this.emitConversationActivity(params.threadId, 'notification');
    return true;
  }

  private applyItem(params: v2.ItemStartedNotification | v2.ItemCompletedNotification, completed: boolean): void {
    const runtime = this.requireRuntime(params.threadId);
    if (!completed) this.markRuntimeTurnActive(runtime, params.turnId);
    const turn = {
      id: params.turnId,
      status: completed ? 'completed' : 'inProgress',
      startedAt: ('startedAtMs' in params ? params.startedAtMs : params.completedAtMs) / 1000,
    } as const;

    if (params.item.type === 'userMessage') {
      const message = codexItemToSurfaceMessage(params.threadId, turn, params.item);
      if (!message || runtime.messages.some((candidate) => candidate.id === message.id)) return;
      const isSteer = runtime.messages.some((candidate) => (
        candidate.role === 'assistant'
        && candidate.metadata?.turnId === params.turnId
        && candidate.parts.length > 0
      ));
      const messages = [...runtime.messages, isSteer ? { ...message, kind: 'steer' as const } : message];
      const appended = isSteer ? { ...message, kind: 'steer' as const } : message;
      this.patchRuntime(params.threadId, {
        messages: isSteer
          ? ensureAssistantTurnMessage(messages, params.threadId, params.turnId, { forceSegment: true })
          : messages,
      });
      this.emitEvent('notification', {
        type: 'message.appended',
        conversationId: params.threadId,
        turnId: params.turnId,
        payload: { message: structuredClone(appended) },
      });
      return;
    }

    if (params.item.type === 'agentMessage' || params.item.type === 'exitedReviewMode') {
      const text = params.item.type === 'agentMessage' ? params.item.text : params.item.review;
      if (!text) return;
      const previousMessageIds = new Set(runtime.messages.map((message) => message.id));
      const previousText = runtime.messages
        .flatMap((message) => message.parts)
        .find((part): part is Extract<SurfaceMessage['parts'][number], { type: 'text' }> => (
          part.type === 'text' && part.itemId === params.item.id
        ))?.text ?? '';
      this.patchRuntime(params.threadId, {
        messages: upsertAssistantText(
          runtime.messages,
          params.threadId,
          params.turnId,
          params.item.id,
          text,
        ),
      });
      const message = this.assistantMessageForTurn(params.threadId, params.turnId);
      if (message && !previousMessageIds.has(message.id)) {
        this.emitEvent('notification', {
          type: 'message.appended',
          conversationId: params.threadId,
          turnId: params.turnId,
          payload: { message: structuredClone(message) },
        });
      } else if (message && text !== previousText) {
        if (text.startsWith(previousText)) {
          const delta = text.slice(previousText.length);
          if (delta) {
            this.emitEvent('notification', {
              type: 'message.delta',
              conversationId: params.threadId,
              turnId: params.turnId,
              payload: { messageId: message.id, itemId: params.item.id, delta },
            });
          }
        } else {
          this.emitEvent('notification', {
            type: 'message.updated',
            conversationId: params.threadId,
            turnId: params.turnId,
            payload: { message: structuredClone(message) },
          });
        }
      }
      return;
    }

    if (params.item.type === 'plan') {
      if (!completed) return;
      const markdown = params.item.text.trim() || runtime.planMarkdownByTurn.get(params.turnId) || '';
      runtime.planMarkdownByTurn.set(params.turnId, markdown);
      this.patchRuntime(params.threadId, {
        messages: upsertAssistantToolPart(
          runtime.messages,
          params.threadId,
          params.turnId,
          planProgressToolPart(params.turnId, markdown, 'completed'),
        ),
      });
      this.emitEvent('notification', {
        type: 'plan.completed',
        conversationId: params.threadId,
        turnId: params.turnId,
        payload: { itemId: params.item.id, markdown },
      });
      return;
    }

    if (params.item.type === 'contextCompaction') {
      this.patchRuntime(params.threadId, {
        messages: appendCompactionMarker(runtime.messages, params.threadId, params.turnId),
      });
      if (completed) {
        const message = this.requireRuntime(params.threadId).messages.find((candidate) => (
          candidate.kind === 'compaction' && candidate.metadata?.turnId === params.turnId
        ));
        if (message) {
          this.emitEvent('notification', {
            type: 'context.compactionCompleted',
            conversationId: params.threadId,
            turnId: params.turnId,
            payload: { itemId: params.item.id, message: structuredClone(message) },
          });
        }
      } else {
        this.emitEvent('notification', {
          type: 'context.compactionStarted',
          conversationId: params.threadId,
          turnId: params.turnId,
          payload: { itemId: params.item.id },
        });
      }
      return;
    }

    const includeCommandOutput = this.shouldForwardCommandOutput(params.threadId, completed, params.item);
    const toolPart = codexItemToToolPart(params.item, { includeCommandOutput });
    const mediaPart = codexItemToMediaPart(params.item);
    if (!toolPart && !mediaPart) return;
    const mediaChanged = mediaPart ? !runtime.messages.some((message) => (
      message.parts.some((part) => part.type === 'media' && surfaceMediaPartsEqual(part, mediaPart))
    )) : false;
    let messages = toolPart
      ? upsertAssistantToolPart(runtime.messages, params.threadId, params.turnId, toolPart)
      : [...runtime.messages];
    if (mediaPart) {
      messages = upsertAssistantMediaPart(messages, params.threadId, params.turnId, mediaPart);
    }
    this.patchRuntime(params.threadId, {
      messages,
    });
    const message = toolPart
      ? this.messageContainingTool(params.threadId, params.turnId, toolPart.id)
      : this.assistantMessageForTurn(params.threadId, params.turnId);
    if (message && toolPart) {
      this.emitEvent('notification', {
        type: completed ? 'tool.completed' : 'tool.started',
        conversationId: params.threadId,
        turnId: params.turnId,
        payload: { messageId: message.id, toolPart: structuredClone(toolPart) },
      });
    }
    if (message && mediaPart && mediaChanged) {
      this.emitEvent('notification', {
        type: 'message.updated',
        conversationId: params.threadId,
        turnId: params.turnId,
        payload: { message: structuredClone(message) },
      });
    }
  }

  private shouldForwardCommandOutput(threadId: string, completed: boolean, item: v2.ThreadItem): boolean {
    const itemId = 'id' in item && typeof item.id === 'string' ? item.id : null;
    if (!itemId) return false;
    const key = threadItemKey(threadId, itemId);
    if (!completed) {
      const shouldForward = shouldForwardCommandExecutionOutput(item);
      if (shouldForward) this.commandOutputForwardItemIds.add(key);
      else this.commandOutputForwardItemIds.delete(key);
      return shouldForward;
    }
    const shouldForward = this.commandOutputForwardItemIds.has(key)
      || shouldForwardCommandExecutionOutput(item);
    this.commandOutputForwardItemIds.delete(key);
    return shouldForward;
  }

  private applyToolUpdate(threadId: string, turnId: string, update: SurfaceMessageToolPartUpdate): void {
    const runtime = this.requireRuntime(threadId);
    this.markRuntimeTurnActive(runtime, turnId);
    this.patchRuntime(threadId, {
      messages: updateAssistantToolPart(runtime.messages, threadId, turnId, update),
    });
    const message = this.messageContainingTool(threadId, turnId, update.itemId);
    if (message) {
      this.emitEvent('notification', {
        type: 'tool.updated',
        conversationId: threadId,
        turnId,
        payload: { messageId: message.id, update: structuredClone(update) },
      });
    }
  }

  private applyTurnCompleted(params: v2.TurnCompletedNotification): void {
    const runtime = this.requireRuntime(params.threadId);
    if (!runtime.turnIds.includes(params.turn.id)) runtime.turnIds.push(params.turn.id);
    if (runtime.activeTurnId === params.turn.id) runtime.activeTurnId = null;
    const status: SurfaceMessage['status'] = params.turn.status === 'failed' ? 'error' : 'complete';
    const messages = finalizeTurnToolParts(runtime.messages, params.turn.id, params.turn.status)
      .map((message) => message.metadata?.turnId === params.turn.id ? { ...message, status } : message)
      .filter((message) => !(
        message.role === 'assistant'
        && message.metadata?.turnId === params.turn.id
        && message.kind === undefined
        && message.parts.length === 0
      ));
    this.patchRuntime(params.threadId, {
      busy: false,
      turnStartPending: false,
      error: params.turn.error?.message ?? null,
      messages,
    });
    this.patch({
      conversations: this.state.conversations.map((conversation) => conversation.id === params.threadId
        ? {
          ...conversation,
          status: params.turn.status === 'failed' ? 'error' : 'idle',
          turnCount: runtime.turnIds.length,
          updatedAt: new Date().toISOString(),
        }
        : conversation),
    });
    const summary = this.state.conversations.find((conversation) => conversation.id === params.threadId);
    if (summary) this.emitSummaryUpserted(summary, 'updated', 'notification');
    this.emitEvent('notification', {
      type: 'turn.completed',
      conversationId: params.threadId,
      turnId: params.turn.id,
      payload: {
        status: params.turn.status,
        error: surfaceTurnError(params.turn.error),
        willRetry: false,
        startedAt: timestampToIsoOrNull(params.turn.startedAt),
        completedAt: timestampToIsoOrNull(params.turn.completedAt),
        durationMs: params.turn.durationMs ?? null,
      },
    });
    this.emitConversationActivity(params.threadId, 'notification');
    runtime.planMarkdownByTurn.delete(params.turn.id);
    void this.sendNextQueuedPrompt(params.threadId);
  }

  private async sendNextQueuedPrompt(threadId: string): Promise<void> {
    const runtime = this.requireRuntime(threadId);
    if (runtime.busy || runtime.queuedPrompts.length === 0) return;
    const [next, ...queuedPrompts] = runtime.queuedPrompts;
    if (!next) return;
    this.patchRuntime(threadId, { queuedPrompts });
    try {
      await this.sendPromptToThread(threadId, next.text, next.options);
    } catch (error) {
      this.patchRuntime(threadId, {
        error: errorMessage(error),
        queuedPrompts: [next, ...runtime.queuedPrompts],
      });
    }
  }

  private emitEvent(origin: CodexSurfaceEventOrigin, input: SurfaceEventInput): void {
    const event = {
      ...input,
      seq: ++this.eventSequence,
      occurredAt: new Date().toISOString(),
      origin,
    } as CodexSurfaceEvent;
    for (const listener of this.eventListeners) listener(event);
  }

  private patch(patch: Partial<CodexSurfaceSnapshot>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
    for (const threadId of this.conversationListeners.keys()) {
      this.notifyConversationListeners(threadId);
    }
  }
}

export function createCodexSurface(options: CodexSurfaceOptions = {}): CodexSurface {
  return new CodexSurface(options);
}

function normalizeMcpServers(
  definitions: readonly CodexMcpServerDefinition[],
): readonly CodexMcpServerDefinition[] {
  if (!Array.isArray(definitions)) throw new TypeError('Codex MCP servers must be an array');
  const names = new Set<string>();
  return definitions.map((definition, index) => {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      throw new TypeError(`Codex MCP server ${index + 1} must be an object`);
    }
    const name = definition.name?.trim();
    if (!name || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
      throw new TypeError(`Codex MCP server ${index + 1} name must match ^[A-Za-z0-9][A-Za-z0-9_-]*$`);
    }
    if (names.has(name)) throw new Error(`Duplicate Codex MCP server '${name}'`);
    names.add(name);
    const transport = normalizeMcpTransport(definition.transport, name);
    const toolApprovalMode = definition.toolApprovalMode;
    if (
      toolApprovalMode !== undefined
      && toolApprovalMode !== 'auto'
      && toolApprovalMode !== 'prompt'
      && toolApprovalMode !== 'writes'
      && toolApprovalMode !== 'approve'
    ) {
      throw new TypeError(`Codex MCP server '${name}' tool approval mode is invalid`);
    }
    if (definition.required !== undefined && typeof definition.required !== 'boolean') {
      throw new TypeError(`Codex MCP server '${name}' required flag must be a boolean`);
    }
    const enabledTools = definition.enabledTools === undefined
      ? undefined
      : normalizedNonEmptyStrings(definition.enabledTools, `Codex MCP server '${name}' enabled tool`);
    const startupTimeoutMs = optionalPositiveMilliseconds(
      definition.startupTimeoutMs,
      `Codex MCP server '${name}' startup timeout`,
    );
    const toolTimeoutMs = optionalPositiveMilliseconds(
      definition.toolTimeoutMs,
      `Codex MCP server '${name}' tool timeout`,
    );
    return {
      name,
      transport,
      ...(toolApprovalMode === undefined ? {} : { toolApprovalMode }),
      ...(definition.required === undefined ? {} : { required: definition.required }),
      ...(enabledTools === undefined ? {} : { enabledTools }),
      ...(startupTimeoutMs === undefined ? {} : { startupTimeoutMs }),
      ...(toolTimeoutMs === undefined ? {} : { toolTimeoutMs }),
    };
  });
}

function normalizeMcpTransport(
  transport: CodexMcpServerTransport,
  serverName: string,
): CodexMcpServerTransport {
  if (!transport || typeof transport !== 'object' || Array.isArray(transport)) {
    throw new TypeError(`Codex MCP server '${serverName}' transport must be an object`);
  }
  if (transport.type === 'http') {
    const url = transport.url?.trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new TypeError(`Codex MCP server '${serverName}' URL must be valid`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new TypeError(`Codex MCP server '${serverName}' URL must use HTTP or HTTPS`);
    }
    return { type: 'http', url };
  }
  if (transport.type !== 'stdio') {
    throw new TypeError(`Codex MCP server '${serverName}' transport type is invalid`);
  }
  const command = transport.command?.trim();
  if (!command) throw new TypeError(`Codex MCP server '${serverName}' command cannot be empty`);
  const args = transport.args === undefined
    ? undefined
    : normalizedNonEmptyStrings(transport.args, `Codex MCP server '${serverName}' argument`);
  const cwd = transport.cwd?.trim();
  if (cwd !== undefined && (!cwd || !isAbsolute(cwd))) {
    throw new TypeError(`Codex MCP server '${serverName}' cwd must be an absolute path`);
  }
  let env: Record<string, string> | undefined;
  if (transport.env !== undefined) {
    if (!transport.env || typeof transport.env !== 'object' || Array.isArray(transport.env)) {
      throw new TypeError(`Codex MCP server '${serverName}' env must be an object`);
    }
    env = {};
    for (const [key, value] of Object.entries(transport.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string') {
        throw new TypeError(`Codex MCP server '${serverName}' env entries must be string environment variables`);
      }
      env[key] = value;
    }
  }
  const envVars = transport.envVars === undefined
    ? undefined
    : normalizedEnvironmentVariableNames(transport.envVars, serverName);
  return {
    type: 'stdio',
    command,
    ...(args === undefined ? {} : { args }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(env === undefined ? {} : { env }),
    ...(envVars === undefined ? {} : { envVars }),
  };
}

function normalizedNonEmptyStrings(values: readonly string[], label: string): string[] {
  if (!Array.isArray(values)) throw new TypeError(`${label}s must be an array`);
  const normalized = values.map((value) => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} cannot be empty`);
    return value.trim();
  });
  return [...new Set(normalized)];
}

function normalizedEnvironmentVariableNames(values: readonly string[], serverName: string): string[] {
  const names = normalizedNonEmptyStrings(values, `Codex MCP server '${serverName}' environment variable`);
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new TypeError(`Codex MCP server '${serverName}' environment variable '${name}' is invalid`);
    }
  }
  return names;
}

function optionalPositiveMilliseconds(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a positive finite number`);
  return value;
}

function mcpServerConfig(
  definitions: readonly CodexMcpServerDefinition[],
): Record<string, CodexSurfaceJsonValue> {
  const config: Record<string, CodexSurfaceJsonValue> = {};
  for (const definition of definitions) {
    const server: Record<string, CodexSurfaceJsonValue> = definition.transport.type === 'http'
      ? { url: definition.transport.url }
      : {
        command: definition.transport.command,
        ...(definition.transport.args === undefined ? {} : { args: [...definition.transport.args] }),
        ...(definition.transport.cwd === undefined ? {} : { cwd: definition.transport.cwd }),
        ...(definition.transport.env === undefined ? {} : { env: { ...definition.transport.env } }),
        ...(definition.transport.envVars === undefined ? {} : { env_vars: [...definition.transport.envVars] }),
      };
    if (definition.toolApprovalMode !== undefined) {
      server.default_tools_approval_mode = definition.toolApprovalMode;
    }
    if (definition.required !== undefined) server.required = definition.required;
    if (definition.enabledTools !== undefined) server.enabled_tools = [...definition.enabledTools];
    if (definition.startupTimeoutMs !== undefined) server.startup_timeout_sec = definition.startupTimeoutMs / 1000;
    if (definition.toolTimeoutMs !== undefined) server.tool_timeout_sec = definition.toolTimeoutMs / 1000;
    config[`mcp_servers.${definition.name}`] = server;
  }
  return config;
}

function assertNoMcpConfigCollision(
  config: Readonly<Record<string, CodexSurfaceJsonValue>>,
  definitions: readonly CodexMcpServerDefinition[],
): void {
  if (definitions.length === 0) return;
  for (const key of Object.keys(config)) {
    if (key === 'mcp_servers') {
      throw new Error('Raw mcp_servers config cannot be combined with typed Codex MCP servers');
    }
    for (const definition of definitions) {
      const path = `mcp_servers.${definition.name}`;
      if (key === path || key.startsWith(`${path}.`)) {
        throw new Error(`Raw config for Codex MCP server '${definition.name}' conflicts with its typed definition`);
      }
    }
  }
}

function initialAuthentication(): CodexSurfaceAuthentication {
  return {
    status: 'notLoaded',
    account: null,
    requiresOpenaiAuth: null,
    error: null,
    login: {
      status: 'idle',
      loginId: null,
      authUrl: null,
      error: null,
    },
  };
}

function surfaceAccount(account: v2.Account): NonNullable<CodexSurfaceAuthentication['account']> {
  if (account.type === 'chatgpt') {
    return {
      type: 'chatgpt',
      email: account.email,
      planType: account.planType,
    };
  }
  if (account.type === 'amazonBedrock') {
    return {
      type: 'amazonBedrock',
      credentialSource: account.credentialSource,
    };
  }
  return { type: 'apiKey' };
}

function surfaceAuthenticationKey(authentication: CodexSurfaceAuthentication): string {
  return JSON.stringify({
    account: authentication.account,
    requiresOpenaiAuth: authentication.requiresOpenaiAuth,
  });
}

function surfaceAuthenticationIdentityKey(authentication: CodexSurfaceAuthentication): string {
  const account = authentication.account;
  if (!account) {
    return JSON.stringify({ type: null, requiresOpenaiAuth: authentication.requiresOpenaiAuth });
  }
  if (account.type === 'chatgpt') return JSON.stringify({ type: account.type, email: account.email });
  if (account.type === 'amazonBedrock') {
    return JSON.stringify({ type: account.type, credentialSource: account.credentialSource });
  }
  return JSON.stringify({ type: account.type });
}

function normalizedLoginId(value: string): string {
  const loginId = value.trim();
  if (!loginId) throw new Error('Codex login id cannot be empty');
  return loginId;
}

function safeLoginUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Codex account/login/start returned an invalid authentication URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Codex account/login/start returned unsupported authentication URL scheme '${url.protocol}'`);
  }
  return url.href;
}

function surfaceTransportOptions(options: CodexSurfaceOptions): CodexAppServerStdioTransportOptions {
  const topLevelHome = options.codexHome === undefined
    ? undefined
    : absoluteCodexHome(options.codexHome);
  const transportHome = options.transport?.codexHome;
  if (topLevelHome !== undefined && transportHome !== undefined && topLevelHome !== transportHome) {
    throw new Error('Codex surface codexHome conflicts with transport.codexHome');
  }
  return {
    ...options.transport,
    ...(topLevelHome === undefined ? {} : { codexHome: topLevelHome }),
  };
}

function absoluteCodexHome(value: string): string {
  const codexHome = value.trim();
  if (!codexHome) throw new Error('Codex surface codexHome cannot be empty');
  if (!isAbsolute(codexHome)) throw new Error('Codex surface codexHome must be an absolute path');
  return codexHome;
}

function threadToSummary(thread: v2.Thread): CodexConversationSummary {
  const preview = thread.preview.trim();
  return {
    id: thread.id,
    title: thread.name?.trim() || preview.split('\n')[0]?.trim() || 'Untitled conversation',
    preview,
    cwd: thread.cwd,
    status: thread.status.type === 'active' ? 'active' : thread.status.type === 'systemError' ? 'error' : 'idle',
    turnCount: thread.turns.length,
    createdAt: new Date(thread.createdAt * 1000).toISOString(),
    updatedAt: new Date((thread.recencyAt ?? thread.updatedAt) * 1000).toISOString(),
  };
}

function upsertConversation(
  conversations: CodexConversationSummary[],
  next: CodexConversationSummary,
): CodexConversationSummary[] {
  return [next, ...conversations.filter((conversation) => conversation.id !== next.id)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

type SurfaceSelection = Pick<
  CodexSurfaceSnapshot,
  'approvalPreset' | 'planMode' | 'selectedModelId' | 'selectedReasoningEffort'
>;

function codexModelToSurfaceModel(model: v2.Model): CodexSurfaceModel {
  return {
    id: model.id,
    model: model.model,
    displayName: model.displayName,
    description: model.description,
    hidden: model.hidden,
    supportedReasoningEfforts: model.supportedReasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
    isDefault: model.isDefault,
    providerMetadata: {
      inputModalities: model.inputModalities,
      serviceTiers: model.serviceTiers,
      supportsPersonality: model.supportsPersonality,
      upgrade: model.upgrade,
      upgradeInfo: model.upgradeInfo,
    },
  };
}

async function surfaceSkills(
  skills: readonly v2.SkillMetadata[],
  localIconDataUrl: (path: string) => Promise<string | undefined>,
): Promise<CodexSurfaceSkill[]> {
  return Promise.all(
    skills
      .filter((skill) => skill.enabled)
      .map((skill) => surfaceSkill(skill, localIconDataUrl)),
  );
}

async function surfaceSkill(
  skill: v2.SkillMetadata,
  localIconDataUrl: (path: string) => Promise<string | undefined>,
): Promise<CodexSurfaceSkill> {
  const [iconSmall, iconLarge] = await Promise.all([
    skill.interface?.iconSmall ? localIconDataUrl(skill.interface.iconSmall) : undefined,
    skill.interface?.iconLarge ? localIconDataUrl(skill.interface.iconLarge) : undefined,
  ]);
  return {
    name: skill.name,
    description: skill.description,
    shortDescription: skill.shortDescription ?? skill.interface?.shortDescription,
    displayName: skill.interface?.displayName,
    iconSmall,
    iconLarge,
    brandColor: skill.interface?.brandColor,
    defaultPrompt: skill.interface?.defaultPrompt,
    path: skill.path,
    scope: skill.scope,
    enabled: skill.enabled,
  };
}

async function surfacePlugin(
  plugin: v2.PluginSummary,
  localIconDataUrl: (path: string) => Promise<string | undefined>,
): Promise<CodexSurfacePlugin> {
  const pluginInterface = plugin.interface;
  const composerIconUrl = safeRemoteImageUrl(pluginInterface?.composerIconUrl);
  const logoUrl = safeRemoteImageUrl(pluginInterface?.logoUrl);
  const logoUrlDark = safeRemoteImageUrl(pluginInterface?.logoUrlDark);
  const displayName = nonEmpty(pluginInterface?.displayName) ?? plugin.name;
  const shortDescription = nonEmpty(pluginInterface?.shortDescription);
  const longDescription = nonEmpty(pluginInterface?.longDescription);
  const brandColor = nonEmpty(pluginInterface?.brandColor);
  const iconUrl = composerIconUrl
    ?? logoUrl
    ?? await firstLocalPluginIcon([pluginInterface?.composerIcon, pluginInterface?.logo], localIconDataUrl);
  const iconUrlDark = composerIconUrl
    ?? logoUrlDark
    ?? logoUrl
    ?? await firstLocalPluginIcon([
      pluginInterface?.composerIcon,
      pluginInterface?.logoDark,
      pluginInterface?.logo,
    ], localIconDataUrl);
  return {
    id: plugin.id,
    name: plugin.name,
    displayName,
    ...(shortDescription ? { shortDescription } : {}),
    ...(longDescription ? { longDescription } : {}),
    ...(brandColor ? { brandColor } : {}),
    ...(iconUrl ? { iconUrl } : {}),
    ...(iconUrlDark ? { iconUrlDark } : {}),
    enabled: plugin.enabled,
  };
}

async function firstLocalPluginIcon(
  paths: readonly (string | null | undefined)[],
  localIconDataUrl: (path: string) => Promise<string | undefined>,
): Promise<string | undefined> {
  for (const path of paths) {
    if (!path) continue;
    const dataUrl = await localIconDataUrl(path);
    if (dataUrl) return dataUrl;
  }
  return undefined;
}

function safeRemoteImageUrl(value: string | null | undefined): string | undefined {
  const url = nonEmpty(value);
  if (!url) return undefined;
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function catalogIconMimeType(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case '.avif': return 'image/avif';
    case '.bmp': return 'image/bmp';
    case '.gif': return 'image/gif';
    case '.ico': return 'image/x-icon';
    case '.jpeg':
    case '.jpg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.webp': return 'image/webp';
    default: return undefined;
  }
}

function boundedImageDataUrl(mimeType: string, dataBase64: string): string | undefined {
  const encoded = dataBase64.trim();
  if (!encoded || encoded.length > MAX_CATALOG_ICON_BASE64_LENGTH || !/^[a-z\d+/]+={0,2}$/i.test(encoded)) {
    return undefined;
  }
  const unpadded = encoded.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) return undefined;
  const suppliedPadding = encoded.length - unpadded.length;
  const requiredPadding = (4 - (unpadded.length % 4)) % 4;
  if (suppliedPadding !== 0 && suppliedPadding !== requiredPadding) return undefined;
  const byteLength = Math.floor((unpadded.length * 3) / 4);
  if (byteLength > MAX_CATALOG_ICON_BYTES) return undefined;
  const padded = `${unpadded}${'='.repeat((4 - (unpadded.length % 4)) % 4)}`;
  return `data:${mimeType};base64,${padded}`;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function selectedModel(models: CodexSurfaceModel[], idOrModel: string | null): CodexSurfaceModel | null {
  return models.find((model) => model.id === idOrModel || model.model === idOrModel)
    ?? models.find((model) => model.isDefault)
    ?? models[0]
    ?? null;
}

function requireCatalogModel(models: CodexSurfaceModel[], idOrModel: string): CodexSurfaceModel {
  const model = models.find((candidate) => candidate.id === idOrModel || candidate.model === idOrModel);
  if (!model) throw new Error(`Unknown model '${idOrModel}'`);
  return model;
}

function validateReasoningEffort(
  model: CodexSurfaceModel | null,
  reasoningEffort: string | undefined,
): void {
  if (!reasoningEffort) return;
  if (!model) throw new Error(`Cannot select reasoning effort '${reasoningEffort}' without a model`);
  const supported = model.supportedReasoningEfforts?.map((option) => option.reasoningEffort) ?? [];
  if (supported.length > 0 && !supported.includes(reasoningEffort)) {
    throw new Error(`Reasoning effort '${reasoningEffort}' is not available for '${model.displayName}'`);
  }
}

function validatedSendOptions(
  state: CodexSurfaceSnapshot,
  options: SendCodexMessageOptions,
): SendCodexMessageOptions {
  const model = options.model
    ? requireCatalogModel(state.models, options.model)
    : selectedModel(state.models, state.selectedModelId);
  validateReasoningEffort(model, options.reasoningEffort);
  return {
    ...options,
    ...(options.attachments ? { attachments: validateAttachments(options.attachments) } : {}),
    ...(options.model && model ? { model: model.model } : {}),
  };
}

function validateAttachments(attachments: readonly CodexSurfaceAttachment[]): CodexSurfaceAttachment[] {
  return attachments.map((attachment) => {
    const path = attachment.path.trim();
    if (!path) throw new Error('Attachment paths cannot be empty');
    if (!isAbsolute(path)) throw new Error(`Attachment path must be absolute: '${path}'`);
    if (attachment.type === 'image') return { ...attachment, path };
    const name = attachment.name?.trim();
    return { ...attachment, path, ...(name ? { name } : {}) };
  });
}

function attachmentInput(attachment: CodexSurfaceAttachment): v2.UserInput {
  if (attachment.type === 'image') {
    return {
      type: 'localImage',
      path: attachment.path,
      ...(attachment.detail === undefined ? {} : { detail: attachment.detail }),
    };
  }
  return {
    type: 'mention',
    name: attachment.name ?? basename(attachment.path),
    path: attachment.path,
  };
}

function surfaceAttachmentPart(attachment: CodexSurfaceAttachment): SurfaceMessageAttachmentPart {
  const name = attachment.name?.trim() || basename(attachment.path);
  if (attachment.type === 'image') {
    return {
      type: 'attachment',
      attachment: {
        kind: 'image',
        name,
        path: attachment.path,
        url: attachment.previewUrl ?? pathToFileURL(attachment.path).href,
        ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      },
    };
  }
  return {
    type: 'attachment',
    attachment: {
      kind: 'file',
      name,
      path: attachment.path,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    },
  };
}

function defaultReasoningEffort(model: CodexSurfaceModel): string | null {
  return model.defaultReasoningEffort
    ?? model.supportedReasoningEfforts?.[0]?.reasoningEffort
    ?? null;
}

function surfaceContextUsage(tokenUsage: v2.ThreadTokenUsage): CodexSurfaceContextUsage {
  const modelContextWindow = tokenUsage.modelContextWindow;
  const contextTokens = tokenUsage.last.totalTokens;
  const usedPercent = typeof modelContextWindow === 'number' && modelContextWindow > 0
    ? Math.min(100, Math.max(0, (contextTokens / modelContextWindow) * 100))
    : null;
  return {
    totalTokens: tokenUsage.total.totalTokens,
    inputTokens: tokenUsage.total.inputTokens,
    cachedInputTokens: tokenUsage.total.cachedInputTokens,
    outputTokens: tokenUsage.total.outputTokens,
    reasoningOutputTokens: tokenUsage.total.reasoningOutputTokens,
    lastTotalTokens: tokenUsage.last.totalTokens,
    modelContextWindow,
    usedPercent,
  };
}

function surfaceThreadStatus(status: v2.ThreadStatus): CodexSurfaceThreadStatus {
  return status.type === 'active'
    ? { type: 'active', activeFlags: [...status.activeFlags] }
    : { type: status.type };
}

function conversationStatus(status: v2.ThreadStatus): CodexConversationSummary['status'] {
  if (status.type === 'active') return 'active';
  if (status.type === 'systemError') return 'error';
  return 'idle';
}

function surfaceRateLimits(response: v2.GetAccountRateLimitsResponse): CodexSurfaceRateLimits {
  const byLimitId = response.rateLimitsByLimitId
    ? Object.fromEntries(Object.entries(response.rateLimitsByLimitId)
      .filter((entry): entry is [string, v2.RateLimitSnapshot] => Boolean(entry[1]))
      .map(([limitId, snapshot]) => [limitId, surfaceRateLimitSnapshot(snapshot)]))
    : null;
  return {
    rateLimits: surfaceRateLimitSnapshot(response.rateLimits),
    rateLimitsByLimitId: byLimitId,
    rateLimitResetCredits: response.rateLimitResetCredits ? {
      availableCount: String(response.rateLimitResetCredits.availableCount),
      credits: response.rateLimitResetCredits.credits?.map((credit) => ({ ...credit })) ?? null,
    } : null,
  };
}

function surfaceRateLimitSnapshot(snapshot: v2.RateLimitSnapshot): CodexSurfaceRateLimitSnapshot {
  return {
    limitId: snapshot.limitId,
    limitName: snapshot.limitName,
    primary: snapshot.primary ? { ...snapshot.primary } : null,
    secondary: snapshot.secondary ? { ...snapshot.secondary } : null,
    credits: snapshot.credits ? { ...snapshot.credits } : null,
    individualLimit: snapshot.individualLimit ? { ...snapshot.individualLimit } : null,
    planType: snapshot.planType,
    rateLimitReachedType: snapshot.rateLimitReachedType,
  };
}

function mergeSurfaceRateLimits(
  current: CodexSurfaceRateLimits | null,
  update: v2.RateLimitSnapshot,
): CodexSurfaceRateLimits {
  const next = surfaceRateLimitSnapshot(update);
  if (!current) {
    return {
      rateLimits: next,
      rateLimitsByLimitId: next.limitId ? { [next.limitId]: next } : null,
      rateLimitResetCredits: null,
    };
  }
  const merged = mergeRateLimitSnapshot(current.rateLimits, next);
  const rateLimitsByLimitId = current.rateLimitsByLimitId ? { ...current.rateLimitsByLimitId } : {};
  if (merged.limitId) {
    rateLimitsByLimitId[merged.limitId] = mergeRateLimitSnapshot(
      rateLimitsByLimitId[merged.limitId] ?? merged,
      next,
    );
  }
  return {
    ...current,
    rateLimits: merged,
    rateLimitsByLimitId: Object.keys(rateLimitsByLimitId).length > 0 ? rateLimitsByLimitId : null,
  };
}

function mergeRateLimitSnapshot(
  current: CodexSurfaceRateLimitSnapshot,
  update: CodexSurfaceRateLimitSnapshot,
): CodexSurfaceRateLimitSnapshot {
  return {
    limitId: update.limitId ?? current.limitId,
    limitName: update.limitName ?? current.limitName,
    primary: update.primary ? { ...(current.primary ?? {}), ...update.primary } : current.primary,
    secondary: update.secondary ? { ...(current.secondary ?? {}), ...update.secondary } : current.secondary,
    credits: update.credits ? { ...(current.credits ?? {}), ...update.credits } : current.credits,
    individualLimit: update.individualLimit
      ? { ...(current.individualLimit ?? {}), ...update.individualLimit }
      : current.individualLimit,
    planType: update.planType ?? current.planType,
    rateLimitReachedType: update.rateLimitReachedType ?? current.rateLimitReachedType,
  };
}

function approvalPresetsForProfiles(
  profiles: CodexSurfaceSnapshot['permissionProfiles'],
  requirements: v2.ConfigRequirements | null,
): CodexSurfaceApprovalPreset[] {
  const allowed = new Set(profiles.filter((profile) => profile.allowed).map((profile) => profile.id));
  const presets: CodexSurfaceApprovalPreset[] = [];
  if (
    allowed.has(':workspace')
    && requirementAllows(requirements?.allowedApprovalPolicies, 'on-request')
    && requirementAllows(requirements?.allowedApprovalsReviewers, 'user')
  ) presets.push('ask-for-approval');
  if (
    allowed.has(':workspace')
    && requirementAllows(requirements?.allowedApprovalPolicies, 'on-request')
    && requirementAllows(requirements?.allowedApprovalsReviewers, 'auto_review')
  ) presets.push('approve-for-me');
  if (
    (allowed.has(':danger-full-access') || allowed.has(':danger-no-sandbox'))
    && requirementAllows(requirements?.allowedApprovalPolicies, 'never')
    && requirementAllows(requirements?.allowedApprovalsReviewers, 'user')
  ) presets.push('full-access');
  return presets;
}

function requirementAllows<T>(values: T[] | null | undefined, value: T): boolean {
  return !Array.isArray(values) || values.length === 0 || values.includes(value);
}

function approvalPresetStartParams(preset: CodexSurfaceApprovalPreset): {
  approvalPolicy: v2.AskForApproval;
  approvalsReviewer: v2.ApprovalsReviewer;
  permissions: string;
} {
  if (preset === 'full-access') {
    return {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      permissions: ':danger-full-access',
    };
  }
  return {
    approvalPolicy: 'on-request',
    approvalsReviewer: preset === 'approve-for-me' ? 'auto_review' : 'user',
    permissions: ':workspace',
  };
}

function approvalPresetUpdateParams(preset: CodexSurfaceApprovalPreset): {
  approvalPolicy: v2.AskForApproval;
  approvalsReviewer: v2.ApprovalsReviewer;
  permissions: string;
} {
  return approvalPresetStartParams(preset);
}

function approvalPresetFromSettings(
  approvalPolicy: v2.AskForApproval,
  approvalsReviewer: v2.ApprovalsReviewer,
  sandbox: v2.SandboxPolicy,
  activePermissionProfile: v2.ActivePermissionProfile | null,
): CodexSurfaceApprovalPreset | null {
  const profile = activePermissionProfile?.id;
  if (
    approvalPolicy === 'never'
    && (
      sandbox.type === 'dangerFullAccess'
      || profile === ':danger-full-access'
      || profile === ':danger-no-sandbox'
    )
  ) return 'full-access';
  if (
    approvalPolicy === 'on-request'
    && (approvalsReviewer === 'auto_review' || approvalsReviewer === 'guardian_subagent')
  ) return 'approve-for-me';
  if (approvalPolicy === 'on-request') return 'ask-for-approval';
  return null;
}

function sessionSelection(
  response: v2.ThreadResumeResponse | v2.ThreadStartResponse,
  models: CodexSurfaceModel[],
  current: CodexSurfaceSnapshot,
): SurfaceSelection {
  const model = selectedModel(models, response.model);
  return {
    approvalPreset: approvalPresetFromSettings(
      response.approvalPolicy,
      response.approvalsReviewer,
      response.sandbox,
      response.activePermissionProfile,
    ) ?? current.approvalPreset,
    planMode: current.planMode,
    selectedModelId: model?.id ?? current.selectedModelId,
    selectedReasoningEffort: response.reasoningEffort ?? (model ? defaultReasoningEffort(model) : null),
  };
}

function threadSettingsSelection(
  settings: v2.ThreadSettings,
  models: CodexSurfaceModel[],
  current: CodexSurfaceSnapshot,
): SurfaceSelection {
  const model = selectedModel(models, settings.model);
  return {
    approvalPreset: approvalPresetFromSettings(
      settings.approvalPolicy,
      settings.approvalsReviewer,
      settings.sandboxPolicy,
      settings.activePermissionProfile,
    ) ?? current.approvalPreset,
    planMode: settings.collaborationMode.mode === 'plan',
    selectedModelId: model?.id ?? current.selectedModelId,
    selectedReasoningEffort: settings.effort ?? (model ? defaultReasoningEffort(model) : null),
  };
}

function nextSelection(
  current: CodexSurfaceSnapshot,
  settings: UpdateCodexConversationSettings,
): SurfaceSelection {
  let model = selectedModel(current.models, current.selectedModelId);
  if (settings.modelId) {
    model = current.models.find((candidate) => candidate.id === settings.modelId) ?? null;
    if (!model) throw new Error(`Unknown model '${settings.modelId}'`);
  }

  let reasoningEffort = settings.reasoningEffort ?? current.selectedReasoningEffort;
  const supported = model?.supportedReasoningEfforts?.map((option) => option.reasoningEffort) ?? [];
  if (settings.reasoningEffort && supported.length > 0 && !supported.includes(settings.reasoningEffort)) {
    throw new Error(`Reasoning effort '${settings.reasoningEffort}' is not available for '${model?.displayName}'`);
  }
  if (settings.modelId && supported.length > 0 && (!reasoningEffort || !supported.includes(reasoningEffort))) {
    reasoningEffort = model ? defaultReasoningEffort(model) : null;
  }

  return {
    approvalPreset: settings.approvalPreset ?? current.approvalPreset,
    planMode: settings.planMode ?? current.planMode,
    selectedModelId: model?.id ?? null,
    selectedReasoningEffort: reasoningEffort,
  };
}

function collaborationMode(
  planMode: boolean,
  model: string,
  reasoningEffort: string | null,
): NonNullable<v2.TurnStartParams['collaborationMode']> {
  return {
    mode: planMode ? 'plan' : 'default',
    settings: {
      model,
      reasoning_effort: reasoningEffort,
      developer_instructions: null,
    },
  };
}

function turnSettings(
  state: CodexSurfaceSnapshot,
  options: SendCodexMessageOptions,
): Pick<v2.TurnStartParams, 'collaborationMode' | 'effort' | 'model'> {
  const selected = selectedModel(state.models, state.selectedModelId);
  const model = options.model ?? selected?.model;
  const effort = options.reasoningEffort ?? state.selectedReasoningEffort;
  const planMode = options.planMode ?? state.planMode;
  return {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(model ? { collaborationMode: collaborationMode(planMode, model, effort) } : {}),
  };
}

function activeTurnId(turns: v2.Turn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.status === 'inProgress') return turn.id;
  }
  return null;
}

function ensureAssistantTurnMessage(
  messages: readonly SurfaceMessage[],
  threadId: string,
  turnId: string,
  options: { createdAt?: string; forceSegment?: boolean } = {},
): SurfaceMessage[] {
  let next = [...messages];
  const lastTurnIndex = findLastIndex(next, (message) => message.metadata?.turnId === turnId);
  const lastTurnMessage = lastTurnIndex >= 0 ? next[lastTurnIndex] : undefined;
  if (
    lastTurnMessage?.role === 'assistant'
    && lastTurnMessage.kind === undefined
    && lastTurnMessage.status === 'streaming'
  ) {
    return next;
  }

  if (options.forceSegment) {
    const previousAssistantIndex = findLastIndex(next, (message) => (
      message.role === 'assistant'
      && message.kind === undefined
      && message.metadata?.turnId === turnId
    ));
    const previousAssistant = previousAssistantIndex >= 0 ? next[previousAssistantIndex] : undefined;
    if (previousAssistant?.parts.length === 0) {
      next.splice(previousAssistantIndex, 1);
    } else if (previousAssistant) {
      next.splice(previousAssistantIndex, 1, { ...previousAssistant, status: 'complete' });
    }
  } else {
    const existing = next.find((message) => (
      message.role === 'assistant'
      && message.kind === undefined
      && message.metadata?.turnId === turnId
      && message.status === 'streaming'
    ));
    if (existing) return next;
  }

  const segmentCount = next.filter((message) => (
    message.role === 'assistant'
    && message.kind === undefined
    && message.metadata?.turnId === turnId
  )).length;
  const id = segmentCount === 0 ? `assistant-${turnId}` : `assistant-${turnId}-segment-${segmentCount}`;
  next.push({
    id,
    role: 'assistant',
    status: 'streaming',
    turnId,
    parts: [],
    createdAt: options.createdAt ?? new Date().toISOString(),
    metadata: { conversationId: threadId, turnId },
  });
  return next;
}

function appendAssistantTextDelta(
  messages: readonly SurfaceMessage[],
  threadId: string,
  turnId: string,
  itemId: string,
  delta: string,
): SurfaceMessage[] {
  if (!delta) return [...messages];
  const next = ensureAssistantTurnMessage(messages, threadId, turnId);
  const messageIndex = findLastIndex(next, (message) => (
    message.role === 'assistant'
    && message.kind === undefined
    && message.metadata?.turnId === turnId
  ));
  const message = messageIndex >= 0 ? next[messageIndex] : undefined;
  if (!message) return next;
  const parts = [...message.parts];
  const lastPart = parts.at(-1);
  if (lastPart?.type === 'text' && lastPart.itemId === itemId) {
    parts.splice(parts.length - 1, 1, { ...lastPart, text: `${lastPart.text}${delta}` });
  } else {
    parts.push({ type: 'text', text: delta, itemId });
  }
  next.splice(messageIndex, 1, { ...message, status: 'streaming', parts });
  return pruneEmptyAssistantPlaceholders(next, threadId);
}

function upsertAssistantText(
  messages: readonly SurfaceMessage[],
  threadId: string,
  turnId: string,
  itemId: string,
  text: string,
): SurfaceMessage[] {
  const next = [...messages];
  for (let messageIndex = next.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = next[messageIndex];
    if (message?.role !== 'assistant' || message.metadata?.turnId !== turnId) continue;
    const partIndex = message.parts.findIndex((part) => part.type === 'text' && part.itemId === itemId);
    if (partIndex < 0) continue;
    const parts = [...message.parts];
    parts.splice(partIndex, 1, { type: 'text', text, itemId });
    next.splice(messageIndex, 1, { ...message, parts });
    return pruneEmptyAssistantPlaceholders(next, threadId);
  }

  const ensured = ensureAssistantTurnMessage(next, threadId, turnId);
  const messageIndex = findLastIndex(ensured, (message) => (
    message.role === 'assistant'
    && message.kind === undefined
    && message.metadata?.turnId === turnId
  ));
  const message = messageIndex >= 0 ? ensured[messageIndex] : undefined;
  if (!message) return ensured;
  ensured.splice(messageIndex, 1, {
    ...message,
    parts: [...message.parts, { type: 'text', text, itemId }],
  });
  return pruneEmptyAssistantPlaceholders(ensured, threadId);
}

function upsertAssistantToolPart(
  messages: readonly SurfaceMessage[],
  threadId: string,
  turnId: string,
  toolPart: SurfaceMessageToolPart,
): SurfaceMessage[] {
  let next = [...messages];
  let messageIndex = next.findIndex((message) => (
    message.role === 'assistant'
    && message.metadata?.turnId === turnId
    && message.parts.some((part) => part.type === 'tool' && part.id === toolPart.id)
  ));
  if (messageIndex < 0) {
    next = ensureAssistantTurnMessage(next, threadId, turnId);
    messageIndex = findLastIndex(next, (message) => (
      message.role === 'assistant'
      && message.kind === undefined
      && message.metadata?.turnId === turnId
    ));
  }
  const message = messageIndex >= 0 ? next[messageIndex] : undefined;
  if (!message) return next;
  const parts = [...message.parts];
  const partIndex = parts.findIndex((part) => part.type === 'tool' && part.id === toolPart.id);
  if (partIndex >= 0) {
    const existing = parts[partIndex] as SurfaceMessageToolPart;
    parts.splice(partIndex, 1, {
      ...existing,
      ...toolPart,
      body: toolPart.body ?? existing.body,
      input: toolPart.input ?? existing.input,
      output: toolPart.output ?? existing.output,
      statusText: toolPart.statusText ?? (toolPart.status === 'running' ? existing.statusText : undefined),
      metadata: { ...(existing.metadata ?? {}), ...(toolPart.metadata ?? {}) },
    });
  } else {
    parts.push(toolPart);
  }
  next.splice(messageIndex, 1, { ...message, status: 'streaming', parts });
  return pruneEmptyAssistantPlaceholders(next, threadId);
}

function upsertAssistantMediaPart(
  messages: readonly SurfaceMessage[],
  threadId: string,
  turnId: string,
  mediaPart: SurfaceMessageMediaPart,
): SurfaceMessage[] {
  let next = [...messages];
  let messageIndex = next.findIndex((message) => (
    message.role === 'assistant'
    && message.metadata?.turnId === turnId
    && message.parts.some((part) => part.type === 'media' && part.itemId === mediaPart.itemId)
  ));
  if (messageIndex < 0 && mediaPart.itemId) {
    messageIndex = next.findIndex((message) => (
      message.role === 'assistant'
      && message.metadata?.turnId === turnId
      && message.parts.some((part) => part.type === 'tool' && part.id === mediaPart.itemId)
    ));
  }
  if (messageIndex < 0) {
    next = ensureAssistantTurnMessage(next, threadId, turnId);
    messageIndex = findLastIndex(next, (message) => (
      message.role === 'assistant'
      && message.kind === undefined
      && message.metadata?.turnId === turnId
    ));
  }
  const message = messageIndex >= 0 ? next[messageIndex] : undefined;
  if (!message) return next;
  const parts = [...message.parts];
  const partIndex = parts.findIndex((part) => (
    part.type === 'media' && part.itemId === mediaPart.itemId
  ));
  if (partIndex >= 0) parts.splice(partIndex, 1, mediaPart);
  else parts.push(mediaPart);
  next.splice(messageIndex, 1, { ...message, status: 'streaming', parts });
  return pruneEmptyAssistantPlaceholders(next, threadId);
}

function surfaceMediaPartsEqual(
  left: SurfaceMessageMediaPart,
  right: SurfaceMessageMediaPart,
): boolean {
  return left.itemId === right.itemId
    && left.media.url === right.media.url
    && left.media.alt === right.media.alt
    && left.media.mimeType === right.media.mimeType
    && left.media.prompt === right.media.prompt
    && left.media.title === right.media.title;
}

function updateAssistantToolPart(
  messages: readonly SurfaceMessage[],
  threadId: string,
  turnId: string,
  update: SurfaceMessageToolPartUpdate,
): SurfaceMessage[] {
  const next = [...messages];
  const messageIndex = next.findIndex((message) => (
    message.role === 'assistant'
    && message.metadata?.turnId === turnId
    && message.parts.some((part) => part.type === 'tool' && part.id === update.itemId)
  ));
  if (messageIndex < 0) {
    if (!update.fallbackToolPart) return next;
    const inserted = upsertAssistantToolPart(next, threadId, turnId, update.fallbackToolPart);
    return updateAssistantToolPart(inserted, threadId, turnId, {
      ...update,
      fallbackToolPart: undefined,
    });
  }
  const message = next[messageIndex];
  if (!message) return next;
  const parts = [...message.parts];
  const partIndex = parts.findIndex((part) => part.type === 'tool' && part.id === update.itemId);
  const existing = parts[partIndex] as SurfaceMessageToolPart | undefined;
  if (!existing) return next;
  parts.splice(partIndex, 1, {
    ...existing,
    ...(update.title !== undefined ? { title: update.title } : {}),
    ...(update.status !== undefined ? { status: update.status } : {}),
    ...(update.statusText !== undefined ? { statusText: update.statusText ?? undefined } : {}),
    ...(update.body !== undefined ? { body: update.body } : {}),
    ...(update.bodyDelta !== undefined ? { body: `${existing.body ?? ''}${update.bodyDelta}` } : {}),
    ...(update.bodyAppend !== undefined
      ? { body: [existing.body, update.bodyAppend].filter(Boolean).join('\n') }
      : {}),
    ...(update.input !== undefined ? { input: update.input } : {}),
    ...(update.output !== undefined ? { output: update.output } : {}),
    ...(update.metadata !== undefined
      ? { metadata: { ...(existing.metadata ?? {}), ...update.metadata } }
      : {}),
  });
  next.splice(messageIndex, 1, { ...message, parts });
  return next;
}

function appendCompactionMarker(
  messages: readonly SurfaceMessage[],
  threadId: string,
  turnId: string,
): SurfaceMessage[] {
  if (messages.some((message) => message.kind === 'compaction' && message.metadata?.turnId === turnId)) {
    return [...messages];
  }
  const next = [...messages];
  const activeAssistantIndex = findLastIndex(next, (message) => (
    message.role === 'assistant'
    && message.kind === undefined
    && message.metadata?.turnId === turnId
  ));
  const activeAssistant = activeAssistantIndex >= 0 ? next[activeAssistantIndex] : undefined;
  if (activeAssistant?.parts.length === 0) {
    next.splice(activeAssistantIndex, 1);
  } else if (activeAssistant) {
    next.splice(activeAssistantIndex, 1, { ...activeAssistant, status: 'complete' });
  }
  next.push({
    id: `compaction-${turnId}`,
    kind: 'compaction',
    role: 'assistant',
    status: 'streaming',
    turnId,
    parts: [],
    createdAt: new Date().toISOString(),
    metadata: { conversationId: threadId, turnId },
  });
  return pruneEmptyAssistantPlaceholders(next, threadId);
}

function finalizeTurnToolParts(
  messages: SurfaceMessage[],
  turnId: string,
  turnStatus: v2.TurnStatus,
): SurfaceMessage[] {
  const toolStatus: SurfaceMessageToolPart['status'] = turnStatus === 'completed' ? 'completed' : 'failed';
  const phase = turnStatus === 'completed' ? 'completed' : 'failed';
  return messages.map((message) => {
    if (message.metadata?.turnId !== turnId) return message;
    let changed = false;
    const parts = message.parts.map((part) => {
      if (part.type !== 'tool' || part.status !== 'running') return part;
      changed = true;
      return {
        ...part,
        status: toolStatus,
        statusText: finalizedToolStatusText(part.statusText, phase),
      };
    });
    return changed ? { ...message, parts } : message;
  });
}

function finalizedToolStatusText(statusText: string | undefined, phase: 'completed' | 'failed'): string | undefined {
  if (!statusText) return statusText;
  try {
    const parsed: unknown = JSON.parse(statusText);
    if (!isRecord(parsed)) return statusText;
    return JSON.stringify({ ...parsed, phase });
  } catch {
    return statusText;
  }
}

function pruneEmptyAssistantPlaceholders(messages: SurfaceMessage[], threadId: string): SurfaceMessage[] {
  const relevantIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.metadata?.conversationId === threadId);
  const lastIndex = relevantIndexes.at(-1)?.index ?? -1;
  return messages.filter((message, index) => (
    message.metadata?.conversationId !== threadId
    || index === lastIndex
    || message.role !== 'assistant'
    || message.kind !== undefined
    || message.parts.length > 0
  ));
}

function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined && predicate(value)) return index;
  }
  return -1;
}

function addUnique<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? [...values] : [...values, value];
}

function threadItemKey(threadId: string, itemId: string): string {
  return `${threadId}\u0000${itemId}`;
}

function timestampToIso(timestamp: number | null | undefined): string {
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000).toISOString()
    : new Date().toISOString();
}

function timestampToIsoOrNull(timestamp: number | null | undefined): string | null {
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000).toISOString()
    : null;
}

function surfaceTurnError(error: v2.TurnError | null): CodexSurfaceTurnError | null {
  if (!error) return null;
  return {
    message: error.message,
    additionalDetails: error.additionalDetails,
    codexErrorInfo: error.codexErrorInfo as CodexSurfaceJsonValue | null,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createMessageId(): string {
  return `user-${globalThis.crypto.randomUUID()}`;
}

function createQueuedPromptId(): string {
  return `queued-prompt-${globalThis.crypto.randomUUID()}`;
}

function messageAt(messages: readonly SurfaceMessage[], index: number): SurfaceMessage {
  const message = Number.isInteger(index) ? messages[index] : undefined;
  if (!message) throw new Error(`Unknown message index '${index}'`);
  return message;
}

function messageTurnIdOrNull(message: SurfaceMessage): string | null {
  const metadataTurnId = message.metadata?.turnId;
  return message.turnId ?? (typeof metadataTurnId === 'string' ? metadataTurnId : null);
}

function messageTurnId(message: SurfaceMessage): string {
  const turnId = messageTurnIdOrNull(message);
  if (!turnId) throw new Error('This message is not associated with a Codex turn');
  return turnId;
}

function surfaceMessageText(message: SurfaceMessage): string {
  return message.parts
    .filter((part): part is Extract<SurfaceMessage['parts'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function surfaceMessageAttachments(message: SurfaceMessage): CodexSurfaceAttachment[] {
  return message.parts.flatMap((part): CodexSurfaceAttachment[] => {
    if (part.type !== 'attachment') return [];
    const attachment = part.attachment;
    const attachmentPath = attachment.path;
    if (!attachmentPath) return [];
    if (attachment.kind === 'image') {
      return [{
        type: 'image',
        path: attachmentPath,
        name: attachment.name,
        ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
        ...(attachment.url?.startsWith('data:image/') ? { previewUrl: attachment.url } : {}),
      }];
    }
    return [{
      type: 'file',
      path: attachmentPath,
      name: attachment.name,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    }];
  });
}

function formatPlanMarkdown(
  explanation: string | null,
  plan: readonly { step: string; status: string }[],
): string {
  return [
    explanation?.trim() ?? '',
    ...plan.map((entry) => `${entry.status === 'completed' ? '- [x]' : '- [ ]'} ${entry.step}`),
  ].filter(Boolean).join('\n');
}

function planProgressToolPart(
  turnId: string,
  markdown: string,
  status: SurfaceMessageToolPart['status'],
): SurfaceMessageToolPart {
  return {
    type: 'tool',
    id: `plan-progress-${turnId}`,
    kind: 'generic',
    title: 'plan',
    status,
    body: markdown,
    statusText: JSON.stringify({
      source: 'codex',
      action: 'plan',
      phase: status,
      params: {
        addedLines: markdown.split('\n').filter((line) => line.trim()).length,
        operation: 'write',
        target: 'plan',
      },
    }),
    metadata: { planProgress: true },
  };
}

function mcpElicitationResponse(
  decision: 'allow' | 'allow_conversation' | 'always_allow' | 'deny',
): v2.McpServerElicitationRequestResponse {
  switch (decision) {
    case 'allow':
      return { action: 'accept', content: null, _meta: null };
    case 'allow_conversation':
      return { action: 'accept', content: null, _meta: { persist: 'session' } };
    case 'always_allow':
      return { action: 'accept', content: null, _meta: { persist: 'always' } };
    case 'deny':
      return { action: 'decline', content: null, _meta: null };
  }
}

function parsePlanSlashCommand(prompt: string): { prompt: string | null } | null {
  const match = /^\/plan(?:\s+(.*))?$/s.exec(prompt.trim());
  if (!match) return null;
  const planPrompt = match[1]?.trim() ?? '';
  return { prompt: planPrompt || null };
}

type GoalSlashCommand =
  | { action: 'clear' }
  | { action: 'edit' }
  | { action: 'set'; objective: string }
  | { action: 'show' }
  | { action: 'unsupported' };

function parseGoalSlashCommand(prompt: string): GoalSlashCommand | null {
  const match = /^\/goal(?:\s+(.*))?$/s.exec(prompt.trim());
  if (!match) return null;
  const rest = match[1]?.trim() ?? '';
  if (!rest) return { action: 'show' };
  if (rest.toLowerCase() === 'clear') return { action: 'clear' };
  if (rest.toLowerCase() === 'edit') return { action: 'edit' };
  if (rest.toLowerCase() === 'pause' || rest.toLowerCase() === 'resume') return { action: 'unsupported' };
  return { action: 'set', objective: rest };
}

function parseReviewSlashCommand(prompt: string): CodexSurfaceReviewTarget | null {
  const match = /^\/review(?:\s+(.*))?$/s.exec(prompt.trim());
  if (!match) return null;
  const instructions = match[1]?.trim() ?? '';
  return instructions ? { type: 'custom', instructions } : { type: 'uncommittedChanges' };
}

function normalizeReviewTarget(target: CodexSurfaceReviewTarget): v2.ReviewTarget {
  if (target.type === 'commit') return { ...target, title: target.title ?? null };
  return { ...target };
}

function promptSkillInputsFromText(
  text: string,
  skills: readonly CodexSurfaceSkill[],
): CodexSurfaceSkillInput[] {
  const names = new Set<string>();
  const pattern = /(?:^|[^\w.%+-])[$/]([A-Za-z0-9_.-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1];
    if (name) names.add(name);
  }
  return skills
    .filter((skill) => skill.enabled && names.has(skill.name) && Boolean(skill.path))
    .map((skill) => ({ name: skill.name, path: skill.path }));
}

function validateSkillInputs(
  inputs: readonly CodexSurfaceSkillInput[],
  catalog: readonly CodexSurfaceSkill[],
): CodexSurfaceSkillInput[] {
  return inputs.map((input) => {
    const match = catalog.find((skill) => (
      skill.enabled
      && skill.name === input.name
      && skill.path === input.path
    ));
    if (!match) {
      throw new Error(`Skill '${input.name}' is not an enabled skill in the Codex catalog`);
    }
    return { name: match.name, path: match.path };
  });
}

function mergeSkillInputs(
  ...groups: readonly (readonly CodexSurfaceSkillInput[])[]
): CodexSurfaceSkillInput[] {
  const seen = new Set<string>();
  return groups.flatMap((group) => group.filter((skill) => {
    const key = `${skill.name}\u0000${skill.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function findPendingMcpToolPart(
  messages: readonly SurfaceMessage[],
  turnId: string,
  server: string,
  tool: string,
): SurfaceMessageToolPart | null {
  const running = messages
    .filter((message) => message.metadata?.turnId === turnId)
    .flatMap((message) => message.parts)
    .filter((part): part is SurfaceMessageToolPart => (
      part.type === 'tool' && part.kind === 'mcp' && part.status === 'running'
    ));
  const exact = running.find((part) => {
    const metadataServer = stringValue(part.metadata?.server);
    const metadataTool = stringValue(part.metadata?.tool);
    return (
      (metadataServer === server && metadataTool === tool)
      || part.title === `${server}.${tool}`
      || part.title.endsWith(`.${tool}`)
    );
  });
  return exact ?? (running.length === 1 ? running[0] ?? null : null);
}

function argumentsPreview(meta: Record<string, unknown>): string {
  if (Array.isArray(meta.tool_params_display)) {
    const lines = meta.tool_params_display.map((entry) => {
      if (!isRecord(entry) || typeof entry.name !== 'string') return '';
      const label = stringValue(entry.display_name) ?? entry.name;
      const value = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
      return `${label}: ${value}`;
    }).filter(Boolean);
    if (lines.length > 0) return lines.join('\n');
  }
  return meta.tool_params === undefined ? '' : JSON.stringify(meta.tool_params, null, 2);
}

function persistSupports(value: unknown, mode: 'always' | 'session'): boolean {
  return value === mode || (Array.isArray(value) && value.includes(mode));
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizedConversationId(value: string): string {
  const conversationId = value.trim();
  if (!conversationId) throw new Error('Conversation id cannot be empty');
  return conversationId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
