import type { CodexAppServerClient } from '../codex/index';
import type {
  CodexConversationSummary,
  CodexSurfaceSnapshot,
  SendCodexMessageOptions,
  StartCodexReviewOptions,
  SurfaceMessage,
} from '@codex-app-sdk/core/surface';
import { codexThreadToSurfaceMessages, codexTurnToSurfaceMessages } from './codex-conversation-history';
import {
  messageAt,
  messageTurnId,
  messageTurnIdOrNull,
  surfaceMessageAttachments,
  surfaceMessageText,
  threadToSummary,
  upsertConversation,
} from './codex-surface-data';
import type { SurfaceEventInput } from './codex-surface-events';
import { timestampToIso } from './codex-surface-events';
import { errorMessage, normalizeReviewTarget } from './codex-surface-prompts';
import { ensureAssistantTurnMessage } from './codex-surface-message-state';
import type { ThreadRuntimePatch, ThreadRuntimeState } from './codex-surface-runtime';

const UNCOMMITTED_REVIEW_PROMPT = 'Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.';

export type CodexSurfaceTurnActionsHost = {
  createConversation(): Promise<void>;
  emitConversationActivity(threadId: string, origin: 'action'): void;
  emitEvent(origin: 'action', input: SurfaceEventInput): void;
  emitHistoryReplaced(threadId: string, reason: 'rollback', origin: 'action'): void;
  emitSummaryUpserted(summary: CodexConversationSummary, reason: 'updated', origin: 'action'): void;
  ensureThreadReady(threadId: string): Promise<ThreadRuntimeState>;
  getSnapshot(): CodexSurfaceSnapshot;
  getState(): CodexSurfaceSnapshot;
  hydrateCompleteHistory(threadId: string, options?: { initialPageLoaded?: boolean; cursor?: string | null }): Promise<void>;
  patch(patch: Partial<CodexSurfaceSnapshot>): void;
  patchConversationStatus(threadId: string, status: CodexConversationSummary['status'], origin: 'action'): void;
  patchConversationTurnCount(threadId: string, turnCount: number, origin: 'action'): void;
  patchRuntime(threadId: string, patch: ThreadRuntimePatch): void;
  sendMessageToThread(threadId: string, prompt: string, options?: SendCodexMessageOptions): Promise<void>;
};

export class CodexSurfaceTurnActionsController {
  constructor(
    private readonly client: CodexAppServerClient,
    private readonly host: CodexSurfaceTurnActionsHost,
  ) {}

  async compact(): Promise<CodexSurfaceSnapshot> {
    const threadId = this.host.getState().activeConversationId;
    if (!threadId) return this.host.getSnapshot();
    await this.compactForThread(threadId);
    return this.host.getSnapshot();
  }

  async compactForThread(threadId: string): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    if (runtime.busy) throw new Error('Cannot compact while Codex is responding');
    await this.client.request('thread/compact/start', { threadId });
    const turnId = runtime.activeTurnId ?? runtime.turnIds.at(-1);
    if (turnId) {
      this.host.emitEvent('action', {
        type: 'context.compactionStarted', conversationId: threadId, turnId, payload: { itemId: null },
      });
    }
  }

  async startReview(options: StartCodexReviewOptions = {}): Promise<CodexSurfaceSnapshot> {
    if (!this.host.getState().activeConversationId) await this.host.createConversation();
    const threadId = this.host.getState().activeConversationId;
    if (!threadId) throw new Error('Codex did not create a conversation');
    await this.startReviewForThread(threadId, options);
    return this.host.getSnapshot();
  }

  async startReviewForThread(
    threadId: string,
    options: StartCodexReviewOptions = {},
  ): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    if (runtime.busy) throw new Error('The conversation is already responding');
    this.host.patchRuntime(threadId, { busy: true, turnStartPending: true, error: null });
    this.host.patchConversationStatus(threadId, 'active', 'action');
    this.host.emitConversationActivity(threadId, 'action');
    try {
      const target = normalizeReviewTarget(options.target ?? { type: 'uncommittedChanges' });
      const response = await this.client.request('review/start', {
        threadId,
        target,
        delivery: 'inline',
      });
      if (response.reviewThreadId !== threadId) {
        throw new Error(
          `Codex review/start returned unexpected review thread '${response.reviewThreadId}' for inline review on thread '${threadId}'`,
        );
      }
      const wasKnownTurn = runtime.turnIds.includes(response.turn.id);
      runtime.activeTurnId = response.turn.status === 'inProgress' ? response.turn.id : null;
      if (!runtime.turnIds.includes(response.turn.id)) runtime.turnIds.push(response.turn.id);
      this.host.patchConversationTurnCount(threadId, runtime.turnIds.length, 'action');
      const responseMessages = codexTurnToSurfaceMessages(threadId, response.turn)
        .filter((message) => !runtime.messages.some((candidate) => candidate.id === message.id))
        .map((message) => message.role === 'user'
          ? {
            ...message,
            parts: target.type === 'uncommittedChanges'
              ? message.parts.map((part) => part.type === 'text' && part.text === 'current changes'
                ? { ...part, text: UNCOMMITTED_REVIEW_PROMPT }
                : part)
              : message.parts,
            metadata: { ...message.metadata, reviewPrompt: true },
          }
          : message);
      const messages = insertTurnMessages(runtime.messages, response.turn.id, responseMessages);
      this.host.patchRuntime(threadId, {
        busy: runtime.activeTurnId !== null,
        turnStartPending: false,
        messages: runtime.activeTurnId
          ? ensureAssistantTurnMessage(messages, threadId, response.turn.id)
          : messages,
      });
      for (const message of responseMessages) {
        this.host.emitEvent('action', {
          type: 'message.appended', conversationId: threadId, turnId: response.turn.id,
          payload: { message: structuredClone(message) },
        });
      }
      this.host.patchConversationStatus(threadId, runtime.activeTurnId ? 'active' : 'idle', 'action');
      if (runtime.activeTurnId && !wasKnownTurn) {
        this.host.emitEvent('action', {
          type: 'turn.started', conversationId: threadId, turnId: response.turn.id,
          payload: { startedAt: timestampToIso(response.turn.startedAt) },
        });
      }
      this.host.emitConversationActivity(threadId, 'action');
    } catch (error) {
      this.host.patchRuntime(threadId, { busy: false, turnStartPending: false, error: errorMessage(error) });
      this.host.patchConversationStatus(threadId, 'error', 'action');
      this.host.emitConversationActivity(threadId, 'action');
      throw error;
    }
  }

  async interrupt(): Promise<CodexSurfaceSnapshot> {
    const threadId = this.host.getState().activeConversationId;
    if (!threadId) return this.host.getSnapshot();
    await this.interruptThread(threadId);
    return this.host.getSnapshot();
  }

  async interruptThread(threadId: string): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    if (!runtime.activeTurnId) return;
    await this.client.request('turn/interrupt', { threadId, turnId: runtime.activeTurnId });
  }

  async deleteMessage(index: number): Promise<CodexSurfaceSnapshot> {
    const threadId = this.requiredActiveConversation();
    await this.deleteMessageForThread(threadId, index);
    return this.host.getSnapshot();
  }

  async deleteMessageForThread(threadId: string, index: number): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    await this.rollbackToTurn(threadId, messageTurnId(messageAt(runtime.messages, index)));
  }

  async editMessage(index: number, content: string): Promise<CodexSurfaceSnapshot> {
    const threadId = this.requiredActiveConversation();
    await this.editMessageForThread(threadId, index, content);
    return this.host.getSnapshot();
  }

  async editMessageForThread(threadId: string, index: number, content: string): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    const message = messageAt(runtime.messages, index);
    if (message.role !== 'user') throw new Error('Only user messages can be edited');
    const text = content.trim();
    if (!text) throw new Error('Cannot replace a message with empty content');
    const attachments = surfaceMessageAttachments(message);
    await this.rollbackToTurn(threadId, messageTurnId(message));
    await this.host.sendMessageToThread(threadId, text, attachments.length > 0 ? { attachments } : {});
  }

  async retryMessage(index: number): Promise<CodexSurfaceSnapshot> {
    const threadId = this.requiredActiveConversation();
    await this.retryMessageForThread(threadId, index);
    return this.host.getSnapshot();
  }

  async retryMessageForThread(threadId: string, index: number): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    const turnId = messageTurnId(messageAt(runtime.messages, index));
    const prompt = [...runtime.messages.slice(0, index + 1)].reverse().find((candidate) => (
      candidate.role === 'user' && messageTurnIdOrNull(candidate) === turnId
    ));
    if (!prompt) throw new Error('Could not find the user prompt for this turn');
    const text = surfaceMessageText(prompt);
    if (!text) throw new Error('Could not find the user prompt for this turn');
    const attachments = surfaceMessageAttachments(prompt);
    await this.rollbackToTurn(threadId, turnId);
    await this.host.sendMessageToThread(threadId, text, attachments.length > 0 ? { attachments } : {});
  }

  async rollbackToTurn(threadId: string, turnId: string): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    if (runtime.busy) throw new Error('Cannot roll back while Codex is responding');
    let targetIndex = runtime.turnIds.indexOf(turnId);
    if (targetIndex < 0) {
      await this.host.hydrateCompleteHistory(threadId);
      targetIndex = runtime.turnIds.indexOf(turnId);
    }
    if (targetIndex < 0) throw new Error(`Cannot roll back to unknown Codex turn '${turnId}'`);
    if (runtime.historyMode === 'paginated') {
      await this.revertPaginatedThread(threadId, turnId, targetIndex, runtime);
      return;
    }
    const response = await this.client.request('thread/rollback', {
      threadId, numTurns: runtime.turnIds.length - targetIndex,
    });
    if (response.thread.id !== threadId) {
      throw new Error(`Codex thread/rollback returned '${response.thread.id}' for requested thread '${threadId}'`);
    }
    runtime.turnIds = response.thread.turns.map((turn) => turn.id);
    runtime.activeTurnId = null;
    const summary = threadToSummary(response.thread);
    this.host.patch({
      conversations: upsertConversation(this.host.getState().conversations, summary),
    });
    this.host.patchRuntime(threadId, {
      messages: codexThreadToSurfaceMessages(response.thread),
      answeredClientRequestIds: [], busy: false, turnStartPending: false, error: null,
      contextUsage: null, turnGitDiff: null,
    });
    this.host.emitSummaryUpserted(summary, 'updated', 'action');
    this.host.emitHistoryReplaced(threadId, 'rollback', 'action');
    this.host.emitConversationActivity(threadId, 'action');
  }

  private async revertPaginatedThread(
    threadId: string,
    turnId: string,
    targetIndex: number,
    runtime: ThreadRuntimeState,
  ): Promise<void> {
    const response = await this.client.request('thread/revert', {
      threadId,
      beforeTurnId: turnId,
    });
    if (response.thread.id !== threadId) {
      throw new Error(`Codex thread/revert returned '${response.thread.id}' for requested thread '${threadId}'`);
    }
    const retainedTurnIds = runtime.turnIds.slice(0, targetIndex);
    const retainedTurnIdSet = new Set(retainedTurnIds);
    const messages = runtime.messages.filter((message) => {
      const messageTurnId = messageTurnIdOrNull(message);
      return messageTurnId === null || retainedTurnIdSet.has(messageTurnId);
    });
    runtime.turnIds = retainedTurnIds;
    runtime.activeTurnId = null;
    const summary = { ...threadToSummary(response.thread), turnCount: retainedTurnIds.length };
    this.host.patch({
      conversations: upsertConversation(this.host.getState().conversations, summary),
    });
    this.host.patchRuntime(threadId, {
      messages,
      answeredClientRequestIds: [],
      busy: false,
      turnStartPending: false,
      error: null,
      contextUsage: null,
      turnGitDiff: null,
      historyCursor: response.turnsBackwardsCursor,
      historyHasOlder: response.turnsBackwardsCursor !== null,
      fullHistoryHydrated: response.turnsBackwardsCursor === null,
    });
    this.host.emitSummaryUpserted(summary, 'updated', 'action');
    this.host.emitHistoryReplaced(threadId, 'rollback', 'action');
    this.host.emitConversationActivity(threadId, 'action');
  }

  private requiredActiveConversation(): string {
    const threadId = this.host.getState().activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    return threadId;
  }
}

function insertTurnMessages(
  current: readonly SurfaceMessage[],
  turnId: string,
  incoming: readonly SurfaceMessage[],
): SurfaceMessage[] {
  const firstTurnMessageIndex = current.findIndex((message) => message.turnId === turnId);
  if (firstTurnMessageIndex < 0) return [...current, ...incoming];
  return [
    ...current.slice(0, firstTurnMessageIndex),
    ...incoming,
    ...current.slice(firstTurnMessageIndex),
  ];
}
