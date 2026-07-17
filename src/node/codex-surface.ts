import {
  CodexAppServerClient,
  type ServerNotification,
  type v2,
} from '../codex/index';
import type {
  CodexConversationSummary,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalMode,
  CodexSurfaceApprovalScope,
  CodexSurfacePermissionMode,
  CodexSurfaceSnapshot,
  CreateCodexConversationOptions,
  SendCodexMessageOptions,
  SurfaceMessage,
} from '../surface/types';
import { codexItemToSurfaceMessage, codexThreadToSurfaceMessages } from './codex-conversation-history';
import { registerCodexApprovalHandlers, type PendingCodexApproval } from './codex-approvals';
import {
  CodexAppServerStdioTransport,
  type CodexAppServerStdioTransportOptions,
} from './codex-stdio-transport';

type StateListener = (snapshot: CodexSurfaceSnapshot) => void;

export type CodexSurfaceOptions = {
  approvalMode?: CodexSurfaceApprovalMode;
  clientInfo?: {
    name: string;
    title?: string;
    version: string;
  };
  conversationLimit?: number;
  cwd: string;
  permissionMode?: CodexSurfacePermissionMode;
  transport?: CodexAppServerStdioTransportOptions;
  /** Test and advanced embedding seam. Most apps should let the SDK create the client. */
  client?: CodexAppServerClient;
};

export class CodexSurface {
  private readonly client: CodexAppServerClient;
  private readonly listeners = new Set<StateListener>();
  private readonly pendingApprovals = new Map<string, PendingCodexApproval>();
  private readonly unsubscribeApprovals: () => void;
  private readonly unsubscribeNotification: () => void;
  private activeTurnId: string | null = null;
  private connectPromise: Promise<CodexSurfaceSnapshot> | null = null;
  private closed = false;
  private state: CodexSurfaceSnapshot = {
    status: 'idle',
    conversations: [],
    activeConversationId: null,
    messages: [],
    approvals: [],
    busy: false,
    error: null,
  };

  constructor(private readonly options: CodexSurfaceOptions) {
    this.client = options.client ?? new CodexAppServerClient(new CodexAppServerStdioTransport({
      ...options.transport,
      cwd: options.transport?.cwd ?? options.cwd,
    }));
    this.unsubscribeNotification = this.client.onNotification((notification) => this.handleNotification(notification));
    this.unsubscribeApprovals = registerCodexApprovalHandlers(this.client, (pending) => {
      this.pendingApprovals.set(pending.approval.id, pending);
      this.patch({
        approvals: [
          ...this.state.approvals.filter((approval) => approval.id !== pending.approval.id),
          pending.approval,
        ],
      });
    });
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
        await this.loadConversations();
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
    const response = await this.client.request('thread/list', {
      archived: false,
      cwd: this.options.cwd,
      limit: this.options.conversationLimit ?? 100,
      sortDirection: 'desc',
      sortKey: 'updated_at',
    });
    this.patch({ conversations: response.data.map(threadToSummary) });
    return this.getSnapshot();
  }

  async createConversation(
    options: CreateCodexConversationOptions = {},
  ): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const settings = this.threadSettings(options);
    const response = await this.client.request('thread/start', {
      cwd: options.cwd ?? this.options.cwd,
      ...(options.model ? { model: options.model } : {}),
      ...settings,
      serviceName: 'codex_app_sdk',
    });
    this.activeTurnId = null;
    this.patch({
      activeConversationId: response.thread.id,
      busy: false,
      conversations: upsertConversation(this.state.conversations, threadToSummary(response.thread)),
      error: null,
      messages: [],
    });
    return this.getSnapshot();
  }

  async selectConversation(conversationId: string): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const response = await this.client.request('thread/resume', {
      threadId: conversationId,
      cwd: this.options.cwd,
      ...this.threadSettings({}),
    });
    this.activeTurnId = activeTurnId(response.thread.turns);
    this.patch({
      activeConversationId: response.thread.id,
      busy: Boolean(this.activeTurnId),
      conversations: upsertConversation(this.state.conversations, threadToSummary(response.thread)),
      error: null,
      messages: codexThreadToSurfaceMessages(response.thread),
    });
    return this.getSnapshot();
  }

  async sendMessage(prompt: string, options: SendCodexMessageOptions = {}): Promise<CodexSurfaceSnapshot> {
    await this.ensureConnected();
    const text = prompt.trim();
    if (!text) {
      throw new Error('Cannot send an empty message');
    }
    if (this.state.busy) {
      throw new Error('The active conversation is already responding');
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
        cwd: this.options.cwd,
        ...(options.model ? { model: options.model } : {}),
      });
      this.activeTurnId = response.turn.status === 'inProgress' ? response.turn.id : null;
      this.patch({ busy: response.turn.status === 'inProgress' });
    } catch (error) {
      this.patch({ busy: false, error: errorMessage(error) });
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
    this.unsubscribeApprovals();
    this.pendingApprovals.clear();
    await this.client.close();
    this.patch({ status: 'idle', busy: false, approvals: [] });
  }

  private async ensureConnected(): Promise<void> {
    if (this.state.status !== 'ready') {
      await this.connect();
    }
  }

  private threadSettings(options: CreateCodexConversationOptions): {
    approvalPolicy: v2.AskForApproval;
    sandbox: v2.SandboxMode;
  } {
    const approvalMode = options.approvalMode ?? this.options.approvalMode ?? 'never';
    const permissionMode = options.permissionMode ?? this.options.permissionMode ?? 'read-only';
    return {
      approvalPolicy: approvalMode === 'ask' ? 'on-request' : 'never',
      sandbox: permissionMode === 'full-access' ? 'danger-full-access' : permissionMode,
    };
  }

  private handleNotification(notification: ServerNotification): void {
    switch (notification.method) {
      case 'thread/started':
        this.patch({
          conversations: upsertConversation(this.state.conversations, threadToSummary(notification.params.thread)),
        });
        return;
      case 'thread/name/updated':
        this.patch({
          conversations: this.state.conversations.map((conversation) => conversation.id === notification.params.threadId
            ? { ...conversation, title: notification.params.threadName?.trim() || conversation.preview || 'Untitled conversation' }
            : conversation),
        });
        return;
      case 'turn/started':
        if (notification.params.threadId === this.state.activeConversationId) {
          this.activeTurnId = notification.params.turn.id;
          this.patch({ busy: true, error: null });
        }
        return;
      case 'item/agentMessage/delta':
        this.applyAgentDelta(notification.params);
        return;
      case 'item/started':
      case 'item/completed':
        this.applyItem(notification.params, notification.method === 'item/completed');
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

  private applyAgentDelta(params: v2.AgentMessageDeltaNotification): void {
    if (params.threadId !== this.state.activeConversationId) return;
    const id = `assistant-${params.itemId}`;
    const existing = this.state.messages.find((message) => message.id === id);
    const messages = existing
      ? this.state.messages.map((message) => message.id === id ? appendText(message, params.delta) : message)
      : [...this.state.messages, {
        id,
        role: 'assistant' as const,
        status: 'streaming' as const,
        parts: [{ type: 'text' as const, text: params.delta }],
        createdAt: new Date().toISOString(),
        metadata: { conversationId: params.threadId, turnId: params.turnId, itemId: params.itemId },
      }];
    this.patch({ messages });
  }

  private applyItem(params: v2.ItemStartedNotification | v2.ItemCompletedNotification, completed: boolean): void {
    if (params.threadId !== this.state.activeConversationId) return;
    const message = codexItemToSurfaceMessage(params.threadId, {
      id: params.turnId,
      status: completed ? 'completed' : 'inProgress',
      startedAt: ('startedAtMs' in params ? params.startedAtMs : params.completedAtMs) / 1000,
    }, params.item);
    if (!message) return;
    const existingIndex = this.state.messages.findIndex((candidate) => candidate.id === message.id);
    if (params.item.type === 'userMessage' && existingIndex >= 0) return;
    const messages = [...this.state.messages];
    if (existingIndex >= 0) messages.splice(existingIndex, 1, message);
    else messages.push(message);
    this.patch({ messages });
  }

  private applyTurnCompleted(params: v2.TurnCompletedNotification): void {
    if (params.threadId !== this.state.activeConversationId) return;
    if (this.activeTurnId === params.turn.id) this.activeTurnId = null;
    const status = params.turn.status === 'failed' ? 'error' : 'complete';
    this.patch({
      busy: false,
      error: params.turn.error?.message ?? null,
      messages: this.state.messages.map((message) => message.metadata?.turnId === params.turn.id
        ? { ...message, status }
        : message),
      conversations: this.state.conversations.map((conversation) => conversation.id === params.threadId
        ? { ...conversation, status: params.turn.status === 'failed' ? 'error' : 'idle', updatedAt: new Date().toISOString() }
        : conversation),
    });
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

function activeTurnId(turns: v2.Turn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.status === 'inProgress') return turn.id;
  }
  return null;
}

function appendText(message: SurfaceMessage, delta: string): SurfaceMessage {
  const parts = [...message.parts];
  const textIndex = parts.findIndex((part) => part.type === 'text');
  if (textIndex >= 0) {
    const part = parts[textIndex];
    if (part?.type === 'text') parts.splice(textIndex, 1, { ...part, text: `${part.text}${delta}` });
  } else {
    parts.push({ type: 'text', text: delta });
  }
  return { ...message, status: 'streaming', parts };
}

function createMessageId(): string {
  return `user-${globalThis.crypto.randomUUID()}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
