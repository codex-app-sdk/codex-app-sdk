import type { v2 } from '../codex/index';
import type { CodexSurfaceEvent, CodexSurfaceJsonValue, CodexSurfaceTurnError } from '../surface/types';

export type SurfaceEventInput = CodexSurfaceEvent extends infer Event
  ? Event extends CodexSurfaceEvent
    ? Omit<Event, 'seq' | 'occurredAt' | 'origin'>
    : never
  : never;

export function threadItemKey(threadId: string, itemId: string): string {
  return `${threadId}\u0000${itemId}`;
}

export function timestampToIso(timestamp: number | null | undefined): string {
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000).toISOString()
    : new Date().toISOString();
}

export function timestampToIsoOrNull(timestamp: number | null | undefined): string | null {
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(timestamp * 1000).toISOString()
    : null;
}

export function surfaceTurnError(error: v2.TurnError | null): CodexSurfaceTurnError | null {
  if (!error) return null;
  return {
    message: error.message,
    additionalDetails: error.additionalDetails,
    codexErrorInfo: error.codexErrorInfo as CodexSurfaceJsonValue | null,
  };
}

export function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createMessageId(): string {
  return `user-${globalThis.crypto.randomUUID()}`;
}

export function createQueuedPromptId(): string {
  return `queued-prompt-${globalThis.crypto.randomUUID()}`;
}
