import {
  CodexAppServerClient,
  type v2,
} from '../codex/index';
import type {
  CodexConversationSummary,
  CodexConversationEvent,
  CodexConversationHistory,
  CodexConversationSnapshot,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceChatGptLogin,
  CodexSurfaceClientRequestResponse,
  CodexSurfaceEvent,
  CodexSurfaceEventOrigin,
  CodexSurfaceModel,
  CodexSurfaceSnapshot,
  CodexSurfaceSkill,
  CreateCodexConversationOptions,
  ListCodexConversationsOptions,
  ListCodexModelsOptions,
  SendCodexMessageOptions,
  StartCodexRealtimeOptions,
  StartCodexReviewOptions,
  SurfaceMessage,
  UpdateCodexConversationSettings,
} from '../surface/types';
import {
  CodexAppServerStdioTransport,
} from './codex-stdio-transport';
import {
  CodexAppServerUnixSocketTransport,
} from './codex-unix-socket-transport';
import {
  errorMessage,
  normalizedConversationId,
} from './codex-surface-prompts';
import { startCodexRealtimeSession } from './codex-surface-realtime-session';
import type {
  CodexConversation,
  CodexConversationHostOptions,
  CodexConversationLoadOptions,
  CodexRealtimeSession,
  CodexSurfaceConfigRequirements,
  CodexSurfaceOptions,
  CodexSurfaceRemoteControlClientPage,
  CodexSurfaceRemoteControlPairing,
  CodexSurfaceRemoteControlPairingStatus,
  CodexSurfaceRemoteControlStatus,
  ListCodexSkillsOptions,
} from './codex-surface-contracts';
import {
  initialSurfaceSnapshot,
  type ThreadRuntimePatch,
  type ThreadRuntimeState,
} from './codex-surface-runtime';
import {
  initialAuthentication,
} from './codex-surface-authentication';
import {
  isUnixSocketTransportOptions,
  surfaceTransportOptions,
} from './codex-surface-transport-options';
import { CodexSurfaceAuthenticationController } from './codex-surface-authentication-controller';
import { createCodexConversationHandle } from './codex-conversation-handle';
import { CodexSurfaceItemsController } from './codex-surface-items-controller';
import { CodexSurfaceClientRequestsController } from './codex-surface-client-requests-controller';
import { CodexSurfaceCatalogController } from './codex-surface-catalog-controller';
import { CodexSurfaceApprovalsController } from './codex-surface-approvals-controller';
import { CodexSurfaceExtensionsController } from './codex-surface-extensions-controller';
import { CodexSurfaceConversationsController } from './codex-surface-conversations-controller';
import { CodexSurfaceConversationSettingsController } from './codex-surface-conversation-settings-controller';
import { CodexSurfaceTurnActionsController } from './codex-surface-turn-actions-controller';
import { CodexSurfaceMessagesController } from './codex-surface-messages-controller';
import { CodexSurfaceLifecycleController } from './codex-surface-lifecycle-controller';
import { CodexSurfaceNotificationsController } from './codex-surface-notifications-controller';
import { CodexSurfaceRuntimeController } from './codex-surface-runtime-controller';
import { CodexSurfaceConnectionController } from './codex-surface-connection-controller';

export type {
  CodexAppServerTransportOptions,
  CodexConversation,
  CodexConversationDefaults,
  CodexConversationHostOptions,
  CodexConversationLoadOptions,
  CodexDynamicTool,
  CodexDynamicToolCall,
  CodexDynamicToolContent,
  CodexDynamicToolResult,
  CodexRealtimeSession,
  CodexSurfaceConfigRequirements,
  CodexSurfaceExtension,
  CodexSurfaceOptions,
  CodexSurfaceRemoteControlClient,
  CodexSurfaceRemoteControlClientPage,
  CodexSurfaceRemoteControlPairing,
  CodexSurfaceRemoteControlPairingStatus,
  CodexSurfaceRemoteControlStatus,
  CodexThreadStartExtension,
  ListCodexSkillsOptions,
} from './codex-surface-contracts';

export type {
  CodexMcpServerDefinition,
  CodexMcpServerTransport,
  CodexMcpServerToolApprovalMode,
} from './codex-surface-mcp';

type StateListener = (snapshot: CodexSurfaceSnapshot) => void;
type ConversationStateListener = (snapshot: CodexConversationSnapshot) => void;
type SurfaceEventListener = (event: CodexSurfaceEvent) => void;
type ConversationEventListener = (event: CodexConversationEvent) => void;
type SurfaceEventInput = CodexSurfaceEvent extends infer Event
  ? Event extends CodexSurfaceEvent
    ? Omit<Event, 'seq' | 'occurredAt' | 'origin'>
    : never
  : never;

export class CodexSurface {
  private readonly client: CodexAppServerClient;
  private readonly listeners = new Set<StateListener>();
  private readonly eventListeners = new Set<SurfaceEventListener>();
  private readonly conversationListeners = new Map<string, Set<ConversationStateListener>>();
  private readonly conversationHandles = new Map<string, CodexConversation>();
  private readonly extensions: CodexSurfaceExtensionsController;
  private readonly authentication: CodexSurfaceAuthenticationController;
  private readonly items: CodexSurfaceItemsController;
  private readonly clientRequests: CodexSurfaceClientRequestsController;
  private readonly catalog: CodexSurfaceCatalogController;
  private readonly approvals: CodexSurfaceApprovalsController;
  private readonly conversations: CodexSurfaceConversationsController;
  private readonly conversationSettings: CodexSurfaceConversationSettingsController;
  private readonly turnActions: CodexSurfaceTurnActionsController;
  private readonly messagesController: CodexSurfaceMessagesController;
  private readonly lifecycle: CodexSurfaceLifecycleController;
  private readonly notifications: CodexSurfaceNotificationsController;
  private readonly runtimeState: CodexSurfaceRuntimeController;
  private readonly connection: CodexSurfaceConnectionController;
  private readonly unsubscribeDisconnect: () => void;
  private readonly unsubscribeNotification: () => void;
  private readonly unsubscribeToolInputRequests: () => void;
  private readonly unsubscribeMcpElicitationRequests: () => void;
  private readonly unsubscribeServerRequestPolicies: () => void;
  private eventSequence = 0;
  private closed = false;
  private state: CodexSurfaceSnapshot = initialSurfaceSnapshot(initialAuthentication());

  constructor(private readonly options: CodexSurfaceOptions = {}) {
    this.extensions = new CodexSurfaceExtensionsController(
      options.extensions ?? [],
      options.mcpServers ?? [],
      (threadId) => this.lifecycle.hostOptions(threadId),
    );
    const transportOptions = surfaceTransportOptions(options);
    this.client = options.client ?? new CodexAppServerClient(
      isUnixSocketTransportOptions(transportOptions)
        ? new CodexAppServerUnixSocketTransport(transportOptions)
        : new CodexAppServerStdioTransport(transportOptions),
    );
    this.authentication = new CodexSurfaceAuthenticationController(this.client, {
      bootstrapSurfaceData: (force) => this.connection.bootstrapSurfaceData(force),
      clearAuthenticatedSurfaceData: () => this.connection.clearAuthenticatedSurfaceData(),
      getSnapshot: () => this.getSnapshot(),
      patchAuthentication: (patch, origin) => this.connection.patchAuthentication(patch, origin),
      reportError: (error) => this.patch({ error: errorMessage(error) }),
    });
    this.items = new CodexSurfaceItemsController({
      assistantMessageForTurn: (threadId, turnId) => this.assistantMessageForTurn(threadId, turnId),
      emitConversationActivity: (threadId, origin) => this.emitConversationActivity(threadId, origin),
      emitEvent: (origin, input) => this.emitEvent(origin, input),
      emitSummaryUpserted: (summary, reason, origin) => this.emitSummaryUpserted(summary, reason, origin),
      getState: () => this.state,
      markRuntimeTurnActive: (runtime, turnId) => this.markRuntimeTurnActive(runtime, turnId),
      messageContainingTool: (threadId, turnId, itemId) => (
        this.messageContainingTool(threadId, turnId, itemId)
      ),
      patch: (patch) => this.patch(patch),
      patchRuntime: (threadId, patch) => this.patchRuntime(threadId, patch),
      requireRuntime: (threadId) => this.requireRuntime(threadId),
      sendNextQueuedPrompt: (threadId) => { void this.messagesController.sendNextQueuedPrompt(threadId); },
    });
    this.approvals = new CodexSurfaceApprovalsController(this.client, {
      activeConversationId: () => this.state.activeConversationId,
      createRuntime: (threadId, patch) => this.createRuntime(threadId, patch),
      emitConversationActivity: (threadId, origin) => this.emitConversationActivity(threadId, origin),
      emitEvent: (origin, input) => this.emitEvent(origin, input),
      markRuntimeTurnActive: (runtime, turnId) => this.markRuntimeTurnActive(runtime, turnId),
      maybeClearWaitingBusy: (threadId) => this.clientRequests.maybeClearWaitingBusy(threadId),
      patch: (patch) => this.patch(patch),
      patchConversationStatus: (threadId, status) => this.patchConversationStatus(threadId, status),
      patchRuntime: (threadId, patch) => this.patchRuntime(threadId, patch),
      requireRuntime: (threadId) => this.requireRuntime(threadId),
    });
    this.clientRequests = new CodexSurfaceClientRequestsController({
      emitConversationActivity: (threadId, origin) => this.emitConversationActivity(threadId, origin),
      emitEvent: (origin, input) => this.emitEvent(origin, input),
      hasPendingApproval: (threadId) => this.approvals.hasForThread(threadId),
      markRuntimeTurnActive: (runtime, turnId) => this.markRuntimeTurnActive(runtime, turnId),
      messageContainingTool: (threadId, turnId, itemId) => (
        this.messageContainingTool(threadId, turnId, itemId)
      ),
      patchRuntime: (threadId, patch) => this.patchRuntime(threadId, patch),
      requireRuntime: (threadId) => this.requireRuntime(threadId),
    });
    this.runtimeState = new CodexSurfaceRuntimeController(
      this.approvals,
      this.clientRequests,
      {
        emitEvent: (origin, input) => this.emitEvent(origin, input),
        getState: () => this.state,
        notifyConversationListeners: (threadId) => this.notifyConversationListeners(threadId),
        patch: (patch) => this.patch(patch),
        schedulePluginRefresh: () => this.catalog.schedulePluginRefresh(),
      },
    );
    this.conversationSettings = new CodexSurfaceConversationSettingsController(
      this.client,
      {
        approvalMode: options.approvalMode,
        approvalPreset: options.approvalPreset,
        permissionMode: options.permissionMode,
      },
      {
        createConversation: async () => { await this.createConversation(); },
        emitConversationSettings: (threadId, origin) => this.emitConversationSettings(threadId, origin),
        emitEvent: (origin, input) => this.emitEvent(origin, input),
        emitSummaryUpserted: (summary, reason, origin) => this.emitSummaryUpserted(summary, reason, origin),
        ensureConnected: () => this.ensureConnected(),
        ensureThreadReady: (threadId) => this.ensureThreadReady(threadId),
        getSnapshot: () => this.getSnapshot(),
        getState: () => this.state,
        patch: (patch) => this.patch(patch),
        patchRuntime: (threadId, patch) => this.patchRuntime(threadId, patch),
        snapshotForRuntime: (runtime) => this.snapshotForRuntime(runtime),
      },
    );
    this.turnActions = new CodexSurfaceTurnActionsController(this.client, {
      createConversation: async () => { await this.createConversation(); },
      emitConversationActivity: (threadId, origin) => this.emitConversationActivity(threadId, origin),
      emitEvent: (origin, input) => this.emitEvent(origin, input),
      emitHistoryReplaced: (threadId, reason, origin) => this.emitHistoryReplaced(threadId, reason, origin),
      emitSummaryUpserted: (summary, reason, origin) => this.emitSummaryUpserted(summary, reason, origin),
      ensureConnected: () => this.ensureConnected(),
      ensureThreadReady: (threadId) => this.ensureThreadReady(threadId),
      getSnapshot: () => this.getSnapshot(),
      getState: () => this.state,
      hydrateCompleteHistory: (threadId, options) => this.conversations.hydrateCompleteHistory(threadId, options),
      patch: (patch) => this.patch(patch),
      patchConversationStatus: (threadId, status, origin) => this.patchConversationStatus(threadId, status, origin),
      patchConversationTurnCount: (threadId, count, origin) => this.patchConversationTurnCount(threadId, count, origin),
      patchRuntime: (threadId, patch) => this.patchRuntime(threadId, patch),
      sendMessageToThread: (threadId, prompt, options) => this.messagesController.sendToThread(threadId, prompt, options),
    });
    this.messagesController = new CodexSurfaceMessagesController(this.client, {
      clearGoalForThread: (threadId) => this.conversationSettings.clearGoalForThread(threadId),
      compactForThread: (threadId) => this.turnActions.compactForThread(threadId),
      createConversation: async () => { await this.createConversation(); },
      emitConversationActivity: (threadId, origin) => this.emitConversationActivity(threadId, origin),
      emitEvent: (origin, input) => this.emitEvent(origin, input),
      ensureConnected: () => this.ensureConnected(),
      ensureThreadReady: (threadId) => this.ensureThreadReady(threadId),
      getSnapshot: () => this.getSnapshot(),
      getState: () => this.state,
      patchConversationStatus: (threadId, status, origin) => this.patchConversationStatus(threadId, status, origin),
      patchConversationTurnCount: (threadId, count, origin) => this.patchConversationTurnCount(threadId, count, origin),
      patchRuntime: (threadId, patch) => this.patchRuntime(threadId, patch),
      requireRuntime: (threadId) => this.requireRuntime(threadId),
      setGoal: (objective) => this.conversationSettings.setGoal(objective),
      setGoalForThread: (threadId, objective) => this.conversationSettings.setGoalForThread(threadId, objective),
      snapshotForRuntime: (runtime) => this.snapshotForRuntime(runtime),
      startReview: (options) => this.turnActions.startReview(options),
      startReviewForThread: (threadId, options) => this.turnActions.startReviewForThread(threadId, options),
      updateSettings: (settings) => this.conversationSettings.update(settings),
      updateSettingsForThread: (threadId, settings) => this.conversationSettings.updateForThread(threadId, settings),
    });
    this.catalog = new CodexSurfaceCatalogController(this.client, options.cwd, {
      authenticationBlocksBootstrap: () => this.authentication.blocksBootstrap(),
      emitConversationPermissions: (threadId, origin) => this.emitConversationPermissions(threadId, origin),
      emitConversationSkills: (threadId, origin) => this.emitConversationSkills(threadId, origin),
      emitEvent: (origin, input) => this.emitEvent(origin, input),
      ensureConnected: () => this.ensureConnected(),
      getState: () => this.state,
      isClosed: () => this.closed,
      patch: (patch) => this.patch(patch),
      patchRuntime: (threadId, patch) => this.patchRuntime(threadId, patch),
      preferredApprovalPreset: () => this.conversationSettings.preferredApprovalPreset(),
      runtimes: () => this.runtimeState.values(),
    });
    this.conversations = new CodexSurfaceConversationsController(
      this.client,
      options.conversationLimit,
      {
        emitHistoryReplaced: (threadId, reason, origin) => this.emitHistoryReplaced(threadId, reason, origin),
        emitSummaryUpserted: (summary, reason, origin) => this.emitSummaryUpserted(summary, reason, origin),
        ensureConnected: () => this.ensureConnected(),
        getSnapshot: () => this.getSnapshot(),
        getState: () => this.state,
        patch: (patch) => this.patch(patch),
        patchRuntime: (threadId, patch) => this.patchRuntime(threadId, patch),
        removeThread: (threadId, reason, origin) => this.removeThread(threadId, reason, origin),
        requireRuntime: (threadId) => this.requireRuntime(threadId),
        runtime: (threadId) => this.runtimeState.get(threadId),
        schedulePluginRefresh: (force) => this.catalog.schedulePluginRefresh(force),
      },
    );
    this.lifecycle = new CodexSurfaceLifecycleController(
      this.client,
      options,
      this.catalog,
      this.extensions,
      this.conversationSettings,
      this.conversations,
      {
        activateRuntime: (runtime) => this.activateRuntime(runtime),
        createRuntime: (threadId, patch) => this.createRuntime(threadId, patch),
        emitConversationActivity: (threadId, origin) => this.emitConversationActivity(threadId, origin),
        emitConversationPermissions: (threadId, origin) => this.emitConversationPermissions(threadId, origin),
        emitConversationSettings: (threadId, origin) => this.emitConversationSettings(threadId, origin),
        emitConversationSkills: (threadId, origin) => this.emitConversationSkills(threadId, origin),
        emitHistoryReplaced: (threadId, reason, origin) => this.emitHistoryReplaced(threadId, reason, origin),
        emitSelected: (conversationId) => this.emitEvent('action', {
          type: 'conversation.selected',
          payload: { conversationId },
        }),
        emitSummaryUpserted: (summary, reason, origin) => this.emitSummaryUpserted(summary, reason, origin),
        ensureConnected: () => this.ensureConnected(),
        getSnapshot: () => this.getSnapshot(),
        getState: () => this.state,
        patch: (patch) => this.patch(patch),
        patchRuntime: (threadId, patch) => this.patchRuntime(threadId, patch),
        requireRuntime: (threadId) => this.requireRuntime(threadId),
        runtime: (threadId) => this.runtimeState.get(threadId),
        runtimeProjection: (runtime) => this.runtimeProjection(runtime),
        snapshotForRuntime: (runtime) => this.snapshotForRuntime(runtime),
      },
    );
    this.connection = new CodexSurfaceConnectionController(
      this.client,
      options,
      this.authentication,
      this.approvals,
      this.catalog,
      this.clientRequests,
      this.conversations,
      this.items,
      this.lifecycle,
      this.runtimeState,
      {
        clearConversationHandles: () => this.conversationHandles.clear(),
        clearPendingForThread: (threadId, reason, eventReason) => (
          this.clearPendingForThread(threadId, reason, eventReason)
        ),
        closed: () => this.closed,
        emitAuthenticationChanged: (authentication, origin) => this.emitEvent(origin, {
          type: 'authentication.changed',
          payload: { authentication: structuredClone(authentication) },
        }),
        emitSurfaceStatus: (origin) => this.emitSurfaceStatus(origin),
        getSnapshot: () => this.getSnapshot(),
        getState: () => this.state,
        patch: (patch) => this.patch(patch),
      },
    );
    this.notifications = new CodexSurfaceNotificationsController(
      this.authentication,
      this.approvals,
      this.catalog,
      this.clientRequests,
      this.conversations,
      this.items,
      {
        clearPendingForThread: (threadId, reason, eventReason) => (
          this.clearPendingForThread(threadId, reason, eventReason)
        ),
        createRuntime: (threadId, patch) => this.createRuntime(threadId, patch),
        emitConversationActivity: (threadId, origin) => this.emitConversationActivity(threadId, origin),
        emitConversationPermissions: (threadId, origin) => this.emitConversationPermissions(threadId, origin),
        emitConversationSettings: (threadId, origin) => this.emitConversationSettings(threadId, origin),
        emitConversationSkills: (threadId, origin) => this.emitConversationSkills(threadId, origin),
        emitEvent: (origin, input) => this.emitEvent(origin, input),
        emitSummaryUpserted: (summary, reason, origin) => this.emitSummaryUpserted(summary, reason, origin),
        getState: () => this.state,
        markRuntimeTurnActive: (runtime, turnId) => this.markRuntimeTurnActive(runtime, turnId),
        patch: (patch) => this.patch(patch),
        patchConversationStatus: (threadId, status, origin) => this.patchConversationStatus(threadId, status, origin),
        patchConversationTurnCount: (threadId, count) => this.patchConversationTurnCount(threadId, count),
        patchRuntime: (threadId, patch) => this.patchRuntime(threadId, patch),
        removeThread: (threadId, reason) => this.removeThread(threadId, reason),
        requireRuntime: (threadId) => this.requireRuntime(threadId),
        runtime: (threadId) => this.runtimeState.get(threadId),
        runtimes: () => this.runtimeState.values(),
        snapshotForRuntime: (runtime) => this.snapshotForRuntime(runtime),
        unknownNotification: (notification) => this.handleUnknownNotification(notification),
      },
    );
    this.unsubscribeNotification = this.client.onNotification((notification) => this.notifications.handle(notification));
    this.unsubscribeDisconnect = this.client.onDisconnect((error) => this.connection.handleDisconnect(error));
    this.unsubscribeToolInputRequests = this.client.onServerRequest(
      'item/tool/requestUserInput',
      (request, responder) => this.clientRequests.handleToolInputRequest(request, responder),
    );
    this.unsubscribeMcpElicitationRequests = this.client.onServerRequest(
      'mcpServer/elicitation/request',
      (request, responder) => this.clientRequests.handleMcpElicitationRequest(request, responder),
    );
    const policyUnsubscribers = [
      this.client.onServerRequest('item/tool/call', async (request, responder) => {
        await this.extensions.handleDynamicToolCall(request, responder);
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
    return this.connection.connect();
  }

  async refreshAccount(): Promise<CodexSurfaceSnapshot> {
    return this.connection.refreshAccount();
  }

  async startChatGptLogin(): Promise<CodexSurfaceChatGptLogin> {
    return this.connection.startChatGptLogin();
  }

  /** Reads the app-server's current remote-control connection state. */
  async readRemoteControlStatus(): Promise<CodexSurfaceRemoteControlStatus> {
    return this.connection.readRemoteControlStatus();
  }

  /** Enables the app-server's official remote-control connection. */
  async enableRemoteControl(
    options: v2.RemoteControlEnableParams = {},
  ): Promise<CodexSurfaceRemoteControlStatus> {
    return this.connection.enableRemoteControl(options);
  }

  /** Disables the app-server's official remote-control connection. */
  async disableRemoteControl(
    options: v2.RemoteControlDisableParams = {},
  ): Promise<CodexSurfaceRemoteControlStatus> {
    return this.connection.disableRemoteControl(options);
  }

  /** Starts a one-time remote-control pairing flow. Treat the returned code as opaque. */
  async startRemoteControlPairing(
    options: v2.RemoteControlPairingStartParams = {},
  ): Promise<CodexSurfaceRemoteControlPairing> {
    return this.connection.startRemoteControlPairing(options);
  }

  /** Checks whether a remote-control pairing code has been claimed. */
  async readRemoteControlPairingStatus(
    options: v2.RemoteControlPairingStatusParams = {},
  ): Promise<CodexSurfaceRemoteControlPairingStatus> {
    return this.connection.readRemoteControlPairingStatus(options);
  }

  /** Lists devices paired with a remote-control environment. */
  async listRemoteControlClients(
    options: v2.RemoteControlClientsListParams,
  ): Promise<CodexSurfaceRemoteControlClientPage> {
    return this.connection.listRemoteControlClients(options);
  }

  /** Revokes one device from a remote-control environment. */
  async revokeRemoteControlClient(
    options: v2.RemoteControlClientsRevokeParams,
  ): Promise<v2.RemoteControlClientsRevokeResponse> {
    return this.connection.revokeRemoteControlClient(options);
  }

  /** Reads managed app-server requirements, including allowRemoteControl. */
  async readConfigRequirements(): Promise<CodexSurfaceConfigRequirements | null> {
    return this.connection.readConfigRequirements();
  }

  async cancelLogin(loginId = this.state.authentication.login.loginId ?? ''): Promise<CodexSurfaceSnapshot> {
    return this.connection.cancelLogin(loginId);
  }

  async logout(): Promise<CodexSurfaceSnapshot> {
    return this.connection.logout();
  }


  async refreshConversations(): Promise<CodexSurfaceSnapshot> {
    return this.conversations.refresh();
  }

  async listConversations(options: ListCodexConversationsOptions = {}): Promise<CodexConversationSummary[]> {
    return this.conversations.list(options);
  }

  async archiveConversation(conversationId: string): Promise<CodexSurfaceSnapshot> {
    return this.conversations.archive(conversationId);
  }

  async deleteConversation(conversationId: string): Promise<CodexSurfaceSnapshot> {
    return this.conversations.delete(conversationId);
  }

  async unarchiveConversation(conversationId: string): Promise<CodexSurfaceSnapshot> {
    return this.conversations.unarchive(conversationId);
  }

  async listModels(options: ListCodexModelsOptions = {}): Promise<CodexSurfaceModel[]> {
    return this.catalog.listModels(options);
  }

  async listSkills(options: ListCodexSkillsOptions = {}): Promise<CodexSurfaceSkill[]> {
    return this.catalog.listSkills(options);
  }

  async createConversation(
    options: CreateCodexConversationOptions = {},
    hostOptions: CodexConversationHostOptions = {},
  ): Promise<CodexSurfaceSnapshot> {
    return this.lifecycle.create(options, hostOptions);
  }

  async selectConversation(conversationId: string): Promise<CodexSurfaceSnapshot> {
    return this.lifecycle.select(conversationId);
  }

  async readConversationHistory(conversationId = this.state.activeConversationId ?? ''): Promise<CodexConversationHistory> {
    return this.lifecycle.readHistory(conversationId);
  }

  async renameConversation(title: string): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    await this.conversationSettings.rename(threadId, title);
    return this.getSnapshot();
  }

  async updateConversationSettings(settings: UpdateCodexConversationSettings): Promise<CodexSurfaceSnapshot> {
    return this.conversationSettings.update(settings);
  }

  async setGoal(objective: string, tokenBudget?: number | null): Promise<CodexSurfaceSnapshot> {
    return this.conversationSettings.setGoal(objective, tokenBudget);
  }

  async clearGoal(): Promise<CodexSurfaceSnapshot> {
    return this.conversationSettings.clearGoal();
  }

  async sendMessage(prompt: string, options: SendCodexMessageOptions = {}): Promise<CodexSurfaceSnapshot> {
    return this.messagesController.send(prompt, options);
  }

  async compactConversation(): Promise<CodexSurfaceSnapshot> {
    return this.turnActions.compact();
  }

  async startReview(options: StartCodexReviewOptions = {}): Promise<CodexSurfaceSnapshot> {
    return this.turnActions.startReview(options);
  }

  async steerMessage(
    prompt: string,
    options: SendCodexMessageOptions = {},
  ): Promise<CodexSurfaceSnapshot> {
    return this.messagesController.steer(prompt, options);
  }

  async interrupt(): Promise<CodexSurfaceSnapshot> {
    return this.turnActions.interrupt();
  }

  async deleteMessage(index: number): Promise<CodexSurfaceSnapshot> {
    return this.turnActions.deleteMessage(index);
  }

  async editMessage(index: number, content: string): Promise<CodexSurfaceSnapshot> {
    return this.turnActions.editMessage(index, content);
  }

  async retryMessage(index: number): Promise<CodexSurfaceSnapshot> {
    return this.turnActions.retryMessage(index);
  }

  async deleteQueuedPrompt(promptId: string): Promise<CodexSurfaceSnapshot> {
    return this.messagesController.deleteQueuedPrompt(promptId);
  }

  async steerQueuedPrompt(promptId: string): Promise<CodexSurfaceSnapshot> {
    return this.messagesController.steerQueuedPrompt(promptId);
  }

  async respondToClientRequest(response: CodexSurfaceClientRequestResponse): Promise<CodexSurfaceSnapshot> {
    await this.clientRequests.respond(undefined, response);
    return this.getSnapshot();
  }

  async resolveApproval(
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope: CodexSurfaceApprovalScope = 'once',
  ): Promise<CodexSurfaceSnapshot> {
    await this.approvals.resolve(undefined, approvalId, decision, scope);
    return this.getSnapshot();
  }

  conversation(conversationId: string): CodexConversation {
    const id = normalizedConversationId(conversationId);
    const existing = this.conversationHandles.get(id);
    if (existing) return existing;
    const handle = createCodexConversationHandle(id, {
      clearGoal: () => this.conversationSettings.clearGoalForThread(id),
      compact: () => this.turnActions.compactForThread(id),
      deleteMessage: (index) => this.turnActions.deleteMessageForThread(id, index),
      deleteQueuedPrompt: (promptId) => this.messagesController.deleteQueuedPromptForThread(id, promptId),
      editMessage: (index, content) => this.turnActions.editMessageForThread(id, index, content),
      getSnapshot: () => this.getConversationSnapshot(id),
      interrupt: () => this.turnActions.interruptThread(id),
      load: async (options) => { await this.ensureThreadReady(id, options); },
      onEvent: (listener) => this.onConversationEvent(id, listener),
      onStateChange: (listener) => this.onConversationStateChange(id, listener),
      readHistory: () => this.readConversationHistory(id),
      rename: (title) => this.conversationSettings.rename(id, title),
      resolveApproval: (approvalId, decision, scope = 'once') => (
        this.approvals.resolve(id, approvalId, decision, scope)
      ),
      respondToClientRequest: (response) => this.clientRequests.respond(id, response),
      retryMessage: (index) => this.turnActions.retryMessageForThread(id, index),
      rollbackToTurn: (turnId) => this.turnActions.rollbackToTurn(id, turnId),
      select: async () => { await this.selectConversation(id); },
      sendMessage: (prompt, options) => this.messagesController.sendToThread(id, prompt, options),
      setGoal: (objective, tokenBudget) => this.conversationSettings.setGoalForThread(id, objective, tokenBudget),
      startRealtime: (options) => this.startRealtimeForThread(id, options),
      startReview: (options) => this.turnActions.startReviewForThread(id, options),
      steerMessage: (prompt, options) => this.messagesController.steerForThread(id, prompt, options),
      steerQueuedPrompt: (promptId) => this.messagesController.steerQueuedPromptForThread(id, promptId),
      updateSettings: (settings) => this.conversationSettings.updateForThread(id, settings),
    });
    this.conversationHandles.set(id, handle);
    return handle;
  }

  private startRealtimeForThread(
    threadId: string,
    options: StartCodexRealtimeOptions,
  ): Promise<CodexRealtimeSession> {
    return startCodexRealtimeSession({
      client: this.client,
      ensureThreadReady: async () => { await this.ensureThreadReady(threadId); },
      onConversationEvent: (listener) => this.onConversationEvent(threadId, listener),
      options,
      threadId,
    });
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
    this.approvals.close();
    this.clientRequests.clear();
    this.items.reset();
    this.catalog.reset(false);
    for (const runtime of this.runtimeState.values()) {
      runtime.activeTurnId = null;
      runtime.busy = false;
      runtime.turnStartPending = false;
    }
    await this.client.close();
    this.patch({ status: 'idle', busy: false, approvals: [], clientRequests: [], historyLoading: false });
    this.emitSurfaceStatus('lifecycle');
  }

  private async ensureConnected(): Promise<void> {
    return this.connection.ensureConnected();
  }

  private async ensureThreadReady(
    threadId: string,
    loadOptions: CodexConversationLoadOptions = {},
  ): Promise<ThreadRuntimeState> {
    return this.lifecycle.ensureReady(threadId, loadOptions);
  }

  private createRuntime(threadId: string, patch: ThreadRuntimePatch = {}): ThreadRuntimeState {
    return this.runtimeState.create(threadId, patch);
  }

  private requireRuntime(threadId: string): ThreadRuntimeState {
    return this.runtimeState.require(threadId);
  }

  private runtimeProjection(
    runtime: ThreadRuntimeState,
  ): ReturnType<CodexSurfaceRuntimeController['projection']> {
    return this.runtimeState.projection(runtime);
  }

  private snapshotForRuntime(runtime: ThreadRuntimeState): CodexSurfaceSnapshot {
    return this.runtimeState.snapshot(runtime);
  }

  private activateRuntime(runtime: ThreadRuntimeState): void {
    this.runtimeState.activate(runtime);
  }

  private patchRuntime(threadId: string, patch: ThreadRuntimePatch): void {
    this.runtimeState.patch(threadId, patch);
  }

  private emitSurfaceStatus(origin: CodexSurfaceEventOrigin): void {
    this.runtimeState.emitSurfaceStatus(origin);
  }

  private emitSummaryUpserted(
    summary: CodexConversationSummary,
    reason: Extract<CodexSurfaceEvent, { type: 'conversation.summaryUpserted' }>['payload']['reason'],
    origin: CodexSurfaceEventOrigin,
  ): void {
    this.runtimeState.emitSummaryUpserted(summary, reason, origin);
  }

  private emitConversationActivity(threadId: string, origin: CodexSurfaceEventOrigin): void {
    this.runtimeState.emitConversationActivity(threadId, origin);
  }

  private emitConversationSettings(threadId: string, origin: CodexSurfaceEventOrigin): void {
    this.runtimeState.emitConversationSettings(threadId, origin);
  }

  private emitConversationSkills(threadId: string, origin: CodexSurfaceEventOrigin): void {
    this.runtimeState.emitConversationSkills(threadId, origin);
  }

  private emitConversationPermissions(threadId: string, origin: CodexSurfaceEventOrigin): void {
    this.runtimeState.emitConversationPermissions(threadId, origin);
  }

  private emitHistoryReplaced(
    threadId: string,
    reason: Extract<CodexSurfaceEvent, { type: 'conversation.historyReplaced' }>['payload']['reason'],
    origin: CodexSurfaceEventOrigin,
  ): void {
    this.runtimeState.emitHistoryReplaced(threadId, reason, origin);
  }

  private messageContainingTool(threadId: string, turnId: string, itemId: string): SurfaceMessage | null {
    return this.runtimeState.messageContainingTool(threadId, turnId, itemId);
  }

  private assistantMessageForTurn(threadId: string, turnId: string): SurfaceMessage | null {
    return this.runtimeState.assistantMessageForTurn(threadId, turnId);
  }

  private notifyConversationListeners(threadId: string): void {
    const listeners = this.conversationListeners.get(threadId);
    if (!listeners || listeners.size === 0) return;
    const snapshot = this.getConversationSnapshot(threadId);
    for (const listener of listeners) listener(snapshot);
  }

  private markRuntimeTurnActive(runtime: ThreadRuntimeState, turnId: string): void {
    this.runtimeState.markTurnActive(runtime, turnId);
  }

  private patchConversationStatus(
    threadId: string,
    status: CodexConversationSummary['status'],
    origin: CodexSurfaceEventOrigin = 'notification',
  ): void {
    this.runtimeState.patchConversationStatus(threadId, status, origin);
  }

  private patchConversationTurnCount(
    threadId: string,
    turnCount: number,
    origin: CodexSurfaceEventOrigin = 'notification',
  ): void {
    this.runtimeState.patchConversationTurnCount(threadId, turnCount, origin);
  }

  private clearPendingForThread(
    threadId: string,
    reason: string,
    eventReason: 'conversation_closed' | 'conversation_removed' | 'surface_disconnected',
  ): void {
    this.approvals.clearForThread(threadId, eventReason);
    this.clientRequests.clearForThread(threadId, reason, eventReason);
  }

  private removeThread(
    threadId: string,
    reason: 'archived' | 'deleted',
    origin: CodexSurfaceEventOrigin = 'notification',
  ): void {
    const known = this.state.activeConversationId === threadId
      || this.state.conversations.some((conversation) => conversation.id === threadId)
      || this.runtimeState.get(threadId) !== undefined
      || this.approvals.hasForThread(threadId)
      || this.clientRequests.hasForThread(threadId);
    if (!known) return;
    this.clearPendingForThread(threadId, 'Codex thread is no longer available', 'conversation_removed');
    this.runtimeState.forget(threadId);
    this.lifecycle.forget(threadId);
    this.conversations.forget(threadId);
    this.conversationHandles.delete(threadId);
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


  private handleUnknownNotification(notification: never): void {
    const runtimeNotification = notification as unknown as { method: string; params?: unknown };
    this.options.onUnknownNotification?.({
      method: runtimeNotification.method,
      ...('params' in runtimeNotification ? { params: runtimeNotification.params } : {}),
    });
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
