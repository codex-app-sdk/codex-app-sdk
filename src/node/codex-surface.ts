import {
  CodexAppServerClient,
  type CodexServerRequestResponder,
  type ServerRequest,
  type ServerNotification,
  type v2,
} from '../codex/index';
import type {
  CodexConversationSummary,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalMode,
  CodexSurfaceApprovalPreset,
  CodexSurfaceApprovalScope,
  CodexSurfaceClientRequestResponse,
  CodexSurfaceContextUsage,
  CodexSurfaceModel,
  CodexSurfacePermissionMode,
  CodexSurfaceSnapshot,
  CodexSurfaceSkill,
  CreateCodexConversationOptions,
  SendCodexMessageOptions,
  SurfaceMessage,
  SurfaceMessageToolPart,
  SurfaceMessageToolPartUpdate,
  UpdateCodexConversationSettings,
} from '../surface/types';
import {
  codexItemToSurfaceMessage,
  codexItemToToolPart,
  codexThreadToSurfaceMessages,
} from './codex-conversation-history';
import {
  commandOutputDeltaToToolPartUpdate,
  fileChangePatchToToolPartUpdate,
  mcpProgressToToolPartUpdate,
  lineDiffFromUnifiedDiff,
} from './codex-tool-part-adapter';
import { rawResponseItemToEvent } from './codex-raw-response-item-adapter';
import { registerCodexApprovalHandlers, type PendingCodexApproval } from './codex-approvals';
import {
  CodexAppServerStdioTransport,
  type CodexAppServerStdioTransportOptions,
} from './codex-stdio-transport';

type StateListener = (snapshot: CodexSurfaceSnapshot) => void;

type ToolInputRequest = Extract<ServerRequest, { method: 'item/tool/requestUserInput' }>;
type McpElicitationRequest = Extract<ServerRequest, { method: 'mcpServer/elicitation/request' }>;
type PendingClientRequest =
  | {
    kind: 'ask_user';
    itemId: string;
    threadId: string;
    turnId: string;
    responder: CodexServerRequestResponder<'item/tool/requestUserInput'>;
  }
  | {
    kind: 'mcp_tool_approval';
    itemId: string;
    threadId: string;
    turnId: string | null;
    responder: CodexServerRequestResponder<'mcpServer/elicitation/request'>;
  };

export type CodexSurfaceOptions = {
  approvalPreset?: CodexSurfaceApprovalPreset;
  approvalMode?: CodexSurfaceApprovalMode;
  clientInfo?: {
    name: string;
    title?: string;
    version: string;
  };
  conversationLimit?: number;
  cwd?: string;
  permissionMode?: CodexSurfacePermissionMode;
  transport?: CodexAppServerStdioTransportOptions;
  /** Test and advanced embedding seam. Most apps should let the SDK create the client. */
  client?: CodexAppServerClient;
};

export class CodexSurface {
  private readonly client: CodexAppServerClient;
  private readonly listeners = new Set<StateListener>();
  private readonly pendingApprovals = new Map<string, PendingCodexApproval>();
  private readonly pendingClientRequests = new Map<string, PendingClientRequest>();
  private readonly unsubscribeApprovals: () => void;
  private readonly unsubscribeDisconnect: () => void;
  private readonly unsubscribeNotification: () => void;
  private readonly unsubscribeToolInputRequests: () => void;
  private readonly unsubscribeMcpElicitationRequests: () => void;
  private activeTurnId: string | null = null;
  private turnIds: string[] = [];
  private readonly planMarkdownByTurn = new Map<string, string>();
  private connectPromise: Promise<CodexSurfaceSnapshot> | null = null;
  private closed = false;
  private state: CodexSurfaceSnapshot = {
    status: 'idle',
    conversations: [],
    activeConversationId: null,
    messages: [],
    approvals: [],
    models: [],
    modelCatalogStatus: 'notLoaded',
    skills: [],
    skillCatalogStatus: 'notLoaded',
    permissionProfiles: [],
    approvalPresets: [],
    approvalPreset: null,
    selectedModelId: null,
    selectedReasoningEffort: null,
    planMode: false,
    contextUsage: null,
    goal: null,
    turnGitDiff: null,
    queuedPrompts: [],
    busy: false,
    error: null,
  };

  constructor(private readonly options: CodexSurfaceOptions) {
    this.client = options.client ?? new CodexAppServerClient(new CodexAppServerStdioTransport({
      ...options.transport,
    }));
    this.unsubscribeNotification = this.client.onNotification((notification) => this.handleNotification(notification));
    this.unsubscribeDisconnect = this.client.onDisconnect((error) => this.handleDisconnect(error));
    this.unsubscribeApprovals = registerCodexApprovalHandlers(this.client, (pending) => {
      this.pendingApprovals.set(pending.approval.id, pending);
      this.patch({
        approvals: [
          ...this.state.approvals.filter((approval) => approval.id !== pending.approval.id),
          pending.approval,
        ],
      });
    });
    this.unsubscribeToolInputRequests = this.client.onServerRequest(
      'item/tool/requestUserInput',
      (request, responder) => this.handleToolInputRequest(request, responder),
    );
    this.unsubscribeMcpElicitationRequests = this.client.onServerRequest(
      'mcpServer/elicitation/request',
      (request, responder) => this.handleMcpElicitationRequest(request, responder),
    );
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
    this.connectPromise = (async () => {
      try {
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
        await Promise.all([
          this.loadModels(),
          this.loadSkills(),
          this.loadPermissionProfiles(),
          this.loadConversations(),
        ]);
        const firstConversation = this.state.conversations[0];
        if (firstConversation) {
          await this.resumeConversation(firstConversation.id);
        }
        this.patch({ status: 'ready', error: null });
        return this.getSnapshot();
      } catch (error) {
        this.patch({ status: 'error', error: errorMessage(error) });
        throw error;
      } finally {
        this.connectPromise = null;
      }
    })();
    return this.connectPromise;
  }

  async refreshConversations(): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    return this.loadConversations();
  }

  private async loadConversations(): Promise<CodexSurfaceSnapshot> {
    const conversations: CodexConversationSummary[] = [];
    const totalLimit = this.options.conversationLimit === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(this.options.conversationLimit));
    let cursor: string | null | undefined = null;
    do {
      const limit = Math.min(100, totalLimit - conversations.length);
      if (limit <= 0) break;
      const response: v2.ThreadListResponse = await this.client.request('thread/list', {
        archived: false,
        cursor,
        limit,
        sortDirection: 'desc',
        sortKey: 'updated_at',
      });
      conversations.push(...response.data.map(threadToSummary));
      cursor = response.nextCursor;
    } while (cursor && conversations.length < totalLimit);
    this.patch({ conversations });
    return this.getSnapshot();
  }

  private async loadModels(): Promise<void> {
    this.patch({ modelCatalogStatus: 'loading' });
    try {
      const models: CodexSurfaceModel[] = [];
      let cursor: string | null | undefined = null;
      do {
        const response: v2.ModelListResponse = await this.client.request('model/list', {
          cursor,
          includeHidden: false,
        });
        models.push(...response.data.map(codexModelToSurfaceModel));
        cursor = response.nextCursor;
      } while (cursor);
      const selected = selectedModel(models, this.state.selectedModelId);
      this.patch({
        models,
        modelCatalogStatus: 'loaded',
        selectedModelId: selected?.id ?? null,
        selectedReasoningEffort: selected ? defaultReasoningEffort(selected) : null,
      });
    } catch {
      this.patch({ modelCatalogStatus: 'error', models: [] });
    }
  }

  private async loadSkills(forceReload = false): Promise<void> {
    this.patch({ skillCatalogStatus: 'loading' });
    try {
      const response = await this.client.request('skills/list', {
        ...(this.options.cwd ? { cwds: [this.options.cwd] } : {}),
        forceReload,
      });
      const skills = response.data.flatMap((entry) => entry.skills).map(surfaceSkill);
      this.patch({ skills, skillCatalogStatus: 'loaded' });
    } catch {
      this.patch({ skills: [], skillCatalogStatus: 'error' });
    }
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
    } catch {
      this.patch({
        permissionProfiles: [],
        approvalPresets: [],
        approvalPreset: null,
      });
    }
  }

  async createConversation(
    options: CreateCodexConversationOptions = {},
  ): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const settings = this.threadStartSettings(options);
    const model = options.model ?? selectedModel(this.state.models, this.state.selectedModelId)?.model;
    const response = await this.client.request('thread/start', {
      ...((options.cwd ?? this.options.cwd) ? { cwd: options.cwd ?? this.options.cwd } : {}),
      ...(model ? { model } : {}),
      ...settings,
      serviceName: 'codex_app_sdk',
    });
    this.activeTurnId = null;
    this.turnIds = [];
    const selection = sessionSelection(response, this.state.models, this.state);
    this.patch({
      activeConversationId: response.thread.id,
      busy: false,
      conversations: upsertConversation(this.state.conversations, threadToSummary(response.thread)),
      error: null,
      messages: [],
      contextUsage: null,
      goal: null,
      turnGitDiff: null,
      queuedPrompts: [],
      ...selection,
    });
    return this.getSnapshot();
  }

  async selectConversation(conversationId: string): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    return this.resumeConversation(conversationId);
  }

  private async resumeConversation(conversationId: string): Promise<CodexSurfaceSnapshot> {
    const response = await this.client.request('thread/resume', {
      threadId: conversationId,
    });
    this.activeTurnId = activeTurnId(response.thread.turns);
    this.turnIds = response.thread.turns.map((turn) => turn.id);
    const historyMessages = codexThreadToSurfaceMessages(response.thread);
    const messages = this.activeTurnId
      ? ensureAssistantTurnMessage(historyMessages, response.thread.id, this.activeTurnId)
      : historyMessages;
    this.patch({
      activeConversationId: response.thread.id,
      busy: Boolean(this.activeTurnId),
      conversations: upsertConversation(this.state.conversations, threadToSummary(response.thread)),
      error: null,
      messages,
      contextUsage: null,
      goal: null,
      turnGitDiff: null,
      queuedPrompts: [],
      ...sessionSelection(response, this.state.models, this.state),
    });
    return this.getSnapshot();
  }

  async updateConversationSettings(settings: UpdateCodexConversationSettings): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const next = nextSelection(this.state, settings);
    if (settings.approvalPreset && !this.state.approvalPresets.includes(settings.approvalPreset)) {
      throw new Error(`Approval preset '${settings.approvalPreset}' is not available`);
    }

    const threadId = this.state.activeConversationId;
    if (threadId) {
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
    }
    this.patch(next);
    return this.getSnapshot();
  }

  async setGoal(objective: string, tokenBudget?: number | null): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const threadId = this.state.activeConversationId;
    const normalizedObjective = objective.trim();
    if (!threadId) throw new Error('There is no active conversation');
    if (!normalizedObjective) throw new Error('Goal objective cannot be empty');
    const response = await this.client.request('thread/goal/set', {
      threadId,
      objective: normalizedObjective,
      ...(tokenBudget === undefined ? {} : { tokenBudget }),
    });
    this.patch({ goal: { ...response.goal } });
    return this.getSnapshot();
  }

  async clearGoal(): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    await this.client.request('thread/goal/clear', { threadId });
    this.patch({ goal: null });
    return this.getSnapshot();
  }

  async sendMessage(prompt: string, options: SendCodexMessageOptions = {}): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const text = prompt.trim();
    if (!text) {
      throw new Error('Cannot send an empty message');
    }
    if (text === '/plan') return this.updateConversationSettings({ planMode: true });
    if (text.startsWith('/goal ')) return this.setGoal(text.slice('/goal '.length));
    if (text === '/compact') return this.compactConversation();
    if (text === '/review') return this.startReview();
    if (this.state.busy) {
      this.patch({
        queuedPrompts: [...this.state.queuedPrompts, { id: createQueuedPromptId(), text }],
      });
      return this.getSnapshot();
    }
    if (!this.state.activeConversationId) {
      await this.createConversation();
    }
    const threadId = this.state.activeConversationId;
    if (!threadId) {
      throw new Error('Codex did not create a conversation');
    }

    const messageId = createMessageId();
    this.patch({
      busy: true,
      error: null,
      messages: [...this.state.messages, {
        id: messageId,
        role: 'user',
        status: 'complete',
        parts: [{ type: 'text', text }],
        createdAt: new Date().toISOString(),
        metadata: { conversationId: threadId },
      }],
    });

    try {
      const response = await this.client.request('turn/start', {
        threadId,
        clientUserMessageId: messageId,
        input: [{ type: 'text', text, text_elements: [] }],
        ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
        ...turnSettings(this.state, options),
      });
      this.activeTurnId = response.turn.status === 'inProgress' ? response.turn.id : null;
      if (!this.turnIds.includes(response.turn.id)) this.turnIds.push(response.turn.id);
      const busy = response.turn.status === 'inProgress';
      const messages = this.state.messages.map((message) => message.id === messageId
        ? {
          ...message,
          turnId: response.turn.id,
          metadata: { ...message.metadata, turnId: response.turn.id },
        }
        : message);
      this.patch({
        busy,
        messages: busy ? ensureAssistantTurnMessage(messages, threadId, response.turn.id) : messages,
      });
    } catch (error) {
      this.patch({ busy: false, error: errorMessage(error) });
      throw error;
    }
    return this.getSnapshot();
  }

  private async compactConversation(): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    await this.client.request('thread/compact/start', { threadId });
    return this.getSnapshot();
  }

  private async startReview(): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    if (this.state.busy) throw new Error('The active conversation is already responding');
    const response = await this.client.request('review/start', {
      threadId,
      target: { type: 'uncommittedChanges' },
      delivery: 'inline',
    });
    this.activeTurnId = response.turn.status === 'inProgress' ? response.turn.id : null;
    if (!this.turnIds.includes(response.turn.id)) this.turnIds.push(response.turn.id);
    this.patch({
      busy: this.activeTurnId !== null,
      messages: this.activeTurnId
        ? ensureAssistantTurnMessage(this.state.messages, threadId, response.turn.id)
        : this.state.messages,
    });
    return this.getSnapshot();
  }

  async steerMessage(prompt: string): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const text = prompt.trim();
    if (!text) throw new Error('Cannot steer with an empty message');
    const threadId = this.state.activeConversationId;
    if (!threadId || !this.activeTurnId) throw new Error('There is no active turn to steer');

    const messageId = createMessageId();
    const messages = ensureAssistantTurnMessage([
      ...this.state.messages,
      {
        id: messageId,
        kind: 'steer',
        role: 'user',
        status: 'complete',
        parts: [{ type: 'text', text }],
        createdAt: new Date().toISOString(),
        metadata: { conversationId: threadId, turnId: this.activeTurnId },
      },
    ], threadId, this.activeTurnId, { forceSegment: true });
    this.patch({
      error: null,
      messages,
    });
    try {
      await this.client.request('turn/steer', {
        threadId,
        expectedTurnId: this.activeTurnId,
        clientUserMessageId: messageId,
        input: [{ type: 'text', text, text_elements: [] }],
      });
    } catch (error) {
      this.patch({ error: errorMessage(error) });
      throw error;
    }
    return this.getSnapshot();
  }

  async interrupt(): Promise<CodexSurfaceSnapshot> {
    const threadId = this.state.activeConversationId;
    if (!threadId || !this.activeTurnId) {
      return this.getSnapshot();
    }
    await this.client.request('turn/interrupt', { threadId, turnId: this.activeTurnId });
    return this.getSnapshot();
  }

  async deleteMessage(index: number): Promise<CodexSurfaceSnapshot> {
    const message = messageAt(this.state.messages, index);
    const turnId = messageTurnId(message);
    return this.rollbackToTurn(turnId);
  }

  async editMessage(index: number, content: string): Promise<CodexSurfaceSnapshot> {
    const message = messageAt(this.state.messages, index);
    if (message.role !== 'user') throw new Error('Only user messages can be edited');
    const text = content.trim();
    if (!text) throw new Error('Cannot replace a message with empty content');
    await this.rollbackToTurn(messageTurnId(message));
    return this.sendMessage(text);
  }

  async retryMessage(index: number): Promise<CodexSurfaceSnapshot> {
    const message = messageAt(this.state.messages, index);
    const turnId = messageTurnId(message);
    const prompt = [...this.state.messages.slice(0, index + 1)].reverse().find((candidate) => (
      candidate.role === 'user' && messageTurnIdOrNull(candidate) === turnId
    ));
    const text = prompt ? surfaceMessageText(prompt) : '';
    if (!text) throw new Error('Could not find the user prompt for this turn');
    await this.rollbackToTurn(turnId);
    return this.sendMessage(text);
  }

  async deleteQueuedPrompt(promptId: string): Promise<CodexSurfaceSnapshot> {
    const queuedPrompts = this.state.queuedPrompts.filter((prompt) => prompt.id !== promptId);
    if (queuedPrompts.length === this.state.queuedPrompts.length) {
      throw new Error(`Unknown queued prompt '${promptId}'`);
    }
    this.patch({ queuedPrompts });
    return this.getSnapshot();
  }

  async steerQueuedPrompt(promptId: string): Promise<CodexSurfaceSnapshot> {
    const prompt = this.state.queuedPrompts.find((candidate) => candidate.id === promptId);
    if (!prompt) throw new Error(`Unknown queued prompt '${promptId}'`);
    this.patch({ queuedPrompts: this.state.queuedPrompts.filter((candidate) => candidate.id !== promptId) });
    return this.state.busy ? this.steerMessage(prompt.text) : this.sendMessage(prompt.text);
  }

  async respondToClientRequest(response: CodexSurfaceClientRequestResponse): Promise<CodexSurfaceSnapshot> {
    const pending = this.pendingClientRequests.get(response.id);
    if (!pending) throw new Error(`Unknown client request '${response.id}'`);
    this.pendingClientRequests.delete(response.id);
    if (pending.kind === 'ask_user') {
      const answers = response.payload?.answers ?? {};
      pending.responder.resolve({ answers });
      this.applyToolUpdate(pending.threadId, pending.turnId, {
        itemId: pending.itemId,
        status: 'completed',
        output: { answers },
      });
    } else {
      const decision = response.payload?.decision ?? 'deny';
      pending.responder.resolve(mcpElicitationResponse(decision));
      if (pending.turnId) {
        this.applyToolUpdate(pending.threadId, pending.turnId, {
          itemId: pending.itemId,
          status: decision === 'deny' ? 'failed' : 'completed',
          output: { decision },
        });
      }
    }
    return this.getSnapshot();
  }

  private async rollbackToTurn(turnId: string): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const threadId = this.state.activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    if (this.state.busy) throw new Error('Cannot roll back while Codex is responding');
    let targetIndex = this.turnIds.indexOf(turnId);
    if (targetIndex < 0) {
      const read = await this.client.request('thread/read', { threadId, includeTurns: true });
      this.turnIds = read.thread.turns.map((turn) => turn.id);
      targetIndex = this.turnIds.indexOf(turnId);
    }
    if (targetIndex < 0) throw new Error(`Cannot roll back to unknown Codex turn '${turnId}'`);
    const response = await this.client.request('thread/rollback', {
      threadId,
      numTurns: this.turnIds.length - targetIndex,
    });
    this.turnIds = response.thread.turns.map((turn) => turn.id);
    this.activeTurnId = null;
    this.patch({
      messages: codexThreadToSurfaceMessages(response.thread),
      busy: false,
      error: null,
      contextUsage: null,
      turnGitDiff: null,
    });
    return this.getSnapshot();
  }

  async resolveApproval(
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope: CodexSurfaceApprovalScope = 'once',
  ): Promise<CodexSurfaceSnapshot> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) throw new Error(`Unknown approval '${approvalId}'`);
    pending.resolve(decision, scope);
    this.pendingApprovals.delete(approvalId);
    this.patch({ approvals: this.state.approvals.filter((approval) => approval.id !== approvalId) });
    return this.getSnapshot();
  }

  getSnapshot(): CodexSurfaceSnapshot {
    return structuredClone(this.state);
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeNotification();
    this.unsubscribeToolInputRequests();
    this.unsubscribeMcpElicitationRequests();
    this.unsubscribeDisconnect();
    this.unsubscribeApprovals();
    this.pendingApprovals.clear();
    this.pendingClientRequests.clear();
    await this.client.close();
    this.patch({ status: 'idle', busy: false, approvals: [] });
  }

  private async ensureConnected(): Promise<void> {
    if (this.state.status !== 'ready') {
      await this.connect();
    }
  }

  private threadStartSettings(options: CreateCodexConversationOptions): {
    approvalPolicy: v2.AskForApproval;
    approvalsReviewer?: v2.ApprovalsReviewer;
    permissions?: string;
    sandbox?: v2.SandboxMode;
  } {
    const preset = options.approvalPreset ?? (
      options.approvalMode === undefined && options.permissionMode === undefined
        ? this.state.approvalPreset
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

  private handleNotification(notification: ServerNotification): void {
    switch (notification.method) {
      case 'thread/started':
        this.patch({
          conversations: upsertConversation(this.state.conversations, threadToSummary(notification.params.thread)),
        });
        return;
      case 'skills/changed':
        void this.loadSkills(true);
        return;
      case 'thread/name/updated':
        this.patch({
          conversations: this.state.conversations.map((conversation) => conversation.id === notification.params.threadId
            ? { ...conversation, title: notification.params.threadName?.trim() || conversation.preview || 'Untitled conversation' }
            : conversation),
        });
        return;
      case 'thread/settings/updated':
        if (notification.params.threadId === this.state.activeConversationId) {
          this.patch(threadSettingsSelection(notification.params.threadSettings, this.state.models, this.state));
        }
        return;
      case 'thread/goal/updated':
        if (notification.params.threadId === this.state.activeConversationId) {
          this.patch({ goal: { ...notification.params.goal } });
        }
        return;
      case 'thread/goal/cleared':
        if (notification.params.threadId === this.state.activeConversationId) {
          this.patch({ goal: null });
        }
        return;
      case 'thread/tokenUsage/updated':
        if (notification.params.threadId === this.state.activeConversationId) {
          this.patch({ contextUsage: surfaceContextUsage(notification.params.tokenUsage) });
        }
        return;
      case 'turn/started':
        if (notification.params.threadId === this.state.activeConversationId) {
          this.activeTurnId = notification.params.turn.id;
          if (!this.turnIds.includes(notification.params.turn.id)) this.turnIds.push(notification.params.turn.id);
          this.patch({
            busy: true,
            error: null,
            turnGitDiff: null,
            messages: ensureAssistantTurnMessage(
              this.state.messages,
              notification.params.threadId,
              notification.params.turn.id,
              { createdAt: timestampToIso(notification.params.turn.startedAt) },
            ),
          });
        }
        return;
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
        if (notification.params.threadId !== this.state.activeConversationId) return;
        const requestId = String(notification.params.requestId);
        const pending = this.pendingClientRequests.get(requestId);
        this.pendingClientRequests.delete(requestId);
        if (pending?.turnId) {
          this.applyToolUpdate(pending.threadId, pending.turnId, {
            itemId: pending.itemId,
            status: 'completed',
          });
        }
        return;
      }
      case 'turn/diff/updated': {
        if (notification.params.threadId !== this.state.activeConversationId) return;
        const counts = lineDiffFromUnifiedDiff(notification.params.diff);
        this.patch({
          turnGitDiff: {
            turnId: notification.params.turnId,
            addedLines: counts.addedLines,
            removedLines: counts.removedLines,
            diff: notification.params.diff,
            updatedAt: new Date().toISOString(),
          },
        });
        return;
      }
      case 'thread/compacted':
        if (notification.params.threadId === this.state.activeConversationId) {
          this.patch({
            messages: appendCompactionMarker(
              this.state.messages,
              notification.params.threadId,
              notification.params.turnId,
            ),
          });
        }
        return;
      case 'turn/completed':
        this.applyTurnCompleted(notification.params);
        return;
      case 'error':
        if (notification.params.threadId === this.state.activeConversationId) {
          this.patch({ error: notification.params.error.message });
        }
        return;
      default:
        return;
    }
  }

  private handleDisconnect(error: Error): void {
    if (this.closed) return;
    this.activeTurnId = null;
    this.pendingApprovals.clear();
    this.pendingClientRequests.clear();
    this.patch({
      status: 'error',
      busy: false,
      approvals: [],
      error: error.message,
    });
  }

  private applyAgentDelta(params: v2.AgentMessageDeltaNotification): void {
    if (params.threadId !== this.state.activeConversationId) return;
    this.patch({
      messages: appendAssistantTextDelta(
        this.state.messages,
        params.threadId,
        params.turnId,
        params.itemId,
        params.delta,
      ),
    });
  }

  private applyPlanDelta(params: v2.PlanDeltaNotification): void {
    if (params.threadId !== this.state.activeConversationId) return;
    const markdown = `${this.planMarkdownByTurn.get(params.turnId) ?? ''}${params.delta}`;
    this.planMarkdownByTurn.set(params.turnId, markdown);
    this.patch({
      messages: upsertAssistantToolPart(
        this.state.messages,
        params.threadId,
        params.turnId,
        planProgressToolPart(params.turnId, markdown, 'running'),
      ),
    });
  }

  private applyPlanUpdated(params: v2.TurnPlanUpdatedNotification): void {
    if (params.threadId !== this.state.activeConversationId) return;
    const markdown = formatPlanMarkdown(params.explanation, params.plan);
    this.planMarkdownByTurn.set(params.turnId, markdown);
    this.patch({
      messages: upsertAssistantToolPart(
        this.state.messages,
        params.threadId,
        params.turnId,
        planProgressToolPart(params.turnId, markdown, 'completed'),
      ),
    });
  }

  private applyRawResponseItem(params: v2.RawResponseItemCompletedNotification): void {
    if (params.threadId !== this.state.activeConversationId) return;
    const event = rawResponseItemToEvent(params.item);
    if (!event) return;
    if (event.type === 'item.updated') {
      this.applyToolUpdate(params.threadId, params.turnId, event.payload);
      return;
    }
    this.patch({
      messages: upsertAssistantToolPart(
        this.state.messages,
        params.threadId,
        params.turnId,
        event.payload.toolPart,
      ),
    });
  }

  private handleToolInputRequest(
    request: ToolInputRequest,
    responder: CodexServerRequestResponder<'item/tool/requestUserInput'>,
  ): boolean {
    const { threadId, turnId, itemId, questions } = request.params;
    if (threadId !== this.state.activeConversationId || questions.length === 0) return false;
    const requestId = String(request.id);
    this.pendingClientRequests.set(requestId, {
      kind: 'ask_user',
      itemId,
      threadId,
      turnId,
      responder,
    });
    const normalizedQuestions = questions.map((question) => ({
      ...question,
      options: question.options?.map((option) => ({ ...option })) ?? null,
    }));
    this.patch({
      messages: upsertAssistantToolPart(this.state.messages, threadId, turnId, {
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
    return true;
  }

  private handleMcpElicitationRequest(
    request: McpElicitationRequest,
    responder: CodexServerRequestResponder<'mcpServer/elicitation/request'>,
  ): boolean {
    const params = request.params;
    const meta = params.mode === 'form' ? params._meta : null;
    if (
      params.threadId !== this.state.activeConversationId
      || params.mode !== 'form'
      || !isRecord(meta)
      || meta.codex_approval_kind !== 'mcp_tool_call'
    ) return false;
    const requestId = String(request.id);
    const toolName = stringValue(meta.tool_name) ?? stringValue(meta.tool_title) ?? 'tool';
    const itemId = `approval-${requestId}`;
    this.pendingClientRequests.set(requestId, {
      kind: 'mcp_tool_approval',
      itemId,
      threadId: params.threadId,
      turnId: params.turnId,
      responder,
    });
    if (params.turnId) {
      this.patch({
        messages: upsertAssistantToolPart(this.state.messages, params.threadId, params.turnId, {
          type: 'tool',
          id: itemId,
          kind: 'mcp',
          title: `${params.serverName}.${toolName}`,
          status: 'running',
          statusText: JSON.stringify({
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
          }),
          input: meta.tool_params,
          metadata: { requestId, server: params.serverName, tool: toolName },
        }),
      });
    }
    return true;
  }

  private applyItem(params: v2.ItemStartedNotification | v2.ItemCompletedNotification, completed: boolean): void {
    if (params.threadId !== this.state.activeConversationId) return;
    const turn = {
      id: params.turnId,
      status: completed ? 'completed' : 'inProgress',
      startedAt: ('startedAtMs' in params ? params.startedAtMs : params.completedAtMs) / 1000,
    } as const;

    if (params.item.type === 'userMessage') {
      const message = codexItemToSurfaceMessage(params.threadId, turn, params.item);
      if (!message || this.state.messages.some((candidate) => candidate.id === message.id)) return;
      const isSteer = this.state.messages.some((candidate) => (
        candidate.role === 'assistant'
        && candidate.metadata?.turnId === params.turnId
        && candidate.parts.length > 0
      ));
      const messages = [...this.state.messages, isSteer ? { ...message, kind: 'steer' as const } : message];
      this.patch({
        messages: isSteer
          ? ensureAssistantTurnMessage(messages, params.threadId, params.turnId, { forceSegment: true })
          : messages,
      });
      return;
    }

    if (params.item.type === 'agentMessage' || params.item.type === 'exitedReviewMode') {
      const text = params.item.type === 'agentMessage' ? params.item.text : params.item.review;
      if (!text) return;
      this.patch({
        messages: upsertAssistantText(
          this.state.messages,
          params.threadId,
          params.turnId,
          params.item.id,
          text,
        ),
      });
      return;
    }

    if (params.item.type === 'contextCompaction') {
      this.patch({ messages: appendCompactionMarker(this.state.messages, params.threadId, params.turnId) });
      return;
    }

    const toolPart = codexItemToToolPart(params.item);
    if (!toolPart) return;
    this.patch({
      messages: upsertAssistantToolPart(this.state.messages, params.threadId, params.turnId, toolPart),
    });
  }

  private applyToolUpdate(threadId: string, turnId: string, update: SurfaceMessageToolPartUpdate): void {
    if (threadId !== this.state.activeConversationId) return;
    this.patch({ messages: updateAssistantToolPart(this.state.messages, threadId, turnId, update) });
  }

  private applyTurnCompleted(params: v2.TurnCompletedNotification): void {
    if (params.threadId !== this.state.activeConversationId) return;
    if (this.activeTurnId === params.turn.id) this.activeTurnId = null;
    const status: SurfaceMessage['status'] = params.turn.status === 'failed' ? 'error' : 'complete';
    const messages = this.state.messages
      .map((message) => message.metadata?.turnId === params.turn.id ? { ...message, status } : message)
      .filter((message) => !(
        message.role === 'assistant'
        && message.metadata?.turnId === params.turn.id
        && message.kind === undefined
        && message.parts.length === 0
      ));
    this.patch({
      busy: false,
      error: params.turn.error?.message ?? null,
      messages,
      conversations: this.state.conversations.map((conversation) => conversation.id === params.threadId
        ? { ...conversation, status: params.turn.status === 'failed' ? 'error' : 'idle', updatedAt: new Date().toISOString() }
        : conversation),
    });
    this.planMarkdownByTurn.delete(params.turn.id);
    void this.sendNextQueuedPrompt();
  }

  private async sendNextQueuedPrompt(): Promise<void> {
    if (this.state.busy || this.state.queuedPrompts.length === 0) return;
    const [next, ...queuedPrompts] = this.state.queuedPrompts;
    if (!next) return;
    this.patch({ queuedPrompts });
    try {
      await this.sendMessage(next.text);
    } catch (error) {
      this.patch({
        error: errorMessage(error),
        queuedPrompts: [next, ...this.state.queuedPrompts],
      });
    }
  }

  private patch(patch: Partial<CodexSurfaceSnapshot>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export function createCodexSurface(options: CodexSurfaceOptions): CodexSurface {
  return new CodexSurface(options);
}

function threadToSummary(thread: v2.Thread): CodexConversationSummary {
  const preview = thread.preview.trim();
  return {
    id: thread.id,
    title: thread.name?.trim() || preview.split('\n')[0]?.trim() || 'Untitled conversation',
    preview,
    cwd: thread.cwd,
    status: thread.status.type === 'active' ? 'active' : thread.status.type === 'systemError' ? 'error' : 'idle',
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

function surfaceSkill(skill: v2.SkillMetadata): CodexSurfaceSkill {
  return {
    name: skill.name,
    description: skill.description,
    shortDescription: skill.shortDescription ?? skill.interface?.shortDescription,
    displayName: skill.interface?.displayName,
    iconSmall: skill.interface?.iconSmall,
    iconLarge: skill.interface?.iconLarge,
    brandColor: skill.interface?.brandColor,
    defaultPrompt: skill.interface?.defaultPrompt,
    path: skill.path,
    scope: skill.scope,
    enabled: skill.enabled,
  };
}

function selectedModel(models: CodexSurfaceModel[], idOrModel: string | null): CodexSurfaceModel | null {
  return models.find((model) => model.id === idOrModel || model.model === idOrModel)
    ?? models.find((model) => model.isDefault)
    ?? models[0]
    ?? null;
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
  if (approvalPolicy === 'on-request' && approvalsReviewer === 'auto_review') return 'approve-for-me';
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

function timestampToIso(timestamp: number | null | undefined): string {
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000).toISOString()
    : new Date().toISOString();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
