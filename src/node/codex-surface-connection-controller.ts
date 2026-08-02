import type { CodexAppServerClient, v2 } from '../codex/index';
import type {
  CodexSurfaceAuthentication,
  CodexSurfaceChatGptLogin,
  CodexSurfaceEventOrigin,
  CodexSurfaceSnapshot,
} from '../surface/types';
import { CodexSurfaceApprovalsController } from './codex-surface-approvals-controller';
import { surfaceAuthenticationKey } from './codex-surface-authentication';
import { CodexSurfaceAuthenticationController } from './codex-surface-authentication-controller';
import { CodexSurfaceCatalogController } from './codex-surface-catalog-controller';
import { CodexSurfaceClientRequestsController } from './codex-surface-client-requests-controller';
import { CodexSurfaceConversationsController } from './codex-surface-conversations-controller';
import type {
  CodexSurfaceConfigRequirements,
  CodexSurfaceOptions,
  CodexSurfaceRemoteControlClientPage,
  CodexSurfaceRemoteControlPairing,
  CodexSurfaceRemoteControlPairingStatus,
  CodexSurfaceRemoteControlStatus,
} from './codex-surface-contracts';
import { CodexSurfaceItemsController } from './codex-surface-items-controller';
import { CodexSurfaceLifecycleController } from './codex-surface-lifecycle-controller';
import { errorMessage } from './codex-surface-prompts';
import { CodexSurfaceRuntimeController } from './codex-surface-runtime-controller';

export interface CodexSurfaceConnectionHost {
  clearConversationHandles(): void;
  clearPendingForThread(
    threadId: string,
    reason: string,
    eventReason: 'surface_disconnected',
  ): void;
  closed(): boolean;
  emitAuthenticationChanged(authentication: CodexSurfaceAuthentication, origin: CodexSurfaceEventOrigin): void;
  emitSurfaceStatus(origin: CodexSurfaceEventOrigin): void;
  getSnapshot(): CodexSurfaceSnapshot;
  getState(): CodexSurfaceSnapshot;
  patch(patch: Partial<CodexSurfaceSnapshot>): void;
}

export class CodexSurfaceConnectionController {
  private connectPromise: Promise<CodexSurfaceSnapshot> | null = null;
  private surfaceBootstrapPromise: Promise<void> | null = null;
  private bootstrappedAuthenticationKey: string | null = null;

  constructor(
    private readonly client: CodexAppServerClient,
    private readonly options: Pick<CodexSurfaceOptions, 'autoSelectFirstConversation' | 'clientInfo'>,
    private readonly authentication: CodexSurfaceAuthenticationController,
    private readonly approvals: CodexSurfaceApprovalsController,
    private readonly catalog: CodexSurfaceCatalogController,
    private readonly clientRequests: CodexSurfaceClientRequestsController,
    private readonly conversations: CodexSurfaceConversationsController,
    private readonly items: CodexSurfaceItemsController,
    private readonly lifecycle: CodexSurfaceLifecycleController,
    private readonly runtimeState: CodexSurfaceRuntimeController,
    private readonly host: CodexSurfaceConnectionHost,
  ) {}

  connect(): Promise<CodexSurfaceSnapshot> {
    if (this.host.getState().status === 'ready') return Promise.resolve(this.host.getSnapshot());
    if (this.connectPromise) return this.connectPromise;
    if (this.host.closed()) return Promise.reject(new Error('Codex surface is closed'));

    this.host.patch({ status: 'connecting', error: null });
    this.host.emitSurfaceStatus('lifecycle');
    this.connectPromise = (async () => {
      try {
        this.bootstrappedAuthenticationKey = null;
        this.catalog.reset(true);
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
        const authenticationChanged = await this.authentication.load('lifecycle');
        if (authenticationChanged || this.authentication.blocksBootstrap()) {
          await this.clearAuthenticatedSurfaceData();
        }
        if (!this.authentication.blocksBootstrap()) await this.bootstrapSurfaceData();
        this.host.patch({ status: 'ready', error: null });
        this.host.emitSurfaceStatus('lifecycle');
        if (!this.authentication.blocksBootstrap()) this.catalog.schedulePluginRefresh();
        return this.host.getSnapshot();
      } catch (error) {
        this.host.patch({ status: 'error', error: errorMessage(error) });
        this.host.emitSurfaceStatus('lifecycle');
        throw error;
      } finally {
        this.connectPromise = null;
      }
    })();
    return this.connectPromise;
  }

  async ensureConnected(): Promise<void> {
    if (this.host.getState().status !== 'ready') await this.connect();
    while (true) {
      const pending = this.authentication.pendingRefresh() ?? this.surfaceBootstrapPromise;
      if (!pending) return;
      await pending;
    }
  }

  bootstrapSurfaceData(force = false): Promise<void> {
    const authenticationKey = surfaceAuthenticationKey(this.host.getState().authentication);
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
        this.catalog.loadModels(),
        this.catalog.loadSkills(force),
        this.catalog.loadPermissionProfiles(),
        this.catalog.loadRateLimits(),
        this.conversations.load(),
      ]);
      const state = this.host.getState();
      const activeConversation = state.activeConversationId
        ? state.conversations.find((conversation) => conversation.id === state.activeConversationId)
        : undefined;
      const conversationToResume = activeConversation
        ?? (this.options.autoSelectFirstConversation === false ? undefined : state.conversations[0]);
      if (conversationToResume && !this.runtimeState.get(conversationToResume.id)?.hydrated) {
        await this.lifecycle.resumeDuringBootstrap(conversationToResume.id);
      }
      this.bootstrappedAuthenticationKey = authenticationKey;
      this.catalog.schedulePluginRefresh(force);
    })();
    this.surfaceBootstrapPromise = bootstrap;
    void bootstrap.finally(() => {
      if (this.surfaceBootstrapPromise === bootstrap) this.surfaceBootstrapPromise = null;
    }).catch(() => undefined);
    return bootstrap;
  }

  async refreshAccount(): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    return this.authentication.refresh('action', true);
  }

  async startChatGptLogin(): Promise<CodexSurfaceChatGptLogin> {
    await this.ensureConnected();
    return this.authentication.startChatGptLogin();
  }

  async cancelLogin(loginId: string): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    return this.authentication.cancelLogin(loginId);
  }

  async logout(): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    return this.authentication.logout();
  }

  async readRemoteControlStatus(): Promise<CodexSurfaceRemoteControlStatus> {
    await this.ensureConnected();
    return this.client.request('remoteControl/status/read', undefined);
  }

  async enableRemoteControl(options: v2.RemoteControlEnableParams = {}): Promise<CodexSurfaceRemoteControlStatus> {
    await this.ensureConnected();
    return this.client.request('remoteControl/enable', options);
  }

  async disableRemoteControl(options: v2.RemoteControlDisableParams = {}): Promise<CodexSurfaceRemoteControlStatus> {
    await this.ensureConnected();
    return this.client.request('remoteControl/disable', options);
  }

  async startRemoteControlPairing(
    options: v2.RemoteControlPairingStartParams = {},
  ): Promise<CodexSurfaceRemoteControlPairing> {
    await this.ensureConnected();
    return this.client.request('remoteControl/pairing/start', options);
  }

  async readRemoteControlPairingStatus(
    options: v2.RemoteControlPairingStatusParams = {},
  ): Promise<CodexSurfaceRemoteControlPairingStatus> {
    await this.ensureConnected();
    return this.client.request('remoteControl/pairing/status', options);
  }

  async listRemoteControlClients(
    options: v2.RemoteControlClientsListParams,
  ): Promise<CodexSurfaceRemoteControlClientPage> {
    await this.ensureConnected();
    return this.client.request('remoteControl/client/list', options);
  }

  async revokeRemoteControlClient(
    options: v2.RemoteControlClientsRevokeParams,
  ): Promise<v2.RemoteControlClientsRevokeResponse> {
    await this.ensureConnected();
    return this.client.request('remoteControl/client/revoke', options);
  }

  async readConfigRequirements(): Promise<CodexSurfaceConfigRequirements | null> {
    await this.ensureConnected();
    return (await this.client.request('configRequirements/read', undefined)).requirements;
  }

  patchAuthentication(
    patch: Partial<CodexSurfaceAuthentication>,
    origin: CodexSurfaceEventOrigin,
  ): void {
    const authentication = { ...this.host.getState().authentication, ...patch };
    this.host.patch({ authentication });
    this.host.emitAuthenticationChanged(authentication, origin);
  }

  handleDisconnect(error: Error): void {
    if (this.host.closed()) return;
    this.catalog.reset(false);
    for (const runtime of this.runtimeState.values()) {
      this.host.clearPendingForThread(runtime.threadId, error.message, 'surface_disconnected');
      runtime.activeTurnId = null;
      runtime.busy = false;
      runtime.turnStartPending = false;
      runtime.historyLoading = false;
      runtime.error = error.message;
    }
    this.approvals.denyAll();
    this.clientRequests.clear();
    this.host.patch({
      status: 'error',
      busy: false,
      approvals: [],
      clientRequests: [],
      historyLoading: false,
      error: error.message,
    });
    this.host.emitSurfaceStatus('lifecycle');
  }

  private resetAppServerSessionState(): void {
    this.runtimeState.clear();
    this.lifecycle.resetHydrations();
    this.conversations.reset();
    this.items.reset();
  }

  async clearAuthenticatedSurfaceData(): Promise<void> {
    const pendingBootstrap = this.surfaceBootstrapPromise;
    if (pendingBootstrap) await pendingBootstrap.catch(() => undefined);
    this.approvals.denyAll();
    this.clientRequests.rejectAll('Codex account signed out');
    this.runtimeState.clear();
    this.lifecycle.clear();
    this.conversations.reset();
    this.host.clearConversationHandles();
    this.items.reset();
    this.bootstrappedAuthenticationKey = null;
    this.catalog.reset(true);
    this.host.patch({
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
}
