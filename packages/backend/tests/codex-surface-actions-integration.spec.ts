import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import { FakeTransport, createSurface, lastRequest, lastResponse, thread, turn } from './helpers/codex-surface-fixture';

describe('CodexSurface', () => {
  it('renders app-server plans and raw response tools instead of dropping them', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-plan', 'inProgress', []) },
    });
    transport.emit({
      method: 'item/plan/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-plan', itemId: 'plan-item', delta: '# Plan\n' },
    });
    transport.emit({
      method: 'turn/plan/updated',
      params: {
        threadId: 'thread-existing', turnId: 'turn-plan', explanation: 'Implementation',
        plan: [{ step: 'Copy the component', status: 'completed' }, { step: 'Wire events', status: 'inProgress' }],
      },
    });
    transport.emit({
      method: 'rawResponseItem/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-plan',
        item: {
          type: 'local_shell_call', call_id: 'raw-shell', status: 'completed',
          action: { type: 'exec', command: ['npm', 'test'], working_directory: '/tmp/project' },
        },
      },
    });

    const tools = surface.getSnapshot().messages.flatMap((message) => (
      message.parts.filter((part) => part.type === 'tool')
    ));
    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plan-progress-turn-plan', title: 'plan', status: 'completed' }),
      expect.objectContaining({ id: 'raw-shell', kind: 'command', title: 'npm test', status: 'completed' }),
    ]));
  });

  it('surfaces app-server user questions and MCP confirmations and sends their answers back', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      id: 'ask-1',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-existing', turnId: 'turn-input', itemId: 'ask-user-item', autoResolutionMs: null,
        questions: [{
          id: 'target', header: 'Target', question: 'Which file?', isOther: true, isSecret: false,
          options: [{ label: 'README.md', description: 'Read the README.' }],
        }],
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.some((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'ask-user-item')
    ))).toBe(true));
    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toContainEqual(expect.objectContaining({
      id: 'ask-user-item', title: 'ask_user_question', status: 'running',
      statusText: expect.stringContaining('"requestId":"ask-1"'),
    }));
    expect(surface.getSnapshot().clientRequests).toStrictEqual([{
      id: 'ask-1',
      kind: 'ask_user',
      conversationId: 'thread-existing',
      turnId: 'turn-input',
      itemId: 'ask-user-item',
      payload: {
        request: {
          itemId: 'ask-user-item',
          questions: [{
            id: 'target', header: 'Target', question: 'Which file?', isOther: true, isSecret: false,
            options: [{ label: 'README.md', description: 'Read the README.' }],
          }],
        },
      },
    }]);
    await surface.respondToClientRequest({
      id: 'ask-1', payload: { answers: { target: { answers: ['README.md'] } } },
    });
    expect(lastResponse(transport, 'ask-1')).toMatchObject({
      result: { answers: { target: { answers: ['README.md'] } } },
    });
    expect(surface.getSnapshot().clientRequests).toStrictEqual([]);

    transport.emit({
      id: 'mcp-1',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-existing', turnId: 'turn-input', serverName: 'calendar', mode: 'form',
        message: 'Allow calendar.create_event?', requestedSchema: { type: 'object', properties: {} },
        _meta: {
          codex_approval_kind: 'mcp_tool_call', tool_name: 'create_event', persist: ['session', 'always'],
          connector_name: 'Team Calendar',
          tool_params: { title: 'Planning' },
        },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.some((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'approval-mcp-1')
    ))).toBe(true));
    expect(surface.getSnapshot().clientRequests).toStrictEqual([{
      id: 'mcp-1',
      kind: 'confirm_tool',
      conversationId: 'thread-existing',
      turnId: 'turn-input',
      itemId: 'approval-mcp-1',
      payload: {
        confirmation: {
          argumentsPreview: '{\n  "title": "Planning"\n}',
          integrationId: 'calendar',
          integrationName: 'Team Calendar',
          summary: 'Allow calendar.create_event?',
          toolName: 'create_event',
          allowConversation: true,
          allowAlways: true,
        },
      },
    }]);
    await surface.respondToClientRequest({ id: 'mcp-1', payload: { decision: 'allow_conversation' } });
    expect(lastResponse(transport, 'mcp-1')).toMatchObject({
      result: { action: 'accept', content: null, _meta: { persist: 'session' } },
    });
  });

  it('executes built-in slash commands and drains queued prompts after a turn', async () => {
    const goal = {
      threadId: 'thread-existing', objective: 'Ship it', status: 'active', tokenBudget: null,
      tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
    };
    const transport = new FakeTransport({
      'thread/goal/set': () => ({ goal }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    await surface.connect();
    await surface.sendMessage('/compact');
    expect(lastRequest(transport, 'thread/compact/start')).toMatchObject({ params: { threadId: 'thread-existing' } });
    await surface.sendMessage('/plan');
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({ params: { collaborationMode: { mode: 'plan' } } });
    await surface.sendMessage('/goal Ship it');
    expect(surface.getSnapshot().goal).toMatchObject({ objective: 'Ship it' });

    await surface.sendMessage('First');
    await surface.sendMessage('Second');
    expect(surface.getSnapshot().queuedPrompts).toMatchObject([{ text: 'Second' }]);
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) },
    });
    await vi.waitFor(() => expect(
      transport.sent.filter((message) => 'method' in message && message.method === 'turn/start'),
    ).toHaveLength(2));
    expect(surface.getSnapshot()).toMatchObject({ busy: true, queuedPrompts: [] });
  });

  it('exposes skills, goals, context usage, diffs, and rollback-backed message deletion', async () => {
    const transport = new FakeTransport({
      'skills/list': () => ({
        data: [{
          cwd: '/tmp/project', errors: [], skills: [{
            name: 'reviewer', description: 'Review code', shortDescription: null, path: '/tmp/reviewer/SKILL.md',
            scope: 'repo', enabled: true, interface: { displayName: 'Reviewer' },
          }],
        }],
      }),
      'thread/rollback': () => ({ thread: thread('thread-existing', false) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    await surface.connect();
    expect(surface.getSnapshot().skills).toMatchObject([{ name: 'reviewer', displayName: 'Reviewer' }]);
    transport.emit({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread-existing', turnId: 'turn-history',
        tokenUsage: {
          total: { totalTokens: 200, inputTokens: 120, cachedInputTokens: 20, outputTokens: 80, reasoningOutputTokens: 30 },
          last: { totalTokens: 100, inputTokens: 60, cachedInputTokens: 10, outputTokens: 40, reasoningOutputTokens: 15 },
          modelContextWindow: 1000,
        },
      },
    });
    transport.emit({
      method: 'turn/diff/updated',
      params: { threadId: 'thread-existing', turnId: 'turn-history', diff: '@@ -1 +1,2 @@\n-old\n+new\n+line' },
    });
    transport.emit({
      method: 'thread/goal/updated',
      params: {
        threadId: 'thread-existing', turnId: null,
        goal: {
          threadId: 'thread-existing', objective: 'Finish', status: 'active', tokenBudget: 1000,
          tokensUsed: 200, timeUsedSeconds: 10, createdAt: 1, updatedAt: 2,
        },
      },
    });
    expect(surface.getSnapshot()).toMatchObject({
      contextUsage: { totalTokens: 200, lastTotalTokens: 100, usedPercent: 10 },
      goal: { objective: 'Finish', tokenBudget: 1000 },
      turnGitDiff: { addedLines: 2, removedLines: 1 },
    });
    await surface.deleteMessage(0);
    expect(lastRequest(transport, 'thread/rollback')).toMatchObject({
      params: { threadId: 'thread-existing', numTurns: 1 },
    });
    expect(surface.getSnapshot().messages).toStrictEqual([]);
  });

  it('uses app-server cwd defaults and reports unavailable conversation operations precisely', async () => {
    const goal = {
      threadId: 'thread-new', objective: 'Ship', status: 'active', tokenBudget: null,
      tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
    };
    const transport = new FakeTransport({
      'skills/list': () => { throw new Error('skills unavailable'); },
      'thread/list': () => ({ data: [], nextCursor: null }),
      'thread/goal/set': () => ({ goal }),
      'review/start': () => ({ turn: turn('review-complete', 'completed', []), reviewThreadId: 'thread-new' }),
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      conversationLimit: 0,
    });
    await surface.connect();
    expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: null,
      skillCatalogStatus: 'error',
      skills: [],
    });
    expect(lastRequest(transport, 'thread/list')).toBeUndefined();
    expect(lastRequest(transport, 'skills/list')).toMatchObject({ params: { forceReload: false } });
    expect(lastRequest(transport, 'permissionProfile/list')).toMatchObject({ params: { cursor: null } });
    await expect(surface.clearGoal()).resolves.toMatchObject({ activeConversationId: null });
    await expect(surface.sendMessage('/goal')).resolves.toMatchObject({ activeConversationId: null });
    await expect(surface.sendMessage('/goal edit')).resolves.toMatchObject({ activeConversationId: null });
    await expect(surface.sendMessage('/goal clear')).resolves.toMatchObject({ activeConversationId: null });
    await expect(surface.sendMessage('/compact')).resolves.toMatchObject({ activeConversationId: null });
    await expect(surface.sendMessage('/goal pause')).rejects.toThrow('not supported');
    expect(lastRequest(transport, 'thread/start')).toBeUndefined();
    expect(lastRequest(transport, 'thread/goal/clear')).toBeUndefined();
    expect(lastRequest(transport, 'thread/compact/start')).toBeUndefined();

    await surface.setGoal('Ship');
    expect(lastRequest(transport, 'thread/start')).not.toMatchObject({ params: { cwd: expect.anything() } });
    expect(lastRequest(transport, 'thread/goal/set')).toMatchObject({
      params: { threadId: 'thread-new', objective: 'Ship', status: 'active' },
    });
    await expect(surface.setGoal('   ')).rejects.toThrow('cannot be empty');
    await surface.setGoal(' Ship ', null);
    expect(lastRequest(transport, 'thread/goal/set')).toMatchObject({
      params: { threadId: 'thread-new', objective: 'Ship', status: 'active', tokenBudget: null },
    });
    await surface.clearGoal();
    expect(lastRequest(transport, 'thread/goal/clear')).toMatchObject({ params: { threadId: 'thread-new' } });
    await surface.sendMessage('/review');
    expect(surface.getSnapshot().busy).toBe(false);
  });

  it('creates zero-config conversations only for slash commands that need a thread', async () => {
    const goal = {
      threadId: 'thread-new', objective: 'Ship it', status: 'active', tokenBudget: null,
      tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
    };
    const goalTransport = new FakeTransport({
      'thread/list': () => ({ data: [], nextCursor: null }),
      'thread/goal/set': () => ({ goal }),
    });
    const goalSurface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(goalTransport),
      conversationDefaults: { model: 'gpt-5', reasoningEffort: 'medium' },
    });
    await goalSurface.connect();
    await goalSurface.sendMessage('/goal Ship it');
    expect(lastRequest(goalTransport, 'thread/start')).toMatchObject({ params: { model: 'gpt-5' } });
    expect(lastRequest(goalTransport, 'thread/goal/set')).toMatchObject({
      params: { threadId: 'thread-new', objective: 'Ship it' },
    });
    expect(lastRequest(goalTransport, 'turn/start')).toBeUndefined();

    const reviewTransport = new FakeTransport({
      'thread/list': () => ({ data: [], nextCursor: null }),
      'review/start': () => ({
        turn: turn('review-turn', 'inProgress', [{
          type: 'userMessage', id: 'review-turn', clientId: null,
          content: [{ type: 'text', text: 'current changes', textElements: [] }],
        }]),
        reviewThreadId: 'thread-new',
      }),
    });
    const reviewSurface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(reviewTransport),
      conversationDefaults: { model: 'gpt-5', reasoningEffort: 'medium' },
    });
    await reviewSurface.connect();
    const reviewEvents: unknown[] = [];
    reviewSurface.onEvent((event) => reviewEvents.push(event));
    await reviewSurface.sendMessage('/review');
    expect(lastRequest(reviewTransport, 'thread/start')).toMatchObject({ params: { model: 'gpt-5' } });
    expect(lastRequest(reviewTransport, 'review/start')).toMatchObject({
      params: {
        threadId: 'thread-new', delivery: 'inline',
        target: { type: 'uncommittedChanges' },
      },
    });
    expect(lastRequest(reviewTransport, 'turn/start')).toBeUndefined();
    expect(reviewSurface.getSnapshot().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        parts: [{
          type: 'text',
          text: 'Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.',
        }],
        metadata: expect.objectContaining({ reviewPrompt: true }),
      }),
    ]));
    expect(reviewEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'message.appended', origin: 'action',
        payload: expect.objectContaining({
          message: expect.objectContaining({
            parts: [{
              type: 'text',
              text: 'Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.',
            }],
          }),
        }),
      }),
    ]));
  });

  it('inherits zero-thread UI selections when the first normal prompt creates a conversation', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [], nextCursor: null }),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
    });
    await surface.connect();
    await surface.updateConversationSettings({
      approvalPreset: 'full-access',
      modelId: 'gpt-mini',
      reasoningEffort: 'high',
      planMode: true,
    });

    await surface.sendMessage('Build the app');

    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: {
        approvalPolicy: 'never', approvalsReviewer: 'user', permissions: ':danger-full-access',
        model: 'gpt-mini-runtime',
      },
    });
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: {
        threadId: 'thread-new', effort: 'high',
        collaborationMode: {
          mode: 'plan',
          settings: { model: 'gpt-mini-runtime', reasoning_effort: 'high' },
        },
      },
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: {
        threadId: 'thread-new', model: 'gpt-mini-runtime', effort: 'high',
        collaborationMode: {
          mode: 'plan',
          settings: { model: 'gpt-mini-runtime', reasoning_effort: 'high' },
        },
      },
    });
    expect(surface.getSnapshot()).toMatchObject({
      approvalPreset: 'full-access', selectedModelId: 'gpt-mini', selectedReasoningEffort: 'high', planMode: true,
    });
  });

  it('uses an explicitly switched model default instead of inheriting incompatible reasoning', async () => {
    const transport = new FakeTransport({
      'thread/list': () => ({ data: [], nextCursor: null }),
    });
    const surface = new CodexSurface({
      autoSelectFirstConversation: false,
      client: new CodexAppServerClient(transport),
    });
    await surface.connect();
    await surface.updateConversationSettings({ modelId: 'gpt-mini', reasoningEffort: 'high' });

    await expect(surface.createConversation({ model: 'gpt-5' })).resolves.toMatchObject({
      selectedModelId: 'gpt-5', selectedReasoningEffort: 'medium',
    });
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: {
        threadId: 'thread-new', effort: 'medium',
        collaborationMode: { settings: { model: 'gpt-5', reasoning_effort: 'medium' } },
      },
    });
  });

  it('backs edit, retry, delete, and queued prompt actions with real surface operations', async () => {
    const edited = createSurface();
    await edited.surface.connect();
    await expect(edited.surface.deleteMessage(-1)).rejects.toThrow('Unknown message index');
    await expect(edited.surface.editMessage(1, 'Nope')).rejects.toThrow('Only user messages');
    await expect(edited.surface.editMessage(0, '   ')).rejects.toThrow('empty content');
    await edited.surface.editMessage(0, 'Edited prompt');
    expect(lastRequest(edited.transport, 'thread/rollback')).toMatchObject({ params: { numTurns: 1 } });
    expect(lastRequest(edited.transport, 'turn/start')).toMatchObject({
      params: { input: [{ type: 'text', text: 'Edited prompt' }] },
    });

    const retried = createSurface();
    await retried.surface.connect();
    await retried.surface.retryMessage(1);
    expect(lastRequest(retried.transport, 'thread/rollback')).toMatchObject({ params: { numTurns: 1 } });
    expect(lastRequest(retried.transport, 'turn/start')).toMatchObject({
      params: { input: [{ type: 'text', text: 'Hello' }] },
    });

    const queued = createSurface();
    await queued.surface.connect();
    await queued.surface.sendMessage('First');
    const firstQueue = await queued.surface.sendMessage('Delete me');
    const deleteId = firstQueue.queuedPrompts[0]!.id;
    await queued.surface.deleteQueuedPrompt(deleteId);
    await expect(queued.surface.deleteQueuedPrompt(deleteId)).rejects.toThrow('Unknown queued prompt');
    await queued.surface.sendMessage('Keep my position');
    const secondQueue = await queued.surface.sendMessage('Edit me');
    const editId = secondQueue.queuedPrompts[1]!.id;
    await expect(queued.surface.updateQueuedPrompt(editId, '   ')).rejects.toThrow('empty content');
    const updatedQueue = await queued.surface.updateQueuedPrompt(editId, 'Edited in place');
    expect(updatedQueue.queuedPrompts.map(({ id, text }) => ({ id, text }))).toStrictEqual([
      { id: secondQueue.queuedPrompts[0]!.id, text: 'Keep my position' },
      { id: editId, text: 'Edited in place' },
    ]);
    await queued.surface.steerQueuedPrompt(editId, 'Edited and steered');
    expect(lastRequest(queued.transport, 'turn/steer')).toMatchObject({
      params: { input: [{ type: 'text', text: 'Edited and steered' }] },
    });
    await expect(queued.surface.steerQueuedPrompt('missing')).rejects.toThrow('Unknown queued prompt');
  });

});
