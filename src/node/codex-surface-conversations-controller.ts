import type { CodexAppServerClient, v2 } from '../codex/index';
import type {
  CodexConversationSummary,
  CodexSurfaceSnapshot,
  ListCodexConversationsOptions,
  SurfaceMessage,
} from '../surface/types';
import { codexTurnToSurfaceMessages, preserveHistoricalAttachmentPreviews } from './codex-conversation-history';
import { normalizedConversationId, errorMessage } from './codex-surface-prompts';
import { threadToSummary, upsertConversation } from './codex-surface-data';
import type { ThreadRuntimePatch, ThreadRuntimeState } from './codex-surface-runtime';

const HISTORY_PAGE_SIZE = 5;
const HISTORY_MESSAGE_BATCH_SIZE = 20;

type HistoryHydrationOptions = {
  initialPageLoaded?: boolean;
  cursor?: string | null;
};

export type CodexSurfaceConversationsHost = {
  emitHistoryPrepended(threadId: string, messages: readonly SurfaceMessage[], origin: 'lifecycle'): void;
  emitSummaryUpserted(
    summary: CodexConversationSummary,
    reason: 'listed' | 'updated',
    origin: 'action',
  ): void;
  ensureConnected(): Promise<void>;
  getSnapshot(): CodexSurfaceSnapshot;
  getState(): CodexSurfaceSnapshot;
  patch(patch: Partial<CodexSurfaceSnapshot>): void;
  patchRuntime(threadId: string, patch: ThreadRuntimePatch): void;
  removeThread(threadId: string, reason: 'archived' | 'deleted', origin: 'action'): void;
  requireRuntime(threadId: string): ThreadRuntimeState;
  runtime(threadId: string): ThreadRuntimeState | undefined;
  schedulePluginRefresh(force: boolean): void;
};

export class CodexSurfaceConversationsController {
  private readonly historyHydrations = new Map<string, Promise<void>>();

  constructor(
    private readonly client: CodexAppServerClient,
    private readonly conversationLimit: number | undefined,
    private readonly host: CodexSurfaceConversationsHost,
  ) {}

  reset(): void {
    this.historyHydrations.clear();
  }

  forget(threadId: string): void {
    this.historyHydrations.delete(threadId);
  }

  async refresh(): Promise<CodexSurfaceSnapshot> {
    await this.host.ensureConnected();
    return this.load();
  }

  async load(): Promise<CodexSurfaceSnapshot> {
    const conversations = await this.requestConversations({ limit: this.conversationLimit });
    this.host.patch({ conversations });
    this.host.schedulePluginRefresh(true);
    for (const summary of conversations) this.host.emitSummaryUpserted(summary, 'listed', 'action');
    return this.host.getSnapshot();
  }

  async list(options: ListCodexConversationsOptions = {}): Promise<CodexConversationSummary[]> {
    await this.host.ensureConnected();
    return structuredClone(await this.requestConversations(options));
  }

  async archive(conversationId: string): Promise<CodexSurfaceSnapshot> {
    const threadId = normalizedConversationId(conversationId);
    await this.host.ensureConnected();
    await this.client.request('thread/archive', { threadId });
    this.host.removeThread(threadId, 'archived', 'action');
    return this.host.getSnapshot();
  }

  async delete(conversationId: string): Promise<CodexSurfaceSnapshot> {
    const threadId = normalizedConversationId(conversationId);
    await this.host.ensureConnected();
    await this.client.request('thread/delete', { threadId });
    this.host.removeThread(threadId, 'deleted', 'action');
    return this.host.getSnapshot();
  }

  async unarchive(conversationId: string): Promise<CodexSurfaceSnapshot> {
    const threadId = normalizedConversationId(conversationId);
    await this.host.ensureConnected();
    const response = await this.client.request('thread/unarchive', { threadId });
    if (response.thread.id !== threadId) {
      throw new Error(`Codex thread/unarchive returned '${response.thread.id}' for requested thread '${threadId}'`);
    }
    const summary = this.summaryWithKnownTurnCount(response.thread);
    this.host.patch({
      conversations: upsertConversation(this.host.getState().conversations, summary),
    });
    this.host.emitSummaryUpserted(summary, 'updated', 'action');
    return this.host.getSnapshot();
  }

  hydrateCompleteHistory(threadId: string, options: HistoryHydrationOptions = {}): Promise<void> {
    const runtime = this.host.requireRuntime(threadId);
    if (runtime.fullHistoryHydrated) return Promise.resolve();
    if (options.initialPageLoaded && options.cursor === null) {
      this.host.patchRuntime(threadId, { fullHistoryHydrated: true });
      return Promise.resolve();
    }
    const existing = this.historyHydrations.get(threadId);
    if (existing) return existing;
    const hydration = (async () => {
      try {
        const requestedCursors = new Set<string>();
        const materializedTurnIds = new Set(this.host.requireRuntime(threadId).turnIds);
        let cursor: string | null = options.cursor ?? null;
        do {
          if (cursor !== null) {
            if (requestedCursors.has(cursor)) {
              throw new Error(`Codex app-server repeated a thread history cursor for '${threadId}'`);
            }
            requestedCursors.add(cursor);
          }
          const response: v2.ThreadTurnsListResponse = await this.client.request('thread/turns/list', {
            threadId, cursor, limit: HISTORY_PAGE_SIZE, sortDirection: 'desc', itemsView: 'full',
          });
          const turns = [...response.data].reverse();
          const newTurnIds = new Set(turns
            .map((turn) => turn.id)
            .filter((turnId) => !materializedTurnIds.has(turnId)));
          for (const turn of turns) materializedTurnIds.add(turn.id);
          const newMessages = this.mergeHistoryPage(threadId, turns, newTurnIds);
          // The host prepends each event to the currently visible history. Emit
          // the nearest-older chunk first so repeated prepends preserve the
          // chronological order of the complete transcript.
          for (let index = newMessages.length; index > 0;) {
            const start = Math.max(0, index - HISTORY_MESSAGE_BATCH_SIZE);
            this.host.emitHistoryPrepended(
              threadId,
              newMessages.slice(start, index),
              'lifecycle',
            );
            await yieldToRenderer();
            index = start;
          }
          cursor = response.nextCursor;
        } while (cursor !== null);
        if (!this.host.runtime(threadId)) return;
        this.host.patchRuntime(threadId, { fullHistoryHydrated: true });
      } catch (error) {
        if (this.host.runtime(threadId)) {
          this.host.patchRuntime(threadId, {
            error: `Could not load complete conversation history: ${errorMessage(error)}`,
          });
        }
        throw error;
      }
    })();
    this.historyHydrations.set(threadId, hydration);
    void hydration.finally(() => {
      if (this.historyHydrations.get(threadId) === hydration) this.historyHydrations.delete(threadId);
    }).catch(() => undefined);
    return hydration;
  }

  async refreshCompleteHistory(threadId: string): Promise<void> {
    const existing = this.historyHydrations.get(threadId);
    if (existing) await existing.catch(() => undefined);
    this.host.requireRuntime(threadId).fullHistoryHydrated = false;
    await this.hydrateCompleteHistory(threadId);
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

  private mergeHistoryPage(
    threadId: string,
    turns: readonly v2.Turn[],
    newTurnIds: ReadonlySet<string>,
  ): SurfaceMessage[] {
    const current = this.host.runtime(threadId);
    if (!current) return [];
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
    const historyMessages = preserveHistoricalAttachmentPreviews(
      current.messages,
      historicalTurns.flatMap((turn) => codexTurnToSurfaceMessages(threadId, turn)),
    );
    const messages = historyMessages;
    this.host.patchRuntime(threadId, {
      turnIds: [...historicalTurns.map((turn) => turn.id), ...preservedTurnIds],
      messages: [...messages, ...preservedMessages],
    });
    const turnCount = this.host.requireRuntime(threadId).turnIds.length;
    const state = this.host.getState();
    this.host.patch({
      conversations: state.conversations.map((conversation) => conversation.id === threadId
        ? { ...conversation, turnCount }
        : conversation),
    });
    const summary = this.host.getState().conversations.find((conversation) => conversation.id === threadId);
    if (summary) this.host.emitSummaryUpserted(summary, 'updated', 'action');
    return historyMessages.filter((message) => message.turnId !== undefined && newTurnIds.has(message.turnId));
  }

  private summaryWithKnownTurnCount(thread: v2.Thread): CodexConversationSummary {
    const summary = threadToSummary(thread);
    const runtime = this.host.runtime(thread.id);
    if (runtime?.hydrated) return { ...summary, turnCount: runtime.turnIds.length };
    const existing = this.host.getState().conversations.find((conversation) => conversation.id === thread.id);
    return existing ? { ...summary, turnCount: existing.turnCount } : summary;
  }
}

function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
