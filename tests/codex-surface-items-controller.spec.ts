import { describe, expect, it, vi } from 'vitest';
import type { CodexSurfaceSnapshot, SurfaceMessage } from '../src/surface';
import {
  CodexSurfaceItemsController,
  type CodexSurfaceItemsHost,
} from '../packages/backend/src/node/codex-surface-items-controller';
import {
  createThreadRuntime,
  initialSurfaceSnapshot,
  type ThreadRuntimeState,
} from '../packages/backend/src/node/codex-surface-runtime';
import { initialAuthentication } from '../packages/backend/src/node/codex-surface-authentication';

describe('CodexSurfaceItemsController', () => {
  it('emits append, delta, and replacement events for completed agent text', () => {
    const setup = itemController();

    setup.controller.applyItem(item('agentMessage', { id: 'agent-1', text: 'Hello' }), true);
    setup.controller.applyItem(item('agentMessage', { id: 'agent-1', text: 'Hello world' }), true);
    setup.controller.applyItem(item('agentMessage', { id: 'agent-1', text: 'Replacement' }), true);

    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'message.appended',
    }));
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'message.delta', payload: expect.objectContaining({ delta: ' world' }),
    }));
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'message.updated',
    }));
  });

  it('handles empty agent/review text and plan lifecycle boundaries', () => {
    const setup = itemController();
    setup.controller.applyItem(item('agentMessage', { id: 'empty-agent', text: '' }), true);
    setup.controller.applyItem(item('exitedReviewMode', { id: 'empty-review', review: '' }), true);
    setup.controller.applyItem(item('plan', { id: 'plan-1', text: 'draft' }), false);
    expect(setup.host.emitEvent).not.toHaveBeenCalled();

    setup.runtime.planMarkdownByTurn.set('turn-1', 'streamed plan');
    setup.controller.applyItem(item('plan', { id: 'plan-1', text: '  ' }), true);
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'plan.completed', payload: { itemId: 'plan-1', markdown: 'streamed plan' },
    }));
  });

  it('renders exitedReviewMode once and ignores its derived final agentMessage', () => {
    const setup = itemController();
    const review = 'The review found one issue.';
    setup.controller.applyItem(item('exitedReviewMode', {
      id: 'review-1', review,
    }), false);
    setup.controller.applyItem(item('exitedReviewMode', {
      id: 'review-1', review,
    }), true);
    setup.controller.applyItem(item('agentMessage', {
      id: 'agent-review', text: review, phase: null,
    }), false);
    setup.controller.applyItem(item('agentMessage', {
      id: 'agent-review', text: review, phase: null,
    }), true);

    const assistant = setup.runtime.messages.find((message) => message.role === 'assistant');
    expect(assistant?.parts).toStrictEqual([{ type: 'text', text: review, itemId: 'review-1' }]);
    expect(setup.host.emitEvent).toHaveBeenCalledTimes(1);
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'message.appended',
    }));
  });

  it('collapses duplicated initial user items from an app-server review turn', () => {
    const setup = itemController();
    const prompt = 'Review the current code changes and provide prioritized findings.';

    setup.controller.applyItem(item('userMessage', {
      id: 'review-user-1', clientId: null, content: [{ type: 'text', text: prompt }],
    }), true);
    setup.controller.applyItem(item('userMessage', {
      id: 'review-user-2', clientId: null, content: [{ type: 'text', text: prompt }],
    }), true);

    expect(setup.runtime.messages).toHaveLength(1);
    expect(setup.runtime.messages[0]?.parts).toStrictEqual([{ type: 'text', text: prompt }]);
    expect(setup.host.emitEvent).toHaveBeenCalledTimes(1);
  });

  it('emits both phases of context compaction', () => {
    const setup = itemController();
    setup.controller.applyItem(item('contextCompaction', { id: 'compact-1' }), false);
    setup.controller.applyItem(item('contextCompaction', { id: 'compact-1' }), true);
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'context.compactionStarted',
    }));
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'context.compactionCompleted',
    }));
  });

  it('tracks command-output forwarding only for file-writing commands', () => {
    const setup = itemController();
    expect(setup.controller.shouldForwardCommandOutput('thread-1', false, { type: 'plan' } as never)).toBe(false);
    expect(setup.controller.shouldForwardCommandOutput('thread-1', false, {
      type: 'commandExecution', id: 'read', command: 'ls',
    } as never)).toBe(false);
    expect(setup.controller.shouldForwardCommandOutput('thread-1', false, {
      type: 'commandExecution', id: 'write', command: "printf test > file.txt",
    } as never)).toBe(true);
    expect(setup.controller.isForwardingCommandOutput('thread-1', 'write')).toBe(true);
    expect(setup.controller.shouldForwardCommandOutput('thread-1', true, {
      type: 'commandExecution', id: 'write', command: 'ls',
    } as never)).toBe(true);
    expect(setup.controller.isForwardingCommandOutput('thread-1', 'write')).toBe(false);
    setup.controller.reset();
  });

  it('updates tool state and suppresses events when no containing message exists', () => {
    const setup = itemController();
    setup.controller.applyToolUpdate('thread-1', 'turn-1', {
      itemId: 'missing', bodyDelta: 'output',
    });
    expect(setup.host.emitEvent).not.toHaveBeenCalled();

    setup.runtime.messages = [assistant([{ type: 'tool', id: 'tool-1', title: 'Tool', status: 'running' }])];
    setup.controller.applyToolUpdate('thread-1', 'turn-1', { itemId: 'tool-1', status: 'completed' });
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'tool.updated', payload: expect.objectContaining({ update: { itemId: 'tool-1', status: 'completed' } }),
    }));
  });
});

function itemController() {
  const state = initialSurfaceSnapshot(initialAuthentication());
  const runtime = createThreadRuntime('thread-1', state);
  const host: CodexSurfaceItemsHost = {
    assistantMessageForTurn: (_threadId, turnId) => runtime.messages.find((message) => (
      message.role === 'assistant' && message.metadata?.turnId === turnId
    )) ?? null,
    emitConversationActivity: vi.fn(),
    emitEvent: vi.fn(),
    emitSummaryUpserted: vi.fn(),
    getState: () => state,
    markRuntimeTurnActive: vi.fn((target: ThreadRuntimeState, turnId: string) => {
      target.activeTurnId = turnId;
    }),
    messageContainingTool: (_threadId, turnId, itemId) => runtime.messages.find((message) => (
      message.metadata?.turnId === turnId
      && message.parts.some((part) => part.type === 'tool' && part.id === itemId)
    )) ?? null,
    patch: vi.fn((patch: Partial<CodexSurfaceSnapshot>) => Object.assign(state, patch)),
    patchRuntime: vi.fn((_threadId, patch) => Object.assign(runtime, patch)),
    requireRuntime: () => runtime,
    sendNextQueuedPrompt: vi.fn(),
  };
  return { controller: new CodexSurfaceItemsController(host), host, runtime, state };
}

function item(type: string, value: Record<string, unknown>) {
  return {
    threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 1_000,
    item: { type, ...value },
  } as never;
}

function assistant(parts: SurfaceMessage['parts']): SurfaceMessage {
  return {
    id: 'assistant-turn-1', role: 'assistant', status: 'streaming', parts,
    metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
  };
}
