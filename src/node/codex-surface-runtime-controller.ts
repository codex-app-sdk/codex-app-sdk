import type {
  CodexConversationSummary,
  CodexSurfaceEvent,
  CodexSurfaceEventOrigin,
  CodexSurfaceSnapshot,
  SurfaceMessage,
} from '../surface/types';
import { CodexSurfaceApprovalsController } from './codex-surface-approvals-controller';
import { CodexSurfaceClientRequestsController } from './codex-surface-client-requests-controller';
import {
  createThreadRuntime,
  runtimeProjection,
  type ThreadRuntimePatch,
  type ThreadRuntimeState,
} from './codex-surface-runtime';

type SurfaceEventInput = CodexSurfaceEvent extends infer Event
  ? Event extends CodexSurfaceEvent
    ? Omit<Event, 'seq' | 'occurredAt' | 'origin'>
    : never
  : never;

export interface CodexSurfaceRuntimeHost {
  emitEvent(origin: CodexSurfaceEventOrigin, input: SurfaceEventInput): void;
  getState(): CodexSurfaceSnapshot;
  notifyConversationListeners(threadId: string): void;
  patch(patch: Partial<CodexSurfaceSnapshot>): void;
  schedulePluginRefresh(): void;
}

export class CodexSurfaceRuntimeController {
  private readonly runtimes = new Map<string, ThreadRuntimeState>();
  private readonly semanticEventValues = new Map<string, string>();

  constructor(
    private readonly approvals: CodexSurfaceApprovalsController,
    private readonly clientRequests: CodexSurfaceClientRequestsController,
    private readonly host: CodexSurfaceRuntimeHost,
  ) {}

  get(threadId: string): ThreadRuntimeState | undefined {
    return this.runtimes.get(threadId);
  }

  values(): IterableIterator<ThreadRuntimeState> {
    return this.runtimes.values();
  }

  clear(): void {
    this.runtimes.clear();
    this.semanticEventValues.clear();
  }

  forget(threadId: string): void {
    this.runtimes.delete(threadId);
    this.semanticEventValues.delete(`summary:${threadId}`);
    this.semanticEventValues.delete(`activity:${threadId}`);
    this.semanticEventValues.delete(`settings:${threadId}`);
  }

  create(threadId: string, patch: ThreadRuntimePatch = {}): ThreadRuntimeState {
    const existing = this.runtimes.get(threadId);
    if (existing) {
      Object.assign(existing, patch);
      return existing;
    }
    const runtime = createThreadRuntime(threadId, this.host.getState(), patch);
    this.runtimes.set(threadId, runtime);
    return runtime;
  }

  require(threadId: string): ThreadRuntimeState {
    return this.runtimes.get(threadId) ?? this.create(threadId);
  }

  projection(runtime: ThreadRuntimeState): ReturnType<typeof runtimeProjection> {
    return runtimeProjection(
      runtime,
      this.approvals.approvalsForThread(runtime.threadId),
      this.clientRequests.requestsForThread(runtime.threadId),
    );
  }

  snapshot(runtime: ThreadRuntimeState): CodexSurfaceSnapshot {
    return { ...this.host.getState(), ...this.projection(runtime) };
  }

  activate(runtime: ThreadRuntimeState): void {
    this.host.patch({
      activeConversationId: runtime.threadId,
      ...this.projection(runtime),
    });
    this.host.emitEvent('action', {
      type: 'conversation.selected',
      payload: { conversationId: runtime.threadId },
    });
  }

  patch(threadId: string, patch: ThreadRuntimePatch): void {
    const runtime = this.require(threadId);
    Object.assign(runtime, patch);
    if (this.host.getState().activeConversationId === threadId) {
      this.host.patch(this.projection(runtime));
    } else {
      this.host.notifyConversationListeners(threadId);
    }
  }

  emitSurfaceStatus(origin: CodexSurfaceEventOrigin): void {
    const state = this.host.getState();
    this.host.emitEvent(origin, {
      type: 'surface.statusChanged',
      payload: { status: state.status, error: state.error },
    });
  }

  emitSummaryUpserted(
    summary: CodexConversationSummary,
    reason: Extract<CodexSurfaceEvent, { type: 'conversation.summaryUpserted' }>['payload']['reason'],
    origin: CodexSurfaceEventOrigin,
  ): void {
    this.host.schedulePluginRefresh();
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
    this.host.emitEvent(origin, {
      type: 'conversation.summaryUpserted',
      conversationId: summary.id,
      payload: { summary: structuredClone(summary), reason },
    });
  }

  emitConversationActivity(threadId: string, origin: CodexSurfaceEventOrigin): void {
    const runtime = this.require(threadId);
    const payload = {
      threadStatus: structuredClone(runtime.threadStatus),
      busy: runtime.busy,
      error: runtime.error,
    };
    const fingerprint = JSON.stringify(payload);
    if (this.semanticEventValues.get(`activity:${threadId}`) === fingerprint) return;
    this.semanticEventValues.set(`activity:${threadId}`, fingerprint);
    this.host.emitEvent(origin, {
      type: 'conversation.activityChanged',
      conversationId: threadId,
      payload,
    });
  }

  emitConversationSettings(threadId: string, origin: CodexSurfaceEventOrigin): void {
    const runtime = this.require(threadId);
    const payload = {
      approvalPreset: runtime.approvalPreset,
      selectedModelId: runtime.selectedModelId,
      selectedReasoningEffort: runtime.selectedReasoningEffort,
      planMode: runtime.planMode,
    };
    const fingerprint = JSON.stringify(payload);
    if (this.semanticEventValues.get(`settings:${threadId}`) === fingerprint) return;
    this.semanticEventValues.set(`settings:${threadId}`, fingerprint);
    this.host.emitEvent(origin, {
      type: 'conversation.settingsChanged',
      conversationId: threadId,
      payload,
    });
  }

  emitConversationSkills(threadId: string, origin: CodexSurfaceEventOrigin): void {
    const runtime = this.require(threadId);
    this.host.emitEvent(origin, {
      type: 'conversation.skillsChanged',
      conversationId: threadId,
      payload: {
        cwd: runtime.cwd,
        skills: structuredClone(runtime.skills),
        status: runtime.skillCatalogStatus,
      },
    });
  }

  emitConversationPermissions(threadId: string, origin: CodexSurfaceEventOrigin): void {
    const runtime = this.require(threadId);
    this.host.emitEvent(origin, {
      type: 'conversation.permissionsChanged',
      conversationId: threadId,
      payload: {
        cwd: runtime.cwd,
        permissionProfiles: structuredClone(runtime.permissionProfiles),
        approvalPresets: [...runtime.approvalPresets],
      },
    });
  }

  emitHistoryReplaced(
    threadId: string,
    reason: Extract<CodexSurfaceEvent, { type: 'conversation.historyReplaced' }>['payload']['reason'],
    origin: CodexSurfaceEventOrigin,
  ): void {
    const runtime = this.require(threadId);
    this.host.emitEvent(origin, {
      type: 'conversation.historyReplaced',
      conversationId: threadId,
      payload: {
        reason,
        messages: structuredClone(runtime.messages),
        threadStatus: structuredClone(runtime.threadStatus),
      },
    });
  }

  messageContainingTool(threadId: string, turnId: string, itemId: string): SurfaceMessage | null {
    return this.require(threadId).messages.find((message) => (
      message.metadata?.turnId === turnId
      && message.parts.some((part) => part.type === 'tool' && part.id === itemId)
    )) ?? null;
  }

  assistantMessageForTurn(threadId: string, turnId: string): SurfaceMessage | null {
    return [...this.require(threadId).messages].reverse().find((message) => (
      message.role === 'assistant'
      && message.kind === undefined
      && message.metadata?.turnId === turnId
    )) ?? null;
  }

  markTurnActive(runtime: ThreadRuntimeState, turnId: string): void {
    runtime.activeTurnId = turnId;
    runtime.busy = true;
    runtime.turnStartPending = false;
    if (!runtime.turnIds.includes(turnId)) runtime.turnIds.push(turnId);
  }

  patchConversationStatus(
    threadId: string,
    status: CodexConversationSummary['status'],
    origin: CodexSurfaceEventOrigin = 'notification',
  ): void {
    const state = this.host.getState();
    this.host.patch({
      conversations: state.conversations.map((conversation) => conversation.id === threadId
        ? { ...conversation, status, updatedAt: new Date().toISOString() }
        : conversation),
    });
    const summary = this.host.getState().conversations.find((conversation) => conversation.id === threadId);
    if (summary) this.emitSummaryUpserted(summary, 'updated', origin);
  }

  patchConversationTurnCount(
    threadId: string,
    turnCount: number,
    origin: CodexSurfaceEventOrigin = 'notification',
  ): void {
    const state = this.host.getState();
    this.host.patch({
      conversations: state.conversations.map((conversation) => conversation.id === threadId
        ? { ...conversation, turnCount, updatedAt: new Date().toISOString() }
        : conversation),
    });
    const summary = this.host.getState().conversations.find((conversation) => conversation.id === threadId);
    if (summary) this.emitSummaryUpserted(summary, 'updated', origin);
  }
}
