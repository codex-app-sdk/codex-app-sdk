import type {
  CodexSurfaceEvent, CodexSurfaceEventOrigin, CodexSurfaceExecutionUsage, CodexSurfaceTokenUsage,
} from '@codex-app-sdk/core/surface';

type EventInput = CodexSurfaceEvent extends infer Event
  ? Event extends CodexSurfaceEvent ? Omit<Event, 'seq' | 'occurredAt' | 'origin'> : never
  : never;
type Execution = { baseline: CodexSurfaceTokenUsage | null; latest: CodexSurfaceExecutionUsage | null };
type ThreadUsage = {
  total: CodexSurfaceTokenUsage | null;
  lastUsageTurnId: string | null;
  activeTurnId: string | null;
  executions: Map<string, Execution>;
};

/** Attributes provider counters only across locally observed execution boundaries. */
export class CodexSurfaceUsageController {
  private readonly threads = new Map<string, ThreadUsage>();

  clear(): void { this.threads.clear(); }

  observe(origin: CodexSurfaceEventOrigin, input: EventInput): EventInput {
    if (!('conversationId' in input)) return input;
    const id = input.conversationId;
    if (input.type === 'conversation.historyReplaced' || input.type === 'conversation.summaryRemoved') {
      this.threads.delete(id);
      return input;
    }
    if (input.type === 'turn.started' && origin !== 'lifecycle') {
      const thread = this.thread(id);
      if (!thread.executions.has(input.turnId)) {
        thread.executions.set(input.turnId, {
          baseline: thread.lastUsageTurnId === input.turnId ? null : thread.total, latest: null,
        });
      }
      thread.activeTurnId = input.turnId;
      return input;
    }
    if (input.type === 'turn.completed') {
      const thread = this.threads.get(id);
      if (thread?.activeTurnId === input.turnId) thread.activeTurnId = null;
      return { ...input, payload: { ...input.payload, executionUsage: structuredClone(thread?.executions.get(input.turnId)?.latest ?? null) } };
    }
    if (input.type !== 'conversation.executionUsageChanged') return input;

    const thread = this.thread(id);
    const record = thread.executions.get(input.turnId);
    const incoming = input.payload.usage;
    const overlapping = thread.activeTurnId !== null && thread.activeTurnId !== input.turnId;
    if (overlapping) {
      const active = thread.executions.get(thread.activeTurnId!);
      if (active) active.baseline = null;
      if (record) record.baseline = null;
    }
    if (record && (!validCounts(incoming.total)
      || (record.latest && !nondecreasing(record.latest.total, incoming.total)))) record.baseline = null;
    const execution = record?.baseline ? difference(record.baseline, incoming.total) : null;
    if (record && execution === null) record.baseline = null;
    const usage: CodexSurfaceExecutionUsage = { ...incoming, execution, observedStart: Boolean(record) };
    if (record) record.latest = structuredClone(usage);
    thread.total = !overlapping && validCounts(incoming.total) ? structuredClone(incoming.total) : null;
    thread.lastUsageTurnId = input.turnId;
    return { ...input, payload: { usage } };
  }

  private thread(id: string): ThreadUsage {
    let thread = this.threads.get(id);
    if (!thread) {
      thread = { total: null, lastUsageTurnId: null, activeTurnId: null, executions: new Map() };
      this.threads.set(id, thread);
    }
    return thread;
  }
}

const requiredCounts = ['totalTokens', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens'] as const;
function validCounts(usage: CodexSurfaceTokenUsage): boolean {
  return requiredCounts.every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0)
    && (usage.cacheWriteInputTokens === null || (Number.isSafeInteger(usage.cacheWriteInputTokens) && usage.cacheWriteInputTokens >= 0))
    && usage.totalTokens === usage.inputTokens + usage.outputTokens
    && usage.cachedInputTokens <= usage.inputTokens && usage.reasoningOutputTokens <= usage.outputTokens;
}

function nondecreasing(before: CodexSurfaceTokenUsage, after: CodexSurfaceTokenUsage): boolean {
  return requiredCounts.every(key => after[key] >= before[key])
    && (before.cacheWriteInputTokens === null || after.cacheWriteInputTokens === null
      || after.cacheWriteInputTokens >= before.cacheWriteInputTokens);
}

function difference(before: CodexSurfaceTokenUsage, after: CodexSurfaceTokenUsage): CodexSurfaceTokenUsage | null {
  if (!validCounts(before) || !validCounts(after) || !nondecreasing(before, after)) return null;
  const delta: CodexSurfaceTokenUsage = {
    totalTokens: after.totalTokens - before.totalTokens,
    inputTokens: after.inputTokens - before.inputTokens,
    cachedInputTokens: after.cachedInputTokens - before.cachedInputTokens,
    cacheWriteInputTokens: before.cacheWriteInputTokens === null || after.cacheWriteInputTokens === null
      ? null : after.cacheWriteInputTokens - before.cacheWriteInputTokens,
    outputTokens: after.outputTokens - before.outputTokens,
    reasoningOutputTokens: after.reasoningOutputTokens - before.reasoningOutputTokens,
  };
  return validCounts(delta) ? delta : null;
}
