import type { CodexAppServerClient, ServerNotification, v2 } from '../codex/index';
import type { CodexSurfaceSnapshot } from '@codex-app-sdk/core/surface';
import type {
  CodexGeneratedText,
  GenerateCodexTextOptions,
} from './codex-surface-contracts';
import {
  defaultReasoningEffort,
  requireCatalogModel,
  selectedModel,
  validateReasoningEffort,
  validateServiceTier,
} from './codex-surface-settings';

const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;

type PendingGeneration = {
  readonly promise: Promise<CodexGeneratedText>;
  readonly resolve: (result: CodexGeneratedText) => void;
  readonly reject: (error: Error) => void;
  readonly texts: string[];
  settled: boolean;
  turnId: string | null;
};

export type CodexSurfaceTextGenerationHost = {
  ensureConnected(): Promise<void>;
  getSnapshot(): CodexSurfaceSnapshot;
};

/** Runs isolated, non-persisted text turns without projecting them into surface state. */
export class CodexSurfaceTextGenerationController {
  private readonly hiddenThreadIds = new Set<string>();
  private readonly pendingByThread = new Map<string, PendingGeneration>();

  constructor(
    private readonly client: CodexAppServerClient,
    private readonly defaultCwd: string | undefined,
    private readonly host: CodexSurfaceTextGenerationHost,
  ) {}

  /** Returns true when a notification belongs to an ephemeral thread and must stay hidden. */
  handleNotification(notification: ServerNotification): boolean {
    if (notification.method === 'thread/started' && notification.params.thread.ephemeral) {
      this.hiddenThreadIds.add(notification.params.thread.id);
    }
    const threadId = notificationThreadId(notification);
    if (!threadId || !this.hiddenThreadIds.has(threadId)) return false;

    const pending = this.pendingByThread.get(threadId);
    if (pending) this.consumeNotification(pending, notification);
    if (notification.method === 'thread/closed' || notification.method === 'thread/deleted') {
      this.hiddenThreadIds.delete(threadId);
    }
    return true;
  }

  async generate(prompt: string, options: GenerateCodexTextOptions = {}): Promise<CodexGeneratedText> {
    const text = prompt.trim();
    if (!text) throw new Error('Generation prompt cannot be empty');
    if (options.signal?.aborted) throw abortedError();
    await this.host.ensureConnected();

    const state = this.host.getSnapshot();
    const currentModel = selectedModel(state.models, state.selectedModelId);
    const requestedModel = options.model ? requireCatalogModel(state.models, options.model) : currentModel;
    const model = requestedModel?.model;
    const reasoningEffort = options.reasoningEffort
      ?? (requestedModel?.id === currentModel?.id
        ? state.selectedReasoningEffort
        : requestedModel ? defaultReasoningEffort(requestedModel) : null)
      ?? undefined;
    const serviceTier = options.serviceTier !== undefined
      ? options.serviceTier
      : requestedModel?.id === currentModel?.id
        ? state.selectedServiceTier
        : requestedModel?.defaultServiceTier ?? null;
    validateReasoningEffort(requestedModel, reasoningEffort);
    validateServiceTier(requestedModel, serviceTier);

    const started = await this.client.request('thread/start', {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      ...(options.baseInstructions === undefined ? {} : { baseInstructions: options.baseInstructions }),
      ...(options.developerInstructions === undefined
        ? {}
        : { developerInstructions: options.developerInstructions }),
      cwd: options.cwd ?? this.defaultCwd,
      dynamicTools: [],
      environments: [],
      ephemeral: true,
      ...(model ? { model } : {}),
      permissions: ':read-only',
      ...(serviceTier === undefined ? {} : { serviceTier }),
      serviceName: 'codex_app_sdk',
      threadSource: 'sdk_ephemeral_generation',
    });
    const threadId = started.thread.id;
    if (!started.thread.ephemeral) {
      await this.client.request('thread/delete', { threadId }).catch(() => undefined);
      throw new Error('Codex app-server did not create an ephemeral generation thread');
    }
    this.hiddenThreadIds.add(threadId);
    if (options.signal?.aborted) {
      await this.client.request('thread/unsubscribe', { threadId }).catch(() => undefined);
      this.hiddenThreadIds.delete(threadId);
      throw abortedError();
    }
    const pending = createPendingGeneration();
    this.pendingByThread.set(threadId, pending);
    let turnId: string | null = null;
    let completed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const abort = () => pending.reject(abortedError());
    options.signal?.addEventListener('abort', abort, { once: true });

    try {
      timeout = setTimeout(() => {
        pending.reject(new Error('Codex ephemeral generation timed out'));
      }, options.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS);
      const turnResponse = await this.client.request('turn/start', {
        threadId,
        input: [{ type: 'text', text, text_elements: [] }],
        environments: [],
        permissions: ':read-only',
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { effort: reasoningEffort as v2.TurnStartParams['effort'] } : {}),
        ...(serviceTier === undefined ? {} : { serviceTier }),
        ...(options.outputSchema === undefined
          ? {}
          : { outputSchema: options.outputSchema as v2.TurnStartParams['outputSchema'] }),
      });
      turnId = turnResponse.turn.id;
      pending.turnId = turnId;
      if (turnResponse.turn.status !== 'inProgress') {
        completeFromTurn(pending, turnResponse.turn);
      }
      const result = await pending.promise;
      completed = true;
      return result;
    } finally {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      this.pendingByThread.delete(threadId);
      if (!completed && turnId) {
        await this.client.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
      }
      await this.client.request('thread/unsubscribe', { threadId }).catch(() => undefined);
      this.hiddenThreadIds.delete(threadId);
    }
  }

  close(error = new Error('Codex surface closed')): void {
    for (const pending of this.pendingByThread.values()) pending.reject(error);
    this.pendingByThread.clear();
    this.hiddenThreadIds.clear();
  }

  private consumeNotification(pending: PendingGeneration, notification: ServerNotification): void {
    if (notification.method === 'item/completed') {
      if (pending.turnId && notification.params.turnId !== pending.turnId) return;
      if (!pending.turnId) pending.turnId = notification.params.turnId;
      if (notification.params.item.type === 'agentMessage') {
        const text = notification.params.item.text.trim();
        if (text) pending.texts.push(text);
      }
      return;
    }
    if (notification.method === 'error') {
      if (pending.turnId && notification.params.turnId !== pending.turnId) return;
      if (!notification.params.willRetry) pending.reject(new Error(notification.params.error.message));
      return;
    }
    if (notification.method === 'turn/completed') {
      if (pending.turnId && notification.params.turn.id !== pending.turnId) return;
      completeFromTurn(pending, notification.params.turn);
    }
  }
}

function createPendingGeneration(): PendingGeneration {
  let resolvePromise!: (result: CodexGeneratedText) => void;
  let rejectPromise!: (error: Error) => void;
  const pending: PendingGeneration = {
    promise: new Promise<CodexGeneratedText>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve: (result) => {
      if (pending.settled) return;
      pending.settled = true;
      resolvePromise(result);
    },
    reject: (error) => {
      if (pending.settled) return;
      pending.settled = true;
      rejectPromise(error);
    },
    texts: [],
    settled: false,
    turnId: null,
  };
  // The turn/start RPC may still be in flight when an abort, disconnect, or
  // timeout rejects completion. Mark the promise handled until generate awaits it.
  void pending.promise.catch(() => undefined);
  return pending;
}

function completeFromTurn(pending: PendingGeneration, turn: v2.Turn): void {
  for (const item of turn.items) {
    if (item.type !== 'agentMessage') continue;
    const text = item.text.trim();
    if (text) pending.texts.push(text);
  }
  if (turn.status === 'failed') {
    pending.reject(new Error(turn.error?.message ?? 'Codex ephemeral generation failed'));
    return;
  }
  if (turn.status === 'interrupted') {
    pending.reject(new Error('Codex ephemeral generation was interrupted'));
    return;
  }
  if (turn.status !== 'completed') return;
  const text = pending.texts.at(-1);
  if (!text) {
    pending.reject(new Error('Codex ephemeral generation returned no text'));
    return;
  }
  pending.resolve({ text });
}

function notificationThreadId(notification: ServerNotification): string | null {
  if (notification.method === 'thread/started') return notification.params.thread.id;
  const params = notification.params as { threadId?: unknown };
  return typeof params.threadId === 'string' ? params.threadId : null;
}

function abortedError(): Error {
  return new Error('Codex ephemeral generation was aborted');
}
