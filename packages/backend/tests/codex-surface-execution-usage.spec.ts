import { describe, expect, it } from 'vitest';
import { CodexAppServerClient, type v2 } from '../src/codex';
import { CodexSurface } from '../src/node';
import type { CodexSurfaceEvent } from '@codex-app-sdk/core/surface';
import { MockCodexAppServer, turn } from './helpers/codex-surface-fixture';

const baseline: v2.TokenUsageBreakdown = {
  totalTokens: 100, inputTokens: 60, cachedInputTokens: 20, cacheWriteInputTokens: 5,
  outputTokens: 40, reasoningOutputTokens: 10,
};
const total: v2.TokenUsageBreakdown = {
  totalTokens: 160, inputTokens: 100, cachedInputTokens: 30, cacheWriteInputTokens: 8,
  outputTokens: 60, reasoningOutputTokens: 15,
};
const last: v2.TokenUsageBreakdown = {
  totalTokens: 20, inputTokens: 15, cachedInputTokens: 5, cacheWriteInputTokens: 1,
  outputTokens: 5, reasoningOutputTokens: 1,
};
const execution = {
  totalTokens: 60, inputTokens: 40, cachedInputTokens: 10, cacheWriteInputTokens: 3,
  outputTokens: 20, reasoningOutputTokens: 5,
};

async function setup() {
  let nextTurn = 0;
  const transport = new MockCodexAppServer({ 'turn/start': () => ({ turn: turn(`turn-${++nextTurn}`, 'inProgress', []) }) });
  const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
  const events: CodexSurfaceEvent[] = [];
  surface.onEvent(event => events.push(event));
  await surface.connect();
  return { surface, events, transport };
}

function usage(transport: MockCodexAppServer, turnId: string, counts = total) {
  transport.emitNotification('thread/tokenUsage/updated', {
    threadId: 'thread-existing', turnId, tokenUsage: { total: counts, last, modelContextWindow: 2000 },
  });
}

describe('CodexSurface execution usage', () => {
  it('does not use counters already containing a new turn as that turn’s starting baseline', async () => {
    const { surface, transport, events } = await setup();
    try {
      usage(transport, 'turn-history', baseline);
      usage(transport, 'turn-1');
      await surface.sendMessage('Start response arrived after usage');
      usage(transport, 'turn-1', { ...total, totalTokens: 170, outputTokens: 70 });
      expect(events.filter(event => event.type === 'conversation.executionUsageChanged').at(-1)?.payload.usage)
        .toMatchObject({ observedStart: true, execution: null });
    } finally { await surface.close(); }
  });

  it('preserves absent cache-write evidence on older packets and invalidates synthetic context-only counters', async () => {
    const { surface, transport, events } = await setup();
    const legacy = ({ totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }: v2.TokenUsageBreakdown) =>
      ({ totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens });
    const emit = (turnId: string, counts: v2.TokenUsageBreakdown) => transport.emitRaw({
      method: 'thread/tokenUsage/updated', params: {
        threadId: 'thread-existing', turnId,
        tokenUsage: { total: legacy(counts), last: legacy(last), modelContextWindow: 2000 },
      },
    });
    try {
      emit('turn-history', baseline);
      await surface.sendMessage('Legacy usage');
      emit('turn-1', total);
      expect(surface.getSnapshot().turns.find(item => item.id === 'turn-1')?.executionUsage)
        .toStrictEqual({ last: { ...last, cacheWriteInputTokens: null }, total: { ...total, cacheWriteInputTokens: null }, execution: { ...execution, cacheWriteInputTokens: null }, model: null, observedStart: true });
      usage(transport, 'turn-1', { totalTokens: 2000, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 });
      expect(events.filter(event => event.type === 'conversation.executionUsageChanged').at(-1)?.payload.usage.execution).toBeNull();
    } finally { await surface.close(); }
  });

  it('replaces live cumulative usage from a known baseline, preserving terminal and late samples without inventing a model', async () => {
    const { surface, transport, events } = await setup();
    try {
      usage(transport, 'turn-history', baseline);
      await surface.sendMessage('First');
      usage(transport, 'turn-1');
      usage(transport, 'turn-1');
      const samples = events.filter(event => event.type === 'conversation.executionUsageChanged');
      expect(samples.map(event => event.payload.usage)).toStrictEqual([
        { last, total: baseline, execution: null, model: null, observedStart: false },
        { last, total, execution, model: null, observedStart: true },
        { last, total, execution, model: null, observedStart: true },
      ]);
      transport.emitNotification('model/rerouted', {
        threadId: 'thread-existing', turnId: 'turn-1', fromModel: 'gpt-5', toModel: 'gpt-mini', reason: 'highRiskCyberActivity',
      });
      expect(events.find(event => event.type === 'turn.modelRerouted')).toMatchObject({
        conversationId: 'thread-existing', turnId: 'turn-1',
        payload: { fromModel: 'gpt-5', toModel: 'gpt-mini', reason: 'highRiskCyberActivity' },
      });
      transport.emitNotification('turn/completed', { threadId: 'thread-existing', turn: turn('turn-1', 'completed', []) });
      expect(events.find(event => event.type === 'turn.completed')).toMatchObject({
        turnId: 'turn-1', payload: { executionUsage: { last, total, execution, model: null } },
      });
      usage(transport, 'turn-1', { ...total, totalTokens: 170, outputTokens: 70 });
      expect(surface.getSnapshot().turns.find(item => item.id === 'turn-1')?.executionUsage?.execution)
        .toStrictEqual({ ...execution, totalTokens: 70, outputTokens: 30 });
    } finally { await surface.close(); }
  });

  it('keeps missing baselines, counter resets and history replays unavailable instead of adding last-request counts', async () => {
    const { surface, transport, events } = await setup();
    try {
      await surface.sendMessage('No baseline');
      usage(transport, 'turn-1');
      transport.emitNotification('turn/completed', { threadId: 'thread-existing', turn: turn('turn-1', 'completed', []) });
      await surface.sendMessage('Known baseline');
      usage(transport, 'turn-2', { ...total, totalTokens: 170, outputTokens: 70 });
      expect(surface.getSnapshot().turns.find(item => item.id === 'turn-2')?.executionUsage?.execution)
        .toStrictEqual({ totalTokens: 10, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0 });
      usage(transport, 'turn-2', baseline);
      usage(transport, 'turn-2', total);
      transport.emitNotification('turn/completed', { threadId: 'thread-existing', turn: turn('turn-2', 'completed', []) });
      await surface.selectConversation('thread-existing');
      usage(transport, 'turn-history');
      const samples = events.filter(event => event.type === 'conversation.executionUsageChanged');
      expect(samples.map(event => event.payload.usage.execution)).toStrictEqual([
        null, { totalTokens: 10, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0 },
        null, null, null,
      ]);
      expect(events.filter(event => event.type === 'turn.completed').map(event => event.payload.executionUsage?.execution))
        .toStrictEqual([null, null]);
    } finally { await surface.close(); }
  });

  it('does not attribute a late older-turn increase to a newer execution', async () => {
    const { surface, transport, events } = await setup();
    try {
      usage(transport, 'turn-history', baseline);
      await surface.sendMessage('First');
      usage(transport, 'turn-1');
      transport.emitNotification('thread/status/changed', { threadId: 'thread-existing', status: { type: 'idle' } });
      await surface.sendMessage('Second');
      usage(transport, 'turn-2', { ...total, totalTokens: 170, outputTokens: 70 });
      usage(transport, 'turn-1', { ...total, totalTokens: 180, outputTokens: 80 });
      transport.emitNotification('turn/completed', { threadId: 'thread-existing', turn: turn('turn-1', 'completed', []) });
      expect(surface.getSnapshot().activeTurnId).toBe('turn-2');
      usage(transport, 'turn-2', { ...total, totalTokens: 190, outputTokens: 90 });
      const current = events.filter(event => event.type === 'conversation.executionUsageChanged').filter(event => event.turnId === 'turn-2');
      expect(current.at(-1)?.payload.usage.execution).toBeNull();
      transport.emitNotification('turn/completed', { threadId: 'thread-existing', turn: turn('turn-2', 'completed', []) });
      expect(events.filter(event => event.type === 'turn.completed').at(-1)).toMatchObject({
        turnId: 'turn-2', payload: { executionUsage: { execution: null } },
      });
    } finally { await surface.close(); }
  });
});
