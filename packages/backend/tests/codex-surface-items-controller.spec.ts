import { describe, expect, it, vi } from 'vitest';
import type { CodexSurfaceSnapshot, SurfaceMessage } from '@codex-app-sdk/core/surface';
import {
  CodexSurfaceItemsController,
  type CodexSurfaceItemsHost,
} from '../src/node/codex-surface-items-controller';
import {
  createThreadRuntime,
  initialSurfaceSnapshot,
  type ThreadRuntimeState,
} from '../src/node/codex-surface-runtime';
import { initialAuthentication } from '../src/node/codex-surface-authentication';

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

  it('reconciles a selected skill item with its optimistic user message without duplicating the skill', () => {
    const setup = itemController();
    setup.runtime.turnStartPending = true;
    setup.runtime.messages = [{
      id: 'optimistic-user', role: 'user', status: 'complete',
      createdAt: '2026-09-14T00:00:00.000Z',
      parts: [{ type: 'text', text: '$cp first' }],
      metadata: { conversationId: 'thread-1' },
    }];

    setup.controller.applyItem(item('userMessage', {
      id: 'provider-user', clientId: null,
      content: [
        { type: 'text', text: '$cp first', text_elements: [] },
        {
          type: 'skill',
          name: 'Commit-Push (cp)',
          path: '/skills/commit-push/SKILL.md',
        },
      ],
    }), true);

    expect(setup.runtime.messages).toStrictEqual([expect.objectContaining({
      id: 'optimistic-user', turnId: 'turn-1', parts: [{ type: 'text', text: '$cp first' }],
    })]);
    expect(setup.host.emitEvent).toHaveBeenCalledOnce();
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'message.updated', conversationId: 'thread-1', turnId: 'turn-1',
    }));
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

  it('applies agent deltas with exact routing, state, and event payload', () => {
    const setup = itemController();
    setup.controller.applyAgentDelta({
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'agent-1', delta: 'Hello',
    });

    expect(setup.host.markRuntimeTurnActive).toHaveBeenCalledWith(setup.runtime, 'turn-1');
    expect(setup.runtime).toMatchObject({ activeTurnId: 'turn-1' });
    expect(setup.runtime.messages).toMatchObject([{
      id: 'assistant-turn-1', role: 'assistant', status: 'streaming',
      parts: [{ type: 'text', text: 'Hello', itemId: 'agent-1' }],
      turnId: 'turn-1', createdAt: expect.any(String),
      metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
    }]);
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', {
      type: 'message.delta', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { messageId: 'assistant-turn-1', itemId: 'agent-1', delta: 'Hello' },
    });
  });

  it('uses the matching item phase when streaming a delta into an existing assistant message', () => {
    const setup = itemController();
    setup.runtime.messages = [assistant([
      { type: 'text', text: 'Decoy', itemId: 'other-agent', phase: 'final_answer' },
      { type: 'text', text: 'Checking', itemId: 'agent-1', phase: 'commentary' },
    ])];

    setup.controller.applyAgentDelta({
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'agent-1', delta: ' tests',
    });

    expect(setup.runtime.messages[0]?.parts).toStrictEqual([
      { type: 'text', text: 'Decoy', itemId: 'other-agent', phase: 'final_answer' },
      { type: 'text', text: 'Checking tests', itemId: 'agent-1', phase: 'commentary' },
    ]);
    expect(setup.host.emitEvent).toHaveBeenCalledExactlyOnceWith('notification', {
      type: 'message.delta', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        messageId: 'assistant-turn-1', itemId: 'agent-1', delta: ' tests', phase: 'commentary',
      },
    });
  });

  it('still applies agent deltas when the host cannot resolve their containing message', () => {
    const setup = itemController();
    vi.mocked(setup.host.assistantMessageForTurn).mockReturnValue(null);
    setup.controller.applyAgentDelta({
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'agent-1', delta: 'Hello',
    });
    expect(setup.runtime.messages[0]?.parts).toStrictEqual([
      { type: 'text', text: 'Hello', itemId: 'agent-1' },
    ]);
    expect(setup.host.emitEvent).not.toHaveBeenCalled();
  });

  it('accumulates plan deltas and replaces them with a completed structured plan', () => {
    const setup = itemController();
    setup.controller.applyPlanDelta({
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'plan-item', delta: 'First',
    });
    setup.controller.applyPlanDelta({
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'plan-item', delta: ' second',
    });
    expect(setup.runtime.activeTurnId).toBe('turn-1');
    expect(setup.runtime.planMarkdownByTurn.get('turn-1')).toBe('First second');
    expect(setup.runtime.messages[0]?.parts[0]).toMatchObject({
      type: 'tool', id: 'plan-progress-turn-1', kind: 'generic', title: 'plan',
      status: 'running', body: 'First second', metadata: { planProgress: true },
    });
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(1, 'notification', {
      type: 'plan.delta', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { itemId: 'plan-item', delta: 'First', markdown: 'First' },
    });
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(2, 'notification', {
      type: 'plan.delta', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { itemId: 'plan-item', delta: ' second', markdown: 'First second' },
    });

    setup.controller.applyPlanUpdated({
      threadId: 'thread-1', turnId: 'turn-1', explanation: '  Updated  ',
      plan: [
        { step: 'Done', status: 'completed' },
        { step: 'Next', status: 'inProgress' },
      ],
    });
    expect(setup.runtime.planMarkdownByTurn.get('turn-1')).toBe('Updated\n- [x] Done\n- [ ] Next');
    expect(setup.runtime.messages[0]?.parts[0]).toMatchObject({
      type: 'tool', id: 'plan-progress-turn-1', kind: 'generic', title: 'plan',
      status: 'completed', body: 'Updated\n- [x] Done\n- [ ] Next', metadata: { planProgress: true },
    });
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(3, 'notification', {
      type: 'plan.updated', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        explanation: '  Updated  ',
        steps: [
          { step: 'Done', status: 'completed' },
          { step: 'Next', status: 'inProgress' },
        ],
        markdown: 'Updated\n- [x] Done\n- [ ] Next', status: 'completed',
      },
    });
    expect(setup.host.markRuntimeTurnActive).toHaveBeenCalledTimes(3);
    expect(setup.host.markRuntimeTurnActive).toHaveBeenLastCalledWith(setup.runtime, 'turn-1');
  });

  it('appends steering user input between assistant segments with a complete event', () => {
    const setup = itemController();
    setup.runtime.messages = [assistant([{ type: 'text', text: 'Before', itemId: 'agent-before' }])];
    setup.controller.applyItem(item('userMessage', {
      id: 'steer-1', clientId: null,
      content: [{ type: 'text', text: 'Change direction', text_elements: [] }],
    }), true);

    expect(setup.runtime.messages).toHaveLength(3);
    expect(setup.runtime.messages[1]).toMatchObject({
      id: 'user-thread-1-turn-1-steer-1', kind: 'steer', role: 'user', status: 'complete', turnId: 'turn-1',
      parts: [{ type: 'text', text: 'Change direction' }],
    });
    expect(setup.runtime.messages[2]).toMatchObject({
      id: 'assistant-turn-1-segment-1', role: 'assistant', status: 'streaming', parts: [],
    });
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', {
      type: 'message.appended', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { message: setup.runtime.messages[1] },
    });
  });

  it('emits complete subagent tool and activity contracts without creating messages', () => {
    const setup = itemController();
    setup.controller.applyItem(item('collabAgentToolCall', {
      id: 'collab-1', tool: 'spawnAgent', status: 'inProgress', senderThreadId: 'thread-1',
      receiverThreadIds: ['child'], prompt: 'Inspect', model: 'gpt-5', reasoningEffort: 'high',
      agentsStates: { child: { status: 'running', message: null } },
    }), false);
    setup.controller.applyItem(item('subAgentActivity', {
      id: 'activity-1', kind: 'interacted', agentThreadId: 'child', agentPath: '/root/child',
    }), true);

    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(1, 'notification', {
      type: 'subagent.toolCallChanged', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        lifecycle: 'started',
        toolCall: {
          id: 'collab-1', tool: 'spawnAgent', status: 'inProgress', senderConversationId: 'thread-1',
          receiverConversationIds: ['child'], prompt: 'Inspect', model: 'gpt-5', reasoningEffort: 'high',
          agentStates: { child: { status: 'running', message: null } },
        },
      },
    });
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(2, 'notification', {
      type: 'subagent.activity', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        lifecycle: 'completed',
        activity: {
          id: 'activity-1', kind: 'interacted', agentConversationId: 'child', agentPath: '/root/child',
        },
      },
    });
    expect(setup.runtime.messages).toStrictEqual([]);
  });

  it('adds cwd to file updates and deduplicates file activity until reset or forget', () => {
    const setup = itemController();
    setup.runtime.cwd = '/workspace';
    setup.runtime.messages = [assistant([{
      type: 'tool', id: 'file-1', kind: 'fileChange', title: 'Files', status: 'running',
      metadata: { changes: [{ kind: 'add', path: 'src/new.ts' }] },
    }])];
    const update = {
      itemId: 'file-1', status: 'completed' as const,
      metadata: { changes: [{ kind: 'add', path: 'src/new.ts' }] },
    };
    setup.controller.applyToolUpdate('thread-1', 'turn-1', update);
    setup.controller.applyToolUpdate('thread-1', 'turn-1', update);

    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', {
      type: 'tool.updated', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        messageId: 'assistant-turn-1',
        update: { ...update, metadata: { ...update.metadata, cwd: '/workspace' } },
      },
    });
    expect(vi.mocked(setup.host.emitEvent).mock.calls.filter(([, event]) => event.type === 'file.activity'))
      .toHaveLength(1);
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', {
      type: 'file.activity', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        messageId: 'assistant-turn-1', itemId: 'file-1', path: '/workspace/src/new.ts',
        action: 'create', status: 'completed',
      },
    });

    setup.controller.forget('thread-1');
    setup.controller.applyToolUpdate('thread-1', 'turn-1', update);
    expect(vi.mocked(setup.host.emitEvent).mock.calls.filter(([, event]) => event.type === 'file.activity'))
      .toHaveLength(2);
    setup.controller.reset();
  });

  it('completes a failed turn, finalizes tools, updates its summary, and drains the queue', () => {
    const setup = itemController();
    setup.runtime.activeTurnId = 'turn-1';
    setup.runtime.turnIds = ['turn-old'];
    setup.runtime.busy = true;
    setup.runtime.turnStartPending = true;
    setup.runtime.planMarkdownByTurn.set('turn-1', 'plan');
    setup.runtime.messages = [
      assistant([{ type: 'tool', id: 'tool-1', kind: 'command', title: 'Run', status: 'running' }]),
      { ...assistant([]), id: 'empty-assistant' },
      {
        ...assistant([{ type: 'text', text: 'Other' }]), id: 'other-turn',
        metadata: { conversationId: 'thread-1', turnId: 'turn-other' },
      },
    ];
    setup.state.conversations = [summary('thread-1'), summary('other')];

    setup.controller.applyTurnCompleted({
      threadId: 'thread-1',
      turn: {
        id: 'turn-1', status: 'failed', items: [], itemsView: 'full',
        error: { message: 'boom', additionalDetails: null, codexErrorInfo: null, misalignment: null },
        startedAt: 1_700_000_000, completedAt: 1_700_000_002, durationMs: 2_000,
      },
    });

    expect(setup.runtime).toMatchObject({
      activeTurnId: null, turnIds: ['turn-old', 'turn-1'], busy: false,
      turnStartPending: false, error: 'boom',
    });
    expect(setup.runtime.messages).toEqual([
      expect.objectContaining({
        id: 'assistant-turn-1', status: 'error',
        parts: [expect.objectContaining({ id: 'tool-1', status: 'failed' })],
      }),
      expect.objectContaining({ id: 'other-turn', status: 'streaming' }),
    ]);
    expect(setup.state.conversations[0]).toMatchObject({
      id: 'thread-1', status: 'error', turnCount: 2,
    });
    expect(setup.state.conversations[1]).toStrictEqual(summary('other'));
    expect(setup.host.emitSummaryUpserted).toHaveBeenCalledWith(
      setup.state.conversations[0], 'updated', 'notification',
    );
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', {
      type: 'turn.completed', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        status: 'failed', error: { message: 'boom', additionalDetails: null, codexErrorInfo: null },
        willRetry: false, startedAt: '2023-11-14T22:13:20.000Z',
        completedAt: '2023-11-14T22:13:22.000Z', durationMs: 2_000,
      },
    });
    expect(setup.host.emitConversationActivity).toHaveBeenCalledWith('thread-1', 'notification');
    expect(setup.runtime.planMarkdownByTurn.has('turn-1')).toBe(false);
    expect(setup.host.sendNextQueuedPrompt).toHaveBeenCalledWith('thread-1');
  });

  it('routes raw response tool starts and outputs through exact tool events', () => {
    const setup = itemController();
    setup.controller.applyRawResponseItem({
      threadId: 'thread-1', turnId: 'turn-1',
      item: {
        type: 'function_call', call_id: 'call-1', name: 'lookup', namespace: 'tools',
        arguments: '{"query":"docs"}', id: null, status: 'in_progress',
      },
    } as never);
    const toolPart = setup.runtime.messages[0]?.parts[0];
    expect(toolPart).toMatchObject({
      type: 'tool', id: 'call-1', kind: 'dynamic', title: 'tools.lookup', status: 'running',
      input: { query: 'docs' },
    });
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(1, 'notification', {
      type: 'tool.started', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { messageId: 'assistant-turn-1', toolPart },
    });

    setup.controller.applyRawResponseItem({
      threadId: 'thread-1', turnId: 'turn-1',
      item: { type: 'function_call_output', call_id: 'call-1', output: 'Found it' },
    } as never);
    expect(setup.runtime.messages[0]?.parts[0]).toMatchObject({
      type: 'tool', id: 'call-1', body: 'Found it', status: 'completed',
    });
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(2, 'notification', {
      type: 'tool.updated', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        messageId: 'assistant-turn-1',
        update: expect.objectContaining({ itemId: 'call-1', body: 'Found it', status: 'completed' }),
      },
    });
  });

  it('resets and forgets command forwarding and review suppression by thread', () => {
    const setup = itemController();
    const write = { type: 'commandExecution', id: 'write', command: 'printf test > file.txt' } as never;
    expect(setup.controller.shouldForwardCommandOutput('thread-1', false, write)).toBe(true);
    expect(setup.controller.shouldForwardCommandOutput('thread-2', false, write)).toBe(true);
    setup.controller.forget('thread-1');
    expect(setup.controller.isForwardingCommandOutput('thread-1', 'write')).toBe(false);
    expect(setup.controller.isForwardingCommandOutput('thread-2', 'write')).toBe(true);
    setup.controller.reset();
    expect(setup.controller.isForwardingCommandOutput('thread-2', 'write')).toBe(false);

    const review = item('exitedReviewMode', { id: 'review-1', review: 'Review result' });
    setup.controller.applyItem(review, true);
    setup.controller.reset();
    setup.controller.applyItem(item('agentMessage', { id: 'agent-review', text: 'Review result' }), true);
    expect(setup.runtime.messages[0]?.parts).toStrictEqual([
      { type: 'text', text: 'Review result', itemId: 'review-1' },
      { type: 'text', text: 'Review result', itemId: 'agent-review' },
    ]);
  });

  it('forgets review suppression only for the requested thread', () => {
    const setup = itemController();
    setup.controller.applyItem(item('exitedReviewMode', { id: 'review-1', review: 'Shared result' }), true);
    setup.controller.applyItem({
      threadId: 'thread-2', turnId: 'turn-1', completedAtMs: 1_000,
      item: { type: 'exitedReviewMode', id: 'review-2', review: 'Shared result' },
    } as never, true);
    setup.controller.forget('thread-1');

    setup.controller.applyItem(item('agentMessage', { id: 'agent-1', text: 'Shared result' }), true);
    setup.controller.applyItem({
      threadId: 'thread-2', turnId: 'turn-1', completedAtMs: 1_000,
      item: { type: 'agentMessage', id: 'agent-2', text: 'Shared result' },
    } as never, true);
    expect(setup.runtime.messages.flatMap((message) => message.parts)).toContainEqual({
      type: 'text', text: 'Shared result', itemId: 'agent-1',
    });
    expect(setup.runtime.messages.flatMap((message) => message.parts)).not.toContainEqual({
      type: 'text', text: 'Shared result', itemId: 'agent-2',
    });
  });

  it('emits exact context compaction start and completion payloads', () => {
    const setup = itemController();
    setup.controller.applyItem(item('contextCompaction', { id: 'compact-1' }), false);
    const compaction = setup.runtime.messages.find((message) => message.kind === 'compaction');
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(1, 'notification', {
      type: 'context.compactionStarted', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { itemId: 'compact-1' },
    });
    setup.controller.applyItem(item('contextCompaction', { id: 'compact-1' }), true);
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(2, 'notification', {
      type: 'context.compactionCompleted', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { itemId: 'compact-1', message: { ...compaction, status: 'complete' } },
    });
  });

  it('completes a successful known turn without clearing a different active turn', () => {
    const setup = itemController();
    setup.runtime.activeTurnId = 'turn-other';
    setup.runtime.turnIds = ['turn-1'];
    setup.runtime.messages = [assistant([{
      type: 'tool', id: 'tool-1', kind: 'command', title: 'Run', status: 'running',
    }])];
    setup.state.conversations = [summary('thread-1')];

    setup.controller.applyTurnCompleted({
      threadId: 'thread-1',
      turn: {
        id: 'turn-1', status: 'completed', items: [], itemsView: 'full', error: null,
        startedAt: null, completedAt: null, durationMs: null,
      },
    });

    expect(setup.runtime).toMatchObject({
      activeTurnId: 'turn-other', turnIds: ['turn-1'], busy: true, error: null,
    });
    expect(setup.runtime.messages[0]).toMatchObject({
      status: 'complete', parts: [expect.objectContaining({ id: 'tool-1', status: 'completed' })],
    });
    expect(setup.state.conversations[0]).toMatchObject({ status: 'idle', turnCount: 1 });
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', {
      type: 'turn.completed', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        status: 'completed', error: null, willRetry: false,
        startedAt: null, completedAt: null, durationMs: null,
      },
    });
  });

  it('classifies user items as steering only after nonempty assistant output in the same turn', () => {
    const otherTurn = itemController();
    otherTurn.runtime.messages = [{
      ...assistant([{ type: 'text', text: 'Other turn' }]),
      metadata: { conversationId: 'thread-1', turnId: 'turn-other' },
    }];
    otherTurn.controller.applyItem(userItem('user-other', 'Prompt'), true);
    expect(otherTurn.runtime.messages.at(-1)).toMatchObject({
      role: 'user', parts: [{ type: 'text', text: 'Prompt' }],
    });
    expect(otherTurn.runtime.messages.at(-1)).not.toHaveProperty('kind');

    const emptyAssistant = itemController();
    emptyAssistant.runtime.messages = [assistant([])];
    emptyAssistant.controller.applyItem(userItem('user-empty', 'Prompt'), true);
    expect(emptyAssistant.runtime.messages).toHaveLength(2);
    expect(emptyAssistant.runtime.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(emptyAssistant.runtime.messages.at(-1)).not.toHaveProperty('kind');

    const priorOtherUser = itemController();
    priorOtherUser.runtime.messages = [{
      id: 'prior', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Prompt' }],
      turnId: 'turn-other', metadata: { conversationId: 'thread-1', turnId: 'turn-other' },
    }];
    priorOtherUser.controller.applyItem(userItem('user-current', 'Prompt'), true);
    expect(priorOtherUser.runtime.messages).toHaveLength(2);

    const priorSteer = itemController();
    priorSteer.runtime.messages = [{
      id: 'prior-steer', kind: 'steer', role: 'user', status: 'complete',
      parts: [{ type: 'text', text: 'Prompt' }], turnId: 'turn-1',
      metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
    }];
    priorSteer.controller.applyItem(userItem('user-current', 'Prompt'), true);
    expect(priorSteer.runtime.messages).toHaveLength(2);
  });

  it('emits tool and media changes once for a completed generated image', () => {
    const setup = itemController();
    const generated = item('imageGeneration', {
      id: 'image-1', status: 'completed', revisedPrompt: 'Draw it',
      result: '', savedPath: '/tmp/generated.png',
    });
    setup.controller.applyItem(generated, true);
    const message = setup.runtime.messages[0];
    expect(message?.parts).toEqual([
      expect.objectContaining({
        type: 'tool', id: 'image-1', kind: 'dynamic', title: 'image_generation',
        status: 'completed', body: 'Draw it', output: '/tmp/generated.png',
      }),
      expect.objectContaining({
        type: 'media', itemId: 'image-1',
        media: expect.objectContaining({
          url: 'file:///tmp/generated.png', mimeType: 'image/png', prompt: 'Draw it',
        }),
      }),
    ]);
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(1, 'notification', {
      type: 'tool.completed', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { messageId: message?.id, toolPart: message?.parts[0] },
    });
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(2, 'notification', {
      type: 'message.updated', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { message },
    });

    setup.controller.applyItem(generated, true);
    expect(vi.mocked(setup.host.emitEvent).mock.calls.filter(([, event]) => event.type === 'message.updated'))
      .toHaveLength(1);
  });

  it('emits exact ordinary tool lifecycle events and preserves tracked command output', () => {
    const setup = itemController();
    const started = item('commandExecution', {
      id: 'command-1', command: 'printf test > output.txt', cwd: '/workspace', source: 'unifiedExec',
      status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null,
    });
    setup.controller.applyItem(started, false);
    expect(setup.controller.isForwardingCommandOutput('thread-1', 'command-1')).toBe(true);
    const startedPart = setup.runtime.messages[0]?.parts[0];
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', {
      type: 'tool.started', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { messageId: 'assistant-turn-1', toolPart: startedPart },
    });

    setup.controller.applyItem(item('commandExecution', {
      id: 'command-1', command: 'printf test > output.txt', cwd: '/workspace', source: 'unifiedExec',
      status: 'completed', commandActions: [], aggregatedOutput: 'done', exitCode: 0, durationMs: 5,
    }), true);
    expect(setup.controller.isForwardingCommandOutput('thread-1', 'command-1')).toBe(false);
    const completedPart = setup.runtime.messages[0]?.parts[0];
    expect(completedPart).toMatchObject({
      type: 'tool', id: 'command-1', status: 'completed', body: 'done',
      output: { exitCode: 0, durationMs: 5 },
    });
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', {
      type: 'tool.completed', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { messageId: 'assistant-turn-1', toolPart: completedPart },
    });
  });

  it('reset makes previously emitted file activity observable again', () => {
    const setup = itemController();
    setup.runtime.cwd = '/workspace';
    setup.runtime.messages = [assistant([{
      type: 'tool', id: 'file-reset', kind: 'fileChange', title: 'Files', status: 'running',
      metadata: { changes: [{ kind: 'add', path: 'again.ts' }] },
    }])];
    const update = {
      itemId: 'file-reset', status: 'completed' as const,
      metadata: { changes: [{ kind: 'add', path: 'again.ts' }] },
    };
    setup.controller.applyToolUpdate('thread-1', 'turn-1', update);
    setup.controller.reset();
    setup.controller.applyToolUpdate('thread-1', 'turn-1', update);
    expect(vi.mocked(setup.host.emitEvent).mock.calls.filter(([, event]) => event.type === 'file.activity'))
      .toHaveLength(2);
  });

  it('forgets file-activity deduplication for only the requested thread', () => {
    const setup = itemController();
    setup.runtime.cwd = '/workspace';
    setup.runtime.messages = [assistant([{
      type: 'tool', id: 'file-shared', kind: 'fileChange', title: 'Files', status: 'running',
      metadata: { changes: [{ kind: 'add', path: 'shared.ts' }] },
    }])];
    const update = {
      itemId: 'file-shared', status: 'completed' as const,
      metadata: { changes: [{ kind: 'add', path: 'shared.ts' }] },
    };
    setup.controller.applyToolUpdate('thread-1', 'turn-1', update);
    setup.controller.applyToolUpdate('thread-2', 'turn-1', update);
    setup.controller.forget('thread-1');
    vi.mocked(setup.host.emitEvent).mockClear();

    setup.controller.applyToolUpdate('thread-1', 'turn-1', update);
    setup.controller.applyToolUpdate('thread-2', 'turn-1', update);
    const activities = vi.mocked(setup.host.emitEvent).mock.calls
      .map(([, event]) => event)
      .filter((event) => event.type === 'file.activity');
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ conversationId: 'thread-1' });
  });

  it('keeps distinct initial user messages and does not treat metadata-free assistant output as steering', () => {
    const distinct = itemController();
    distinct.runtime.messages = [{
      id: 'prior', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'First prompt' }],
      turnId: 'turn-1', metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
    }];
    distinct.controller.applyItem(userItem('second', 'Second prompt'), true);
    expect(distinct.runtime.messages.map((message) => message.parts)).toStrictEqual([
      [{ type: 'text', text: 'First prompt' }],
      [{ type: 'text', text: 'Second prompt' }],
    ]);

    const metadataFree = itemController();
    metadataFree.runtime.messages = [{
      id: 'assistant-without-metadata', role: 'assistant', status: 'streaming',
      parts: [{ type: 'text', text: 'Unattributed output' }],
    }];
    metadataFree.controller.applyItem(userItem('ordinary', 'Prompt'), true);
    expect(metadataFree.runtime.messages).toHaveLength(2);
    expect(metadataFree.runtime.messages[1]).not.toHaveProperty('kind');
  });

  it('selects the matching agent text part and preserves its phase and event boundaries', () => {
    const setup = itemController();
    setup.runtime.messages = [assistant([
      { type: 'text', text: 'Decoy', itemId: 'other-agent' },
      { type: 'tool', id: 'agent-1', kind: 'command', title: 'Run', status: 'running' },
      { type: 'text', text: 'Hello', itemId: 'agent-1' },
    ])];

    setup.controller.applyItem(item('agentMessage', {
      id: 'agent-1', text: 'Hello world', phase: 'commentary',
    }), true);
    expect(setup.runtime.messages[0]?.parts).toContainEqual({
      type: 'text', text: 'Hello world', itemId: 'agent-1', phase: 'commentary',
    });
    expect(setup.host.emitEvent).toHaveBeenCalledExactlyOnceWith('notification', {
      type: 'message.delta', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        messageId: 'assistant-turn-1', itemId: 'agent-1', delta: ' world', phase: 'commentary',
      },
    });

    vi.mocked(setup.host.emitEvent).mockClear();
    setup.controller.applyItem(item('agentMessage', {
      id: 'agent-1', text: 'Hello world', phase: 'commentary',
    }), true);
    expect(setup.host.emitEvent).not.toHaveBeenCalled();
  });

  it('publishes exact reasoning append and update events while suppressing empty or repeated summaries', () => {
    const setup = itemController();
    setup.controller.applyItem(item('reasoning', {
      id: 'reasoning-empty', summary: ['', '   '], content: ['private'],
    }), false);
    expect(setup.runtime.messages).toStrictEqual([]);
    expect(setup.host.emitEvent).not.toHaveBeenCalled();

    setup.controller.applyItem(item('reasoning', {
      id: 'reasoning-1', summary: ['  Inspecting  ', '', 'Testing'], content: ['private'],
    }), false);
    const appended = setup.runtime.messages[0];
    expect(appended?.parts).toStrictEqual([
      { type: 'reasoning', summary: 'Inspecting', itemId: 'reasoning-1', summaryIndex: 0 },
      { type: 'reasoning', summary: 'Testing', itemId: 'reasoning-1', summaryIndex: 2 },
    ]);
    expect(setup.host.emitEvent).toHaveBeenCalledExactlyOnceWith('notification', {
      type: 'message.appended', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { message: structuredClone(appended) },
    });

    vi.mocked(setup.host.emitEvent).mockClear();
    setup.controller.applyItem(item('reasoning', {
      id: 'reasoning-1', summary: ['  Inspecting  ', '', 'Testing'], content: ['changed private'],
    }), true);
    expect(setup.host.emitEvent).not.toHaveBeenCalled();

    setup.controller.applyItem(item('reasoning', {
      id: 'reasoning-1', summary: ['Verified'], content: ['private'],
    }), true);
    const updated = setup.runtime.messages[0];
    expect(updated?.parts).toStrictEqual([
      { type: 'reasoning', summary: 'Verified', itemId: 'reasoning-1', summaryIndex: 0 },
    ]);
    expect(setup.host.emitEvent).toHaveBeenCalledExactlyOnceWith('notification', {
      type: 'message.updated', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { message: structuredClone(updated) },
    });
  });

  it('keeps distinct agent items with identical text and emits exact append, update, and host-miss behavior', () => {
    const duplicateText = itemController();
    duplicateText.controller.applyItem(item('agentMessage', { id: 'agent-1', text: 'Same' }), true);
    const appended = duplicateText.runtime.messages[0];
    expect(duplicateText.host.emitEvent).toHaveBeenCalledExactlyOnceWith('notification', {
      type: 'message.appended', conversationId: 'thread-1', turnId: 'turn-1', payload: { message: appended },
    });
    duplicateText.controller.applyItem(item('agentMessage', { id: 'agent-2', text: 'Same' }), true);
    expect(duplicateText.runtime.messages[0]?.parts).toStrictEqual([
      { type: 'text', text: 'Same', itemId: 'agent-1' },
      { type: 'text', text: 'Same', itemId: 'agent-2' },
    ]);

    const replacement = itemController();
    replacement.runtime.messages = [assistant([{ type: 'text', text: 'Old', itemId: 'agent-1' }])];
    replacement.controller.applyItem(item('agentMessage', { id: 'agent-1', text: 'New' }), true);
    expect(replacement.host.emitEvent).toHaveBeenCalledExactlyOnceWith('notification', {
      type: 'message.updated', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { message: replacement.runtime.messages[0] },
    });

    const hostMiss = itemController();
    hostMiss.runtime.messages = [assistant([{ type: 'text', text: 'Existing', itemId: 'other' }])];
    vi.mocked(hostMiss.host.assistantMessageForTurn).mockReturnValue(null);
    hostMiss.controller.applyItem(item('agentMessage', { id: 'agent-new', text: 'New' }), true);
    expect(hostMiss.runtime.messages[0]?.parts).toContainEqual({
      type: 'text', text: 'New', itemId: 'agent-new',
    });
    expect(hostMiss.host.emitEvent).not.toHaveBeenCalled();

    const newItemInExistingMessage = itemController();
    newItemInExistingMessage.runtime.messages = [assistant([{
      type: 'text', text: 'Existing', itemId: 'other',
    }])];
    newItemInExistingMessage.controller.applyItem(item('agentMessage', {
      id: 'agent-new', text: 'Complete new item',
    }), true);
    expect(newItemInExistingMessage.host.emitEvent).toHaveBeenCalledExactlyOnceWith('notification', {
      type: 'message.delta', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { messageId: 'assistant-turn-1', itemId: 'agent-new', delta: 'Complete new item' },
    });
  });

  it('ignores a media part with the target item id when finding previous agent text', () => {
    const setup = itemController();
    setup.runtime.messages = [assistant([
      {
        type: 'media', itemId: 'agent-1',
        media: { url: 'data:image/png;base64,AA==', mimeType: 'image/png' },
      },
      { type: 'text', text: 'Hello', itemId: 'agent-1' },
    ])];
    setup.controller.applyItem(item('agentMessage', { id: 'agent-1', text: 'Hello world' }), true);
    expect(setup.host.emitEvent).toHaveBeenCalledExactlyOnceWith('notification', {
      type: 'message.delta', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { messageId: 'assistant-turn-1', itemId: 'agent-1', delta: ' world' },
    });
  });

  it('marks raw items active, ignores unsupported items, and emits completed web searches', () => {
    const setup = itemController();
    setup.controller.applyRawResponseItem({
      threadId: 'thread-1', turnId: 'turn-1', item: { type: 'unsupported' },
    } as never);
    expect(setup.runtime.activeTurnId).toBe('turn-1');
    expect(setup.runtime.messages).toStrictEqual([]);
    expect(setup.host.emitEvent).not.toHaveBeenCalled();

    setup.controller.applyRawResponseItem({
      threadId: 'thread-1', turnId: 'turn-1',
      item: { type: 'web_search_call', id: 'web-1', action: { type: 'search', query: 'SDK' } },
    } as never);
    const toolPart = setup.runtime.messages[0]?.parts[0];
    expect(setup.host.emitEvent).toHaveBeenCalledExactlyOnceWith('notification', {
      type: 'tool.completed', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { messageId: 'assistant-turn-1', toolPart },
    });
  });

  it('patches raw tools without emitting when the host cannot resolve their message', () => {
    const setup = itemController();
    vi.mocked(setup.host.messageContainingTool).mockReturnValue(null);
    setup.controller.applyRawResponseItem({
      threadId: 'thread-1', turnId: 'turn-1',
      item: { type: 'web_search_call', id: 'web-1', action: { type: 'search', query: 'SDK' } },
    } as never);
    expect(setup.runtime.messages[0]?.parts[0]).toMatchObject({ id: 'web-1', status: 'completed' });
    expect(setup.host.emitEvent).not.toHaveBeenCalled();
  });

  it('selects the current-turn compaction marker when other messages could match only half the predicate', () => {
    const setup = itemController();
    setup.runtime.messages = [
      {
        id: 'metadata-free', kind: 'compaction', role: 'assistant', status: 'complete',
        parts: [{ type: 'text', text: 'decoy' }],
      },
      {
        id: 'wrong-turn-compaction', kind: 'compaction', role: 'assistant', status: 'complete', parts: [],
        metadata: { conversationId: 'thread-1', turnId: 'turn-other' },
      },
      {
        id: 'ordinary-current-turn', role: 'assistant', status: 'streaming',
        parts: [{ type: 'text', text: 'ordinary' }],
        metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
      },
    ];
    setup.controller.applyItem(item('contextCompaction', { id: 'compact-current' }), true);
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', {
      type: 'context.compactionCompleted', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        itemId: 'compact-current',
        message: expect.objectContaining({ kind: 'compaction', metadata: expect.objectContaining({ turnId: 'turn-1' }) }),
      },
    });
  });

  it('emits both lifecycle values for subagent tools and activities', () => {
    const setup = itemController();
    setup.controller.applyItem(item('collabAgentToolCall', {
      id: 'collab-1', tool: 'wait', status: 'completed', senderThreadId: 'thread-1',
      receiverThreadIds: [], prompt: null, model: null, reasoningEffort: null, agentsStates: {},
    }), true);
    setup.controller.applyItem(item('subAgentActivity', {
      id: 'activity-1', kind: 'started', agentThreadId: 'child', agentPath: '/root/child',
    }), false);
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(1, 'notification', expect.objectContaining({
      type: 'subagent.toolCallChanged', payload: expect.objectContaining({ lifecycle: 'completed' }),
    }));
    expect(setup.host.emitEvent).toHaveBeenNthCalledWith(2, 'notification', expect.objectContaining({
      type: 'subagent.activity', payload: expect.objectContaining({ lifecycle: 'started' }),
    }));
  });

  it('completes a blank plan as blank when no streamed plan exists', () => {
    const setup = itemController();
    setup.controller.applyItem(item('plan', { id: 'blank-plan', text: '  ' }), true);
    expect(setup.runtime.planMarkdownByTurn.get('turn-1')).toBe('');
    expect(setup.runtime.messages[0]?.parts[0]).toMatchObject({
      id: 'plan-progress-turn-1', status: 'completed', body: '',
    });
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', {
      type: 'plan.completed', conversationId: 'thread-1', turnId: 'turn-1',
      payload: { itemId: 'blank-plan', markdown: '' },
    });
  });

  it('marks only started ordinary items active and ignores unsupported item types', () => {
    const setup = itemController();
    setup.controller.applyItem(item('unsupported', { id: 'unknown' }), false);
    expect(setup.runtime.activeTurnId).toBe('turn-1');
    expect(setup.host.patchRuntime).not.toHaveBeenCalled();
    expect(setup.host.emitEvent).not.toHaveBeenCalled();

    vi.mocked(setup.host.markRuntimeTurnActive).mockClear();
    setup.runtime.activeTurnId = null;
    setup.controller.applyItem(item('unsupported', { id: 'unknown' }), true);
    expect(setup.runtime.activeTurnId).toBeNull();
    expect(setup.host.markRuntimeTurnActive).not.toHaveBeenCalled();
  });

  it('tracks command output independently by thread and clears stale starts', () => {
    const setup = itemController();
    const write = { type: 'commandExecution', id: 'same-id', command: 'printf x > file' } as never;
    const read = { type: 'commandExecution', id: 'same-id', command: 'ls' } as never;
    expect(setup.controller.shouldForwardCommandOutput('thread-1', false, write)).toBe(true);
    expect(setup.controller.shouldForwardCommandOutput('thread-2', true, read)).toBe(false);
    expect(setup.controller.isForwardingCommandOutput('thread-1', 'same-id')).toBe(true);
    expect(setup.controller.shouldForwardCommandOutput('thread-1', false, read)).toBe(false);
    expect(setup.controller.isForwardingCommandOutput('thread-1', 'same-id')).toBe(false);
    expect(setup.controller.shouldForwardCommandOutput('thread-1', true, write)).toBe(true);
    expect(setup.controller.shouldForwardCommandOutput('thread-1', true, { type: 'plan' } as never)).toBe(false);
    expect(setup.controller.shouldForwardCommandOutput('thread-1', true, { id: 42, type: 'plan' } as never)).toBe(false);
    expect(setup.controller.shouldForwardCommandOutput('thread-1', false, {
      type: 'commandExecution', id: 42, command: 'printf x > file',
    } as never)).toBe(false);
    expect(setup.controller.shouldForwardCommandOutput('thread-1', false, {
      type: 'commandExecution', id: '', command: 'printf x > file',
    } as never)).toBe(false);
  });

  it('adds cwd only to updates carrying file-change data through every supported shape', () => {
    const setup = itemController();
    setup.runtime.cwd = '/workspace';
    setup.runtime.messages = [assistant([
      { type: 'text', text: 'decoy' },
      { type: 'tool', id: 'other-tool', kind: 'fileChange', title: 'Other', status: 'running' },
      { type: 'tool', id: 'target', kind: 'fileChange', title: 'Target', status: 'running' },
    ])];
    const cases = [
      { itemId: 'target', input: { changes: [] } },
      { itemId: 'target', fallbackToolPart: {
        type: 'tool' as const, id: 'target', kind: 'fileChange' as const, title: 'Target', status: 'running' as const,
      } },
      { itemId: 'target', metadata: { changes: [], source: 'notification' } },
    ];
    for (const update of cases) {
      setup.controller.applyToolUpdate('thread-1', 'turn-1', update);
    }
    const updates = vi.mocked(setup.host.emitEvent).mock.calls
      .map(([, event]) => event)
      .filter((event) => event.type === 'tool.updated');
    expect(updates).toHaveLength(3);
    expect(updates.map((event) => event.payload.update)).toStrictEqual(cases.map((update) => ({
      ...update, metadata: { ...update.metadata, cwd: '/workspace' },
    })));

    vi.mocked(setup.host.emitEvent).mockClear();
    setup.controller.applyToolUpdate('thread-1', 'turn-1', { itemId: 'target', bodyDelta: 'ordinary' });
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'tool.updated', payload: expect.objectContaining({
        update: { itemId: 'target', bodyDelta: 'ordinary' },
      }),
    }));
  });

  it('uses the matching tool part when an update emits file activity', () => {
    const setup = itemController();
    setup.runtime.cwd = '/workspace';
    setup.runtime.messages = [assistant([
      { type: 'text', text: 'decoy' },
      {
        type: 'tool', id: 'other-tool', kind: 'fileChange', title: 'Other', status: 'running',
        metadata: { changes: [{ kind: 'add', path: 'wrong.ts' }] },
      },
      { type: 'tool', id: 'target', kind: 'fileChange', title: 'Target', status: 'running' },
    ])];
    setup.controller.applyToolUpdate('thread-1', 'turn-1', {
      itemId: 'target', status: 'completed',
      metadata: { changes: [{ kind: 'add', path: 'right.ts' }] },
    });
    expect(setup.runtime.activeTurnId).toBe('turn-1');
    expect(setup.host.markRuntimeTurnActive).toHaveBeenCalledWith(setup.runtime, 'turn-1');
    const activities = vi.mocked(setup.host.emitEvent).mock.calls
      .map(([, event]) => event)
      .filter((event) => event.type === 'file.activity');
    expect(activities).toStrictEqual([{
      type: 'file.activity', conversationId: 'thread-1', turnId: 'turn-1',
      payload: {
        messageId: 'assistant-turn-1', itemId: 'target', path: '/workspace/right.ts',
        action: 'create', status: 'completed',
      },
    }]);
  });

  it('patches generated media without events when its containing message is unavailable', () => {
    const setup = itemController();
    vi.mocked(setup.host.messageContainingTool).mockReturnValue(null);
    setup.controller.applyItem(item('imageGeneration', {
      id: 'image-1', status: 'completed', revisedPrompt: 'Draw it',
      result: '', savedPath: '/tmp/generated.png',
    }), true);
    expect(setup.runtime.messages[0]?.parts).toHaveLength(2);
    expect(setup.host.emitEvent).not.toHaveBeenCalled();
  });

  it('emits a media update for a different generated image while retaining the prior image', () => {
    const setup = itemController();
    setup.controller.applyItem(item('imageGeneration', {
      id: 'image-1', status: 'completed', revisedPrompt: 'First', result: '', savedPath: '/tmp/first.png',
    }), true);
    setup.controller.applyItem(item('imageGeneration', {
      id: 'image-2', status: 'completed', revisedPrompt: 'Second', result: '', savedPath: '/tmp/second.png',
    }), true);
    expect(setup.runtime.messages[0]?.parts.filter((part) => part.type === 'media')).toHaveLength(2);
    expect(vi.mocked(setup.host.emitEvent).mock.calls.filter(([, event]) => event.type === 'message.updated'))
      .toHaveLength(2);
  });

  it('treats null update metadata as ordinary data', () => {
    const setup = itemController();
    setup.runtime.cwd = '/workspace';
    setup.runtime.messages = [assistant([
      { type: 'tool', id: 'target', kind: 'generic', title: 'Target', status: 'running' },
    ])];
    setup.controller.applyToolUpdate('thread-1', 'turn-1', {
      itemId: 'target', metadata: null,
    } as never);
    expect(setup.host.emitEvent).toHaveBeenCalledWith('notification', expect.objectContaining({
      type: 'tool.updated', payload: expect.objectContaining({ update: { itemId: 'target', metadata: null } }),
    }));
  });

  it('removes only an empty ordinary assistant for the completed turn', () => {
    const setup = itemController();
    setup.runtime.messages = [
      assistant([]),
      {
        id: 'empty-user', role: 'user', status: 'complete', parts: [], turnId: 'turn-1',
        metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
      },
      {
        id: 'other-turn-empty', role: 'assistant', status: 'streaming', parts: [],
        metadata: { conversationId: 'thread-1', turnId: 'turn-other' },
      },
      {
        id: 'compaction-empty', kind: 'compaction', role: 'assistant', status: 'complete', parts: [],
        metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
      },
      { id: 'metadata-free-empty', role: 'assistant', status: 'streaming', parts: [] },
    ];
    setup.state.conversations = [];
    setup.controller.applyTurnCompleted({
      threadId: 'thread-1',
      turn: {
        id: 'turn-1', status: 'completed', items: [], itemsView: 'full', error: null,
        startedAt: null, completedAt: null, durationMs: null,
      },
    });
    expect(setup.runtime.messages.map((message) => message.id)).toStrictEqual([
      'empty-user', 'other-turn-empty', 'compaction-empty', 'metadata-free-empty',
    ]);
    expect(setup.host.emitSummaryUpserted).not.toHaveBeenCalled();
  });

  it('updates and emits the matching conversation summary even when another summary comes first', () => {
    const setup = itemController();
    setup.state.conversations = [summary('other'), summary('thread-1')];
    setup.controller.applyTurnCompleted({
      threadId: 'thread-1',
      turn: {
        id: 'turn-1', status: 'completed', items: [], itemsView: 'full', error: null,
        startedAt: null, completedAt: null, durationMs: null,
      },
    });
    expect(setup.host.emitSummaryUpserted).toHaveBeenCalledExactlyOnceWith(
      setup.state.conversations[1], 'updated', 'notification',
    );
    expect(setup.state.conversations[0]).toStrictEqual(summary('other'));
  });
});

function itemController() {
  const state = initialSurfaceSnapshot(initialAuthentication());
  const runtime = createThreadRuntime('thread-1', state);
  const host: CodexSurfaceItemsHost = {
    assistantMessageForTurn: vi.fn((_threadId, turnId) => runtime.messages.find((message) => (
      message.role === 'assistant' && message.metadata?.turnId === turnId
    )) ?? null),
    emitConversationActivity: vi.fn(),
    emitEvent: vi.fn(),
    emitSummaryUpserted: vi.fn(),
    getState: () => state,
    markRuntimeTurnActive: vi.fn((target: ThreadRuntimeState, turnId: string) => {
      target.activeTurnId = turnId;
    }),
    messageContainingTool: vi.fn((_threadId, turnId, itemId) => runtime.messages.find((message) => (
      message.metadata?.turnId === turnId
      && message.parts.some((part) => part.type === 'tool' && part.id === itemId)
    )) ?? null),
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

function userItem(id: string, text: string) {
  return item('userMessage', {
    id, clientId: null, content: [{ type: 'text', text, text_elements: [] }],
  });
}

function assistant(parts: SurfaceMessage['parts']): SurfaceMessage {
  return {
    id: 'assistant-turn-1', role: 'assistant', status: 'streaming', parts,
    metadata: { conversationId: 'thread-1', turnId: 'turn-1' },
  };
}

function summary(id: string) {
  return {
    id, title: id, preview: '', cwd: `/workspace/${id}`, status: 'active' as const, turnCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
