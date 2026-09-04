import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMessageId,
  createQueuedPromptId,
  sameValue,
  surfaceTurnError,
  threadItemKey,
  timestampToIso,
  timestampToIsoOrNull,
} from '../src/node/codex-surface-events';

describe('Codex surface event values', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('builds collision-safe thread item keys with the exact separator', () => {
    expect(threadItemKey('thread', 'item')).toBe('thread\u0000item');
    expect(threadItemKey('thread-a', 'b')).not.toBe(threadItemKey('thread', 'a-b'));
  });

  it('maps finite protocol timestamps expressed in seconds', () => {
    expect(timestampToIso(1.5)).toBe('1970-01-01T00:00:01.500Z');
    expect(timestampToIsoOrNull(-1)).toBe('1969-12-31T23:59:59.000Z');
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'uses the current time for invalid required timestamp %s',
    (timestamp) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-01T12:34:56.789Z'));
      expect(timestampToIso(timestamp)).toBe('2026-08-01T12:34:56.789Z');
    },
  );

  it.each([null, undefined, Number.NaN, Number.NEGATIVE_INFINITY])(
    'maps invalid optional timestamp %s to null',
    (timestamp) => {
      expect(timestampToIsoOrNull(timestamp)).toBeNull();
    },
  );

  it('projects every turn error field and preserves an explicit null', () => {
    const codexErrorInfo = { httpConnectionFailed: { httpStatusCode: 503 } };
    expect(surfaceTurnError(null)).toBeNull();
    expect(surfaceTurnError({
      message: 'Stopped', additionalDetails: 'Details', codexErrorInfo, misalignment: null,
    })).toStrictEqual({
      message: 'Stopped', additionalDetails: 'Details', codexErrorInfo,
    });
  });

  it('compares values using the serialized event contract', () => {
    expect(sameValue({ value: 1, nested: ['a'] }, { value: 1, nested: ['a'] })).toBe(true);
    expect(sameValue({ value: 1 }, { value: 2 })).toBe(false);
    expect(sameValue({ first: 1, second: 2 }, { second: 2, first: 1 })).toBe(false);
  });

  it('prefixes generated message and queue ids without changing the UUID', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
    expect(createMessageId()).toBe('user-00000000-0000-4000-8000-000000000001');
    expect(createQueuedPromptId()).toBe('queued-prompt-00000000-0000-4000-8000-000000000002');
  });
});
