import { describe, expect, it } from 'vitest';
import type { v2 } from '../src/codex';
import type {
  CodexConversationSummary,
  CodexSurfaceModel,
  CodexSurfaceRateLimitSnapshot,
  CodexSurfaceSnapshot,
} from '../src/surface';
import {
  attachmentInput,
  conversationStatus,
  mergeRateLimitSnapshot,
  mergeSurfaceRateLimits,
  surfaceAttachmentPart,
  surfaceContextUsage,
  surfaceRateLimits,
  surfaceThreadStatus,
  threadToSummary,
  upsertConversation,
  validateAttachments,
  validatedSendOptions,
} from '../src/node/codex-surface-data';

describe('Codex surface data codecs', () => {
  it('summarizes thread titles, timestamps, status, and recency', () => {
    expect(threadToSummary(thread({ name: '  Named  ', status: { type: 'active', activeFlags: [] } })))
      .toMatchObject({ title: 'Named', preview: 'First line\nsecond', status: 'active', turnCount: 1 });
    expect(threadToSummary(thread({ name: null, status: { type: 'systemError' }, recencyAt: null })))
      .toMatchObject({ title: 'First line', status: 'error', updatedAt: '2026-01-01T00:00:02.000Z' });
    expect(threadToSummary(thread({ name: ' ', preview: ' ', status: { type: 'idle' } })))
      .toMatchObject({ title: 'Untitled conversation', status: 'idle' });
  });

  it('upserts one conversation and sorts the result by recency', () => {
    const old = summary('same', '2026-01-01T00:00:01.000Z');
    const other = summary('other', '2026-01-01T00:00:03.000Z');
    const replacement = summary('same', '2026-01-01T00:00:02.000Z');
    expect(upsertConversation([old, other], replacement)).toStrictEqual([other, replacement]);
  });

  it('normalizes explicit model and attachment send options', () => {
    const state = snapshot([{ id: 'catalog-id', model: 'server-model', displayName: 'Model',
      supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }] }]);
    expect(validatedSendOptions(state, {
      model: 'catalog-id',
      reasoningEffort: 'medium',
      attachments: [
        { type: 'file', path: ' /tmp/file.txt ', name: ' Notes ' },
        { type: 'image', path: ' /tmp/image.png ', detail: 'high' },
      ],
    })).toStrictEqual({
      model: 'server-model',
      reasoningEffort: 'medium',
      attachments: [
        { type: 'file', path: '/tmp/file.txt', name: 'Notes' },
        { type: 'image', path: '/tmp/image.png', detail: 'high' },
      ],
    });
    expect(validatedSendOptions(state, {})).toStrictEqual({});
    expect(() => validatedSendOptions(state, { model: 'missing' })).toThrow("Unknown model 'missing'");
    expect(() => validatedSendOptions(state, { reasoningEffort: 'high' }))
      .toThrow("Reasoning effort 'high' is not available");
  });

  it('rejects blank and relative attachment paths and preserves blank file names', () => {
    expect(() => validateAttachments([{ type: 'file', path: ' ' }])).toThrow('paths cannot be empty');
    expect(() => validateAttachments([{ type: 'image', path: 'relative.png' }]))
      .toThrow("must be absolute: 'relative.png'");
    expect(validateAttachments([{ type: 'file', path: '/tmp/file.txt', name: ' ' }]))
      .toStrictEqual([{ type: 'file', path: '/tmp/file.txt', name: ' ' }]);
  });

  it('encodes file and image attachments for app-server input', () => {
    expect(attachmentInput({ type: 'file', path: '/tmp/file.txt' })).toStrictEqual({
      type: 'mention', name: 'file.txt', path: '/tmp/file.txt',
    });
    expect(attachmentInput({ type: 'file', path: '/tmp/file.txt', name: 'Notes' })).toStrictEqual({
      type: 'mention', name: 'Notes', path: '/tmp/file.txt',
    });
    expect(attachmentInput({ type: 'image', path: '/tmp/image.png' })).toStrictEqual({
      type: 'localImage', path: '/tmp/image.png',
    });
    expect(attachmentInput({ type: 'image', path: '/tmp/image.png', detail: 'original' })).toStrictEqual({
      type: 'localImage', path: '/tmp/image.png', detail: 'original',
    });
  });

  it('renders file and image attachment message parts', () => {
    expect(surfaceAttachmentPart({ type: 'file', path: '/tmp/file.txt', name: ' Notes ', mimeType: 'text/plain' }))
      .toStrictEqual({ type: 'attachment', attachment: {
        kind: 'file', name: 'Notes', path: '/tmp/file.txt', mimeType: 'text/plain',
      } });
    expect(surfaceAttachmentPart({ type: 'file', path: '/tmp/file.txt' })).toStrictEqual({
      type: 'attachment', attachment: { kind: 'file', name: 'file.txt', path: '/tmp/file.txt' },
    });
    expect(surfaceAttachmentPart({
      type: 'image', path: '/tmp/image.png', previewUrl: 'data:image/png;base64,AQ==', mimeType: 'image/png',
    })).toStrictEqual({ type: 'attachment', attachment: {
      kind: 'image', name: 'image.png', path: '/tmp/image.png',
      url: 'data:image/png;base64,AQ==', mimeType: 'image/png',
    } });
    expect(surfaceAttachmentPart({ type: 'image', path: '/tmp/image.png', name: 'Image' }))
      .toMatchObject({ attachment: { kind: 'image', name: 'Image', url: 'file:///tmp/image.png' } });
  });

  it('maps context usage and clamps percentages', () => {
    expect(surfaceContextUsage(tokenUsage(50, 200))).toMatchObject({ lastTotalTokens: 50, usedPercent: 25 });
    expect(surfaceContextUsage(tokenUsage(300, 200)).usedPercent).toBe(100);
    expect(surfaceContextUsage(tokenUsage(-10, 200)).usedPercent).toBe(0);
    expect(surfaceContextUsage(tokenUsage(10, null)).usedPercent).toBeNull();
    expect(surfaceContextUsage(tokenUsage(10, 0)).usedPercent).toBeNull();
  });

  it('maps thread and conversation statuses', () => {
    expect(surfaceThreadStatus({ type: 'active', activeFlags: ['waitingOnApproval'] })).toStrictEqual({
      type: 'active', activeFlags: ['waitingOnApproval'],
    });
    expect(surfaceThreadStatus({ type: 'idle' })).toStrictEqual({ type: 'idle' });
    expect(conversationStatus({ type: 'active', activeFlags: [] })).toBe('active');
    expect(conversationStatus({ type: 'systemError' })).toBe('error');
    expect(conversationStatus({ type: 'notLoaded' })).toBe('idle');
  });

  it('maps single and multi-bucket rate limit responses', () => {
    const codex = rateSnapshot({ limitId: 'codex', primary: { usedPercent: 20, windowDurationMins: 60, resetsAt: 10 } });
    expect(surfaceRateLimits({
      rateLimits: codex,
      rateLimitsByLimitId: { codex, missing: undefined },
      rateLimitResetCredits: { availableCount: 3, credits: [{ resetAt: 10, amount: '2' }] },
    } as unknown as v2.GetAccountRateLimitsResponse)).toMatchObject({
      rateLimits: { limitId: 'codex', primary: { usedPercent: 20 } },
      rateLimitsByLimitId: { codex: { limitId: 'codex' } },
      rateLimitResetCredits: { availableCount: '3', credits: [{ resetAt: 10, amount: '2' }] },
    });
    expect(surfaceRateLimits({
      rateLimits: rateSnapshot(), rateLimitsByLimitId: null,
      rateLimitResetCredits: { availableCount: 0, credits: null },
    } as unknown as v2.GetAccountRateLimitsResponse)).toMatchObject({
      rateLimitsByLimitId: null,
      rateLimitResetCredits: { availableCount: '0', credits: null },
    });
    expect(surfaceRateLimits({
      rateLimits: rateSnapshot(), rateLimitsByLimitId: null, rateLimitResetCredits: null,
    }).rateLimitResetCredits).toBeNull();
  });

  it('merges partial rate limit snapshots without erasing known fields', () => {
    const current = surfaceRateLimits({
      rateLimits: rateSnapshot({
        limitId: 'codex', limitName: 'Codex',
        primary: { usedPercent: 10, windowDurationMins: 60, resetsAt: 10 },
        credits: { hasCredits: true, unlimited: false, balance: '10' },
      }),
      rateLimitsByLimitId: null,
      rateLimitResetCredits: null,
    });
    const merged = mergeSurfaceRateLimits(current, rateSnapshot({
      limitId: 'codex',
      primary: { usedPercent: 30, windowDurationMins: 60, resetsAt: 20 },
      secondary: { usedPercent: 5, windowDurationMins: 1_440, resetsAt: 30 },
    }));
    expect(merged).toMatchObject({
      rateLimits: {
        limitId: 'codex', limitName: 'Codex',
        primary: { usedPercent: 30, resetsAt: 20 },
        secondary: { usedPercent: 5 },
        credits: { balance: '10' },
      },
      rateLimitsByLimitId: { codex: { primary: { usedPercent: 30 } } },
    });

    expect(mergeSurfaceRateLimits(null, rateSnapshot({ limitId: 'codex' })).rateLimitsByLimitId)
      .toHaveProperty('codex');
    expect(mergeSurfaceRateLimits(null, rateSnapshot()).rateLimitsByLimitId).toBeNull();
    expect(mergeSurfaceRateLimits(current, rateSnapshot({ limitId: null })).rateLimitsByLimitId)
      .toHaveProperty('codex');
  });

  it('merges every snapshot sub-object and nullable identity field', () => {
    const current = surfaceRateLimitSnapshotFixture({
      primary: { usedPercent: 10 }, secondary: { usedPercent: 20 },
      credits: { balance: '1' }, individualLimit: { limit: '5' },
    });
    expect(mergeRateLimitSnapshot(current, surfaceRateLimitSnapshotFixture({
      limitId: 'new', limitName: 'New', primary: { resetsAt: 10 }, secondary: null,
      credits: { balance: '2' }, individualLimit: { used: '3' },
      planType: 'plus', rateLimitReachedType: 'primary',
    }))).toMatchObject({
      limitId: 'new', limitName: 'New',
      primary: { usedPercent: 10, resetsAt: 10 },
      secondary: { usedPercent: 20 },
      credits: { balance: '2' },
      individualLimit: { limit: '5', used: '3' },
      planType: 'plus', rateLimitReachedType: 'primary',
    });
  });
});

function thread(overrides: Record<string, unknown> = {}): v2.Thread {
  return {
    id: 'thread-1', name: null, preview: ' First line\nsecond ', cwd: '/tmp',
    status: { type: 'idle' }, turns: [{ id: 'turn-1' }],
    createdAt: 1_767_225_601, updatedAt: 1_767_225_602, recencyAt: 1_767_225_603,
    ...overrides,
  } as unknown as v2.Thread;
}

function summary(id: string, updatedAt: string): CodexConversationSummary {
  return { id, title: id, preview: '', cwd: '/tmp', status: 'idle', turnCount: 0,
    createdAt: updatedAt, updatedAt };
}

function snapshot(models: CodexSurfaceModel[]): CodexSurfaceSnapshot {
  return { models, selectedModelId: models[0]?.id ?? null } as CodexSurfaceSnapshot;
}

function tokenUsage(lastTotalTokens: number, modelContextWindow: number | null): v2.ThreadTokenUsage {
  const total = { totalTokens: 100, inputTokens: 60, cachedInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 10 };
  return { total, last: { ...total, totalTokens: lastTotalTokens }, modelContextWindow };
}

function rateSnapshot(overrides: Partial<v2.RateLimitSnapshot> = {}): v2.RateLimitSnapshot {
  return {
    limitId: null, limitName: null, primary: null, secondary: null,
    credits: null, individualLimit: null, planType: null, rateLimitReachedType: null,
    ...overrides,
  };
}

function surfaceRateLimitSnapshotFixture(
  overrides: Record<string, unknown> = {},
): CodexSurfaceRateLimitSnapshot {
  return {
    limitId: null, limitName: null, primary: null, secondary: null,
    credits: null, individualLimit: null, planType: null, rateLimitReachedType: null,
    ...overrides,
  } as CodexSurfaceRateLimitSnapshot;
}
