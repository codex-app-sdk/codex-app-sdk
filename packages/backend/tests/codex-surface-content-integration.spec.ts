import { describe, expect, it, vi } from 'vitest';
import type { CodexSurfaceEvent } from '@codex-app-sdk/core/surface';
import { createCodexConversationReplica } from '@codex-app-sdk/core';
import { CodexAppServerClient, type v2 } from '../src/codex';
import { CodexSurface } from '../src/node';
import { MockCodexAppServer, createSurface, deferred, lastRequest, resumeResponse, testGoal, thread, turn } from './helpers/codex-surface-fixture';

describe('CodexSurface', () => {
  it('preserves completion and messages received while resume is pending', async () => {
    const restored = thread('thread-existing', false);
    restored.status = { type: 'active', activeFlags: [] };
    restored.turns = [turn('race-turn', 'inProgress', [])];
    const response = deferred<ReturnType<typeof resumeResponse>>();
    const transport = new MockCodexAppServer({ 'thread/resume': () => response.promise });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    const connecting = surface.connect();
    await vi.waitFor(() => expect(lastRequest(transport, 'thread/resume')).toBeDefined());
    transport.emitNotification('item/agentMessage/delta', {
      threadId: 'thread-existing', turnId: 'race-turn', itemId: 'race-answer', delta: 'Finished during resume',
    });
    transport.emitNotification('turn/completed', {
      threadId: 'thread-existing', turn: turn('race-turn', 'completed', []),
    });
    response.resolve(resumeResponse(restored));
    await connecting;
    expect(surface.getSnapshot()).toMatchObject({ busy: false, activeTurnId: null,
      turns: [expect.objectContaining({ id: 'race-turn', status: 'completed' })],
      messages: [expect.objectContaining({ parts: [expect.objectContaining({ text: 'Finished during resume' })] })],
    });
  });

  it('does not resurrect historical questions or execution when resuming an idle thread', async () => {
    const restored = thread('thread-existing', false);
    restored.status = { type: 'idle' };
    restored.turns = [turn('old-turn', 'inProgress', [{
      type: 'agentMessage', id: 'old-question', text: 'Pick one', phase: null,
      memoryCitation: null, delivery: 'async', questions: [{ title: 'Pick one', options: null }],
    }])];
    const transport = new MockCodexAppServer({
      'thread/resume': () => resumeResponse(restored),
      'turn/start': () => ({ turn: turn('turn-live', 'inProgress', []) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    expect(surface.getSnapshot()).toMatchObject({ busy: false, activeTurnId: null, clientRequests: [] });
    expect(surface.getSnapshot().turns).toMatchObject([{ id: 'old-turn', status: 'interrupted' }]);
    expect(surface.getSnapshot().messages).not.toHaveLength(0);
    await surface.sendMessage('New work');
    expect(lastRequest(transport, 'turn/start')).toBeDefined();
    expect(surface.getSnapshot().queuedPrompts).toEqual([]);
  });

  it('clears stale execution on authoritative idle even when turn/completed was missed', async () => {
    const { surface, transport } = createSurface('turn/start');
    await surface.connect();
    const replica = createCodexConversationReplica(surface.getConversationSnapshot('thread-existing'));
    surface.onConversationEvent('thread-existing', (event) => replica.apply(event));
    transport.emitNotification('turn/started', {
      threadId: 'thread-existing', turn: turn('lost-completion', 'inProgress', []),
    });
    expect(surface.getSnapshot().busy).toBe(true);
    transport.emitNotification('thread/status/changed', {
      threadId: 'thread-existing', status: { type: 'idle' },
    });
    expect(surface.getSnapshot()).toMatchObject({ busy: false, activeTurnId: null });
    expect(surface.getSnapshot().turns).toContainEqual(expect.objectContaining({
      id: 'lost-completion', status: 'interrupted',
    }));
    expect(replica.getSnapshot()).toMatchObject({ busy: false, activeTurnId: null,
      turns: expect.arrayContaining([expect.objectContaining({ id: 'lost-completion', status: 'interrupted' })]),
    });
    await surface.sendMessage('New work');
    expect(lastRequest(transport, 'turn/start')).toBeDefined();
  });

  it('projects asynchronous agent questions as answerable surface requests', async () => {
    const { surface, transport } = createSurface('turn/start');
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();
    transport.emitNotification('item/agentMessage/delta', {
        threadId: 'thread-existing',
        turnId: 'turn-question',
        itemId: 'agent-question',
        delta: 'Which framework should I use?',
      });
    events.length = 0;

    transport.emitNotification('item/completed', {
        threadId: 'thread-existing',
        turnId: 'turn-question',
        completedAtMs: 1_700_000_002_000,
        item: {
          type: 'agentMessage',
          id: 'agent-question',
          text: 'Which framework should I use?\n- Vue\n- React',
          phase: null,
          memoryCitation: null,
          delivery: 'async',
          questions: [{ title: 'Which framework should I use?', options: ['Vue', 'React'] }],
        },
      });

    const request = {
      id: 'async-question:agent-question',
      kind: 'ask_user',
      conversationId: 'thread-existing',
      turnId: 'turn-question',
      itemId: 'agent-question',
      payload: {
        request: {
          itemId: 'agent-question',
          delivery: 'async',
          blocking: false,
          questions: [{
            id: '["request_user_input_async","agent-question",0]',
            header: 'Which framework should I use?',
            question: 'Which framework should I use?',
            isOther: true,
            isSecret: false,
            options: [
              { label: 'Vue', description: '' },
              { label: 'React', description: '' },
            ],
          }],
        },
      },
    } as const;
    expect(surface.getConversationSnapshot('thread-existing')).toMatchObject({
      clientRequests: [request],
      messages: [
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          id: 'assistant-turn-question',
          parts: [{ type: 'question', request }],
        }),
      ],
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message.updated',
      conversationId: 'thread-existing',
      turnId: 'turn-question',
      payload: {
        message: expect.objectContaining({
          parts: [{ type: 'question', request }],
        }),
      },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'clientRequest.requested',
      conversationId: 'thread-existing',
      turnId: 'turn-question',
      payload: { request },
    }));
    transport.emitNotification('turn/completed', {
        threadId: 'thread-existing',
        turn: turn('turn-question', 'completed', []),
      });

    await surface.conversation('thread-existing').respondToClientRequest({
      id: request.id,
      payload: { answers: { [request.payload.request.questions[0].id]: { answers: ['Vue'] } } },
    });

    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        input: [{
          type: 'text',
          text: '<send_user_message_question_reply>\n'
            + '[{"questionItemId":"[\\"request_user_input_async\\",\\"agent-question\\",0]","question":"Which framework should I use?","answer":"Vue"}]\n'
            + '</send_user_message_question_reply>',
        }],
      },
    });
    expect(surface.getConversationSnapshot('thread-existing')).toMatchObject({
      clientRequests: [],
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          parts: [{ type: 'text', text: 'Vue' }],
        }),
      ]),
    });

    await surface.close();
  });

  it('connects, returns state, publishes summaries, and refreshes plugins from conversation refresh', async () => {
    let pluginLoads = 0;
    const transport = new MockCodexAppServer({
      'plugin/installed': () => {
        pluginLoads += 1;
        return { marketplaces: [], marketplaceLoadErrors: [] };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));

    const snapshot = await surface.refreshConversations();
    await vi.waitFor(() => expect(pluginLoads).toBe(2));

    expect(transport.start).toHaveBeenCalledOnce();
    expect(snapshot).toMatchObject({
      status: 'ready',
      conversations: [expect.objectContaining({ id: 'thread-existing' })],
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'conversation.summaryUpserted',
      origin: 'action',
      conversationId: 'thread-existing',
      payload: expect.objectContaining({ reason: 'listed' }),
    }));
    await surface.close();
  });

  it('publishes the complete semantic state when creating a conversation', async () => {
    const { surface } = createSurface('thread/start', 'thread/settings/update');
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();
    events.length = 0;

    const snapshot = await surface.createConversation();

    expect(snapshot.activeConversationId).toBe('thread-new');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'conversation.summaryUpserted', origin: 'action', conversationId: 'thread-new',
        payload: expect.objectContaining({ reason: 'created' }),
      }),
      expect.objectContaining({
        type: 'conversation.selected', origin: 'action',
        payload: { conversationId: 'thread-new' },
      }),
      expect.objectContaining({
        type: 'conversation.activityChanged', origin: 'action', conversationId: 'thread-new',
      }),
      expect.objectContaining({
        type: 'conversation.settingsChanged', origin: 'action', conversationId: 'thread-new',
      }),
      expect.objectContaining({
        type: 'conversation.skillsChanged', origin: 'action', conversationId: 'thread-new',
      }),
      expect.objectContaining({
        type: 'conversation.permissionsChanged', origin: 'action', conversationId: 'thread-new',
      }),
    ]));
    await surface.close();
  });

  it('restores conversation loading state when resume fails', async () => {
    const transport = new MockCodexAppServer({
      'thread/resume': () => {
        throw new Error('resume unavailable');
      },
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport), autoSelectFirstConversation: false,
    });
    await surface.connect();

    await expect(surface.conversation('thread-failing').load()).rejects.toThrow('resume unavailable');

    expect(surface.getConversationSnapshot('thread-failing')).toMatchObject({
      historyLoading: false,
      error: 'resume unavailable',
    });
    await surface.close();
  });

  it('creates a conversation when review starts before bootstrap without a selected thread', async () => {
    const transport = new MockCodexAppServer({
      'thread/list': () => ({ backwardsCursor: null, data: [], nextCursor: null }),
      'thread/start': () => resumeResponse(thread('thread-new', false)),
      'thread/settings/update': () => ({}),
      'review/start': (params) => ({
        turn: turn('turn-new-review', 'completed', []),
        reviewThreadId: (params as { threadId: string }).threadId,
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));

    await surface.startReview();

    expect(lastRequest(transport, 'initialize')).toBeDefined();
    expect(lastRequest(transport, 'thread/start')).toBeDefined();
    expect(lastRequest(transport, 'review/start')).toMatchObject({
      params: { threadId: 'thread-new', delivery: 'inline' },
    });
    expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-new',
      conversations: [expect.objectContaining({ id: 'thread-new', turnCount: 1 })],
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'conversation.activityChanged',
      origin: 'action',
      conversationId: 'thread-new',
      payload: expect.objectContaining({ busy: true }),
    }));
    await surface.close();
  });

  it('hydrates older history before rolling back to a non-materialized turn', async () => {
    const oldTurn = turn('turn-old', 'completed', []);
    const transport = new MockCodexAppServer({
      'thread/resume': () => ({
        ...resumeResponse(thread('thread-existing', false)),
        initialTurnsPage: {
          data: [turn('turn-newest', 'completed', [])], nextCursor: 'older-page', backwardsCursor: null,
        },
      }),
      'thread/turns/list': () => ({ data: [oldTurn], nextCursor: null, backwardsCursor: null }),
      'thread/rollback': () => ({ thread: thread('thread-existing', false) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();

    await surface.conversation('thread-existing').deleteTurn('turn-old');

    expect(lastRequest(transport, 'thread/turns/list')).toMatchObject({
      params: { threadId: 'thread-existing', cursor: 'older-page', itemsView: 'full' },
    });
    expect(lastRequest(transport, 'thread/rollback')).toMatchObject({
      params: { threadId: 'thread-existing', numTurns: 2 },
    });
    await surface.close();
  });

  it('projects review startup and authoritative completion through conversation summaries', async () => {
    const review = deferred<v2.ReviewStartResponse>();
    const transport = new MockCodexAppServer({ 'review/start': () => review.promise });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();
    events.length = 0;

    const start = surface.startReview();
    await vi.waitFor(() => expect(lastRequest(transport, 'review/start')).toBeDefined());
    expect(surface.getSnapshot()).toMatchObject({
      busy: true,
      conversations: [expect.objectContaining({ id: 'thread-existing', status: 'active' })],
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'conversation.summaryUpserted',
      origin: 'action',
      payload: expect.objectContaining({ summary: expect.objectContaining({ status: 'active' }) }),
    }));

    review.resolve({
      turn: turn('turn-review-projection', 'completed', []),
      reviewThreadId: 'thread-existing',
    });
    await start;

    expect(surface.getSnapshot()).toMatchObject({
      busy: false,
      conversations: [expect.objectContaining({ id: 'thread-existing', status: 'idle', turnCount: 2 })],
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'conversation.summaryUpserted',
      origin: 'action',
      payload: expect.objectContaining({ summary: expect.objectContaining({ turnCount: 2 }) }),
    }));
    await surface.close();
  });

  it('provides scoped conversation discovery, skill catalogs, attachments, and turn deletion', async () => {
    const transport = new MockCodexAppServer({
      'thread/list': (params) => ({ backwardsCursor: null,
        data: [{ ...thread('thread-existing', true), cwd: String((params as { cwd?: string }).cwd ?? '/tmp/project') }],
        nextCursor: null,
      }),
      'skills/list': (params) => {
        const cwd = (params as { cwds?: string[] }).cwds?.[0] ?? '/global';
        return {
          data: [{
            cwd,
            skills: [{ pluginId: null,
              name: 'workspace-skill', description: cwd, path: `${cwd}/SKILL.md`, scope: 'repo',
              enabled: true, interface: undefined,
            }],
            errors: [],
          }],
        };
      },
      'turn/start': () => ({ turn: turn('turn-live', 'inProgress', []) }),
      'turn/steer': () => ({ turnId: 'turn-live' }),
      'thread/rollback': () => ({ thread: thread('thread-existing', false) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();

    await expect(surface.listConversations({ cwd: '/workspace/specific', limit: 5 }))
      .resolves.toMatchObject([{ id: 'thread-existing', cwd: '/workspace/specific' }]);
    expect(lastRequest(transport, 'thread/list')).toMatchObject({
      params: { cwd: '/workspace/specific', limit: 5, archived: false },
    });
    await expect(surface.listSkills({ cwd: '/workspace/specific', forceReload: true }))
      .resolves.toMatchObject([{ name: 'workspace-skill', path: '/workspace/specific/SKILL.md' }]);

    await surface.sendMessage('Inspect attachments', {
      attachments: [
        { type: 'image', path: '/tmp/screenshot.png', detail: 'high' },
        { type: 'file', path: '/tmp/README.md', name: 'README' },
      ],
    });
    expect(surface.getSnapshot().messages.find((message) => (
      message.role === 'user' && message.parts.some((part) => part.type === 'attachment')
    ))).toMatchObject({
      parts: [
        { type: 'text', text: 'Inspect attachments' },
        { type: 'attachment', attachment: { kind: 'image', name: 'screenshot.png', path: '/tmp/screenshot.png' } },
        { type: 'attachment', attachment: { kind: 'file', name: 'README', path: '/tmp/README.md' } },
      ],
    });
    await surface.sendMessage('Queued with attachment', {
      attachments: [{ type: 'file', path: '/tmp/queued.txt' }],
    });
    const queuedPromptId = surface.getSnapshot().queuedPrompts[0]?.id;
    expect(queuedPromptId).toBeDefined();
    await surface.steerQueuedPrompt(queuedPromptId!);
    expect(surface.getSnapshot().queuedPrompts).toHaveLength(0);
    expect(lastRequest(transport, 'turn/steer')).toMatchObject({
      params: {
        input: [
          { type: 'text', text: 'Queued with attachment' },
          { type: 'mention', path: '/tmp/queued.txt', name: 'queued.txt' },
        ],
      },
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: {
        input: [
          { type: 'text', text: 'Inspect attachments' },
          { type: 'localImage', path: '/tmp/screenshot.png', detail: 'high' },
          { type: 'mention', path: '/tmp/README.md', name: 'README' },
        ],
      },
    });
    transport.emitNotification('turn/completed', { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) });
    const conversation = surface.conversation('thread-existing');
    expect(conversation.getSnapshot()).toMatchObject({
      activeTurnId: null,
      turnIds: ['turn-history', 'turn-live'],
      turns: [
        { id: 'turn-history', status: 'completed' },
        { id: 'turn-live', status: 'completed' },
      ],
    });
    expect(surface.getSnapshot().conversations).toContainEqual(expect.objectContaining({
      id: 'thread-existing', turnCount: 2,
    }));
    events.length = 0;
    const rolledBack = await conversation.deleteTurn('turn-history');
    expect(lastRequest(transport, 'thread/rollback')).toMatchObject({
      params: { threadId: 'thread-existing', numTurns: 2 },
    });
    expect(rolledBack).toMatchObject({ activeConversationId: 'thread-existing', activeTurnId: null, turnIds: [] });
    expect(surface.getSnapshot().conversations).toContainEqual(expect.objectContaining({
      id: 'thread-existing', turnCount: 0,
    }));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'conversation.summaryUpserted',
        origin: 'action',
        payload: expect.objectContaining({
          reason: 'updated', summary: expect.objectContaining({ id: 'thread-existing', turnCount: 0 }),
        }),
      }),
      expect.objectContaining({
        type: 'conversation.historyReplaced',
        origin: 'action',
        conversationId: 'thread-existing',
        payload: expect.objectContaining({ reason: 'rollback', messages: [] }),
      }),
    ]));
    await expect(conversation.sendMessage('Bad attachment', {
      attachments: [{ type: 'file', path: 'relative.txt' }],
    })).rejects.toThrow('Attachment path must be absolute');
  });

  it('preserves structured attachments when retrying and editing user messages', async () => {
    const { surface, transport } = createSurface('turn/start', 'thread/rollback');
    await surface.connect();
    const attachments = [
      {
        type: 'image' as const,
        path: '/tmp/screenshot.png',
        name: 'Screenshot',
        mimeType: 'image/png',
        previewUrl: 'data:image/png;base64,cG5n',
      },
      { type: 'file' as const, path: '/tmp/README.md', name: 'README', mimeType: 'text/markdown' },
    ];
    await surface.sendMessage('Original prompt', { attachments });
    transport.emitNotification('turn/completed', { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) });
    await surface.retryTurn('turn-live');
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: {
        input: [
          { type: 'text', text: 'Original prompt' },
          { type: 'localImage', path: '/tmp/screenshot.png' },
          { type: 'mention', path: '/tmp/README.md', name: 'README' },
        ],
      },
    });
    transport.emitNotification('turn/completed', { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) });
    await surface.editTurn('turn-live', 'Edited prompt');
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: {
        input: [
          { type: 'text', text: 'Edited prompt' },
          { type: 'localImage', path: '/tmp/screenshot.png' },
          { type: 'mention', path: '/tmp/README.md', name: 'README' },
        ],
      },
    });
  });

  it('continues a hydrated in-progress assistant message without duplicating its segment', async () => {
    const runningThread = thread('thread-running', false);
    runningThread.status = { type: 'active', activeFlags: [] };
    runningThread.turns = [turn('turn-running', 'inProgress', [
      { type: 'userMessage', id: 'user-running', clientId: null, content: [{ type: 'text', text: 'Continue', text_elements: [] }] },
      { type: 'agentMessage', id: 'agent-running', text: 'Hello', phase: null, memoryCitation: null, delivery: null, questions: null },
    ])];
    const transport = new MockCodexAppServer({
      'thread/list': () => ({ backwardsCursor: null, data: [thread('thread-running', false)], nextCursor: null }),
      'thread/resume': () => resumeResponse(runningThread),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();

    transport.emitNotification('item/agentMessage/delta', {
        threadId: 'thread-running', turnId: 'turn-running', itemId: 'agent-running', delta: ' world',
      });
    transport.emitNotification('turn/completed', { threadId: 'thread-running', turn: turn('turn-running', 'completed', []) });

    const assistant = surface.getSnapshot().messages.filter((message) => (
      message.role === 'assistant' && message.turnId === 'turn-running'
    ));
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({
      status: 'complete',
      metadata: { conversationId: 'thread-running', turnId: 'turn-running' },
      parts: [{ type: 'text', itemId: 'agent-running', text: 'Hello world' }],
    });
  });

  it('derives skill inputs from plain prompts and rejects renderer-supplied skill paths outside the catalog', async () => {
    const transport = new MockCodexAppServer({
      'skills/list': () => ({
        data: [{
          cwd: '/tmp/project', errors: [], skills: [
            { pluginId: null, name: 'pdf', description: 'PDF tools', path: '/trusted/pdf/SKILL.md', scope: 'user', enabled: true },
            { pluginId: null, name: 'disabled', description: 'Disabled', path: '/trusted/disabled/SKILL.md', scope: 'user', enabled: false },
          ],
        }],
      }),
      'turn/start': () => ({ turn: turn('turn-live', 'inProgress', []) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    expect(surface.getSnapshot().skills).toStrictEqual([
      expect.objectContaining({ name: 'pdf', enabled: true }),
    ]);

    await expect(surface.sendMessage('bad', {
      skills: [{ name: 'pdf', path: '/tmp/attacker/SKILL.md' }],
    })).rejects.toThrow("Skill 'pdf' is not an enabled skill");
    expect(lastRequest(transport, 'turn/start')).toBeUndefined();
    await expect(surface.sendMessage('bad', {
      skills: [{ name: 'disabled', path: '/trusted/disabled/SKILL.md' }],
    })).rejects.toThrow("Skill 'disabled' is not an enabled skill");

    await surface.sendMessage('Use $pdf and /pdf', {
      skills: [{ name: 'pdf', path: '/trusted/pdf/SKILL.md' }],
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: {
        input: [
          { type: 'text', text: 'Use $pdf and /pdf' },
          { type: 'skill', name: 'pdf', path: '/trusted/pdf/SKILL.md' },
        ],
      },
    });
    expect(lastRequest(transport, 'turn/start')).not.toMatchObject({ params: { cwd: expect.anything() } });
  });

  it('preserves slash command semantics and exposes structured review, rename, and non-mutating history operations', async () => {
    const goal = testGoal({ objective: 'Existing goal' });
    const transport = new MockCodexAppServer({
      'thread/goal/get': () => ({ goal }),
      'thread/resume': (params) => {
        const threadId = (params as { threadId: string }).threadId;
        if (threadId !== 'thread-running-read') return resumeResponse(thread(threadId, true));
        const running = thread(threadId, false);
        running.status = { type: 'active', activeFlags: [] };
        running.turns = [turn('turn-running-read', 'inProgress', [])];
        return resumeResponse(running);
      },
      'thread/goal/clear': () => ({ cleared: true }),
      'thread/read': (params) => {
        const threadId = (params as { threadId: string }).threadId;
        if (threadId === 'thread-running-read') {
          const running = thread(threadId, false);
          running.status = { type: 'active', activeFlags: [] };
          running.turns = [turn('turn-running-read', 'inProgress', [])];
          return { thread: running };
        }
        return { thread: thread(threadId, true) };
      },
      'thread/turns/list': (params) => {
        const threadId = (params as { threadId: string }).threadId;
        return {
          data: threadId === 'thread-running-read'
            ? [turn('turn-running-read', 'inProgress', [])]
            : thread(threadId, true).turns,
          nextCursor: null,
          backwardsCursor: null,
        };
      },
      'review/start': (params) => ({
        turn: turn('review-complete', 'completed', []),
        reviewThreadId: (params as { threadId: string }).threadId,
      }),
      'thread/settings/update': () => ({}),
      'turn/start': () => ({ turn: turn('turn-live', 'inProgress', []) }),
      'thread/name/set': () => ({}),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();
    expect((await surface.sendMessage('/goal')).goal).toMatchObject({ objective: 'Existing goal' });
    expect((await surface.sendMessage('/goal edit')).goal).toMatchObject({ objective: 'Existing goal' });
    await surface.sendMessage('/goal clear');
    expect(surface.getSnapshot().goal).toBeNull();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'conversation.goalChanged',
      origin: 'action',
      conversationId: 'thread-existing',
      payload: { goal: null },
    }));
    await expect(surface.sendMessage('/goal pause')).rejects.toThrow('not supported');

    await surface.sendMessage('/plan Build a plan');
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: { threadId: 'thread-existing', collaborationMode: { mode: 'plan' } },
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: { threadId: 'thread-existing', input: [{ type: 'text', text: 'Build a plan' }] },
    });
    transport.emitNotification('turn/completed', { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) });

    await surface.sendMessage('/review focus on regressions');
    expect(lastRequest(transport, 'review/start')).toMatchObject({
      params: { target: { type: 'custom', instructions: 'focus on regressions' }, delivery: 'inline' },
    });
    await surface.startReview({ target: { type: 'baseBranch', branch: 'main' } });
    expect(lastRequest(transport, 'review/start')).toMatchObject({
      params: { target: { type: 'baseBranch', branch: 'main' } },
    });
    await surface.conversation('thread-existing').startReview({ target: { type: 'commit', sha: 'abc123' } });
    expect(lastRequest(transport, 'review/start')).toMatchObject({
      params: { target: { type: 'commit', sha: 'abc123', title: null } },
    });

    await surface.conversation('thread-existing').rename('Renamed');
    expect(lastRequest(transport, 'thread/name/set')).toMatchObject({
      params: { threadId: 'thread-existing', name: 'Renamed' },
    });
    await surface.renameConversation('Renamed again');
    expect(lastRequest(transport, 'thread/name/set')).toMatchObject({
      params: { threadId: 'thread-existing', name: 'Renamed again' },
    });
    expect(surface.getSnapshot().conversations).toContainEqual(expect.objectContaining({
      id: 'thread-existing', title: 'Renamed again',
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'conversation.summaryUpserted',
      origin: 'action',
      payload: expect.objectContaining({
        reason: 'updated', summary: expect.objectContaining({ title: 'Renamed again' }),
      }),
    }));
    await expect(surface.readConversationHistory()).resolves.toMatchObject({
      conversationId: 'thread-existing',
    });
    const history = await surface.conversation('thread-other').readHistory();
    expect(history).toMatchObject({
      conversationId: 'thread-other',
      messages: [expect.objectContaining({ role: 'user' }), expect.objectContaining({ role: 'assistant' })],
    });
    const runningHistory = await surface.readConversationHistory('thread-running-read');
    expect(runningHistory).toMatchObject({
      conversationId: 'thread-running-read',
      threadStatus: { type: 'active' },
      messages: [expect.objectContaining({
        id: 'assistant-turn-running-read', role: 'assistant', status: 'streaming', parts: [],
      })],
    });
    expect(surface.getSnapshot().activeConversationId).toBe('thread-existing');
    expect(transport.sent.filter((message) => (
      'method' in message
      && message.method === 'thread/read'
      && (message.params as { includeTurns?: boolean }).includeTurns === false
    ))).toHaveLength(2);
  });

  it('validates create settings before persistence and rejects detached responses for inline reviews', async () => {
    const transport = new MockCodexAppServer({
      'thread/start': () => resumeResponse(thread('thread-new', false)),
      'thread/settings/update': () => ({}),
      'review/start': () => ({
        turn: turn('turn-review', 'inProgress', []),
        reviewThreadId: 'thread-detached',
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await expect(surface.sendMessage('bad model', { model: 'missing' })).rejects.toThrow("Unknown model 'missing'");
    await expect(surface.sendMessage('bad effort', { reasoningEffort: 'ultra' }))
      .rejects.toThrow("Reasoning effort 'ultra' is not available");
    expect(lastRequest(transport, 'turn/start')).toBeUndefined();
    const startsBefore = transport.sent.filter((message) => 'method' in message && message.method === 'thread/start').length;
    await expect(surface.createConversation({ model: 'gpt-5', reasoningEffort: 'ultra' }))
      .rejects.toThrow("Reasoning effort 'ultra' is not available");
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'thread/start')).toHaveLength(startsBefore);

    await surface.createConversation({ model: 'gpt-5', reasoningEffort: 'medium' });
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: {
        threadId: 'thread-new', effort: 'medium', collaborationMode: { mode: 'default' },
      },
    });
    await expect(surface.startReview()).rejects.toThrow("unexpected review thread 'thread-detached'");
  });

  it('does not clear optimistic busy state when a stale idle status arrives during turn/start', async () => {
    const pendingTurn = deferred<v2.TurnStartResponse>();
    const transport = new MockCodexAppServer({
      'turn/start': () => pendingTurn.promise,
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    const first = surface.sendMessage('First');
    await vi.waitFor(() => expect(lastRequest(transport, 'turn/start')).toBeDefined());
    transport.emitNotification('thread/status/changed', { threadId: 'thread-existing', status: { type: 'idle' } });
    expect(surface.getSnapshot().busy).toBe(true);
    await surface.sendMessage('Second');
    expect(surface.getSnapshot().queuedPrompts).toMatchObject([{ text: 'Second' }]);
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'turn/start')).toHaveLength(1);
    pendingTurn.resolve({ turn: turn('turn-pending', 'inProgress', []) });
    await first;
  });

  it('keeps plan mode selection isolated per thread across refreshed idle histories', async () => {
    const transport = new MockCodexAppServer({
      'thread/list': () => ({ backwardsCursor: null, data: [thread('thread-a', false), thread('thread-b', false)], nextCursor: null }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, true)),
      'thread/settings/update': () => ({}),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await surface.updateConversationSettings({ planMode: true });
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-a', planMode: true });

    await surface.selectConversation('thread-b');
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-b', planMode: false });
    await surface.selectConversation('thread-a');
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-a', planMode: true });
    await surface.selectConversation('thread-b');
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-b', planMode: false });
  });

  it('keeps multiple conversation handles active and readable at the same time', async () => {
    const transport = new MockCodexAppServer({
      'thread/list': () => ({ backwardsCursor: null,
        data: [thread('thread-a', false), thread('thread-b', false)], nextCursor: null,
      }),
      'thread/resume': (params) => resumeResponse(thread((params as { threadId: string }).threadId, false)),
      'thread/turns/list': () => ({ data: [], nextCursor: null, backwardsCursor: null }),
      'turn/start': (params) => ({
        turn: turn(`turn-${(params as { threadId: string }).threadId}`, 'inProgress', []),
      }),
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      autoSelectFirstConversation: false,
    });
    await surface.connect();
    const first = surface.conversation('thread-a');
    const second = surface.conversation('thread-b');
    await Promise.all([first.load(), second.load()]);

    await Promise.all([
      first.sendMessage('First background task'),
      second.sendMessage('Second background task'),
    ]);

    expect(first.getSnapshot()).toMatchObject({ busy: true, activeTurnId: 'turn-thread-a' });
    expect(second.getSnapshot()).toMatchObject({ busy: true, activeTurnId: 'turn-thread-b' });
    expect(surface.getSnapshot().conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'thread-a', status: 'active', turnCount: 1 }),
      expect.objectContaining({ id: 'thread-b', status: 'active', turnCount: 1 }),
    ]));
    const threadReadsBefore = transport.sent.filter((message) => (
      'method' in message && message.method === 'thread/read'
    )).length;
    const [firstHistory, secondHistory] = await Promise.all([first.readHistory(), second.readHistory()]);
    expect(firstHistory).toMatchObject({
      conversationId: 'thread-a', messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
    });
    expect(secondHistory).toMatchObject({
      conversationId: 'thread-b', messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
    });
    expect(transport.sent.filter((message) => (
      'method' in message && message.method === 'thread/read'
    ))).toHaveLength(threadReadsBefore);
  });

  it('does not let out-of-order resume responses steal the active selection', async () => {
    const resumeB = deferred<v2.ThreadResumeResponse>();
    const resumeC = deferred<v2.ThreadResumeResponse>();
    const transport = new MockCodexAppServer({
      'thread/list': () => ({ backwardsCursor: null,
        data: [thread('thread-existing', false), thread('thread-b', false), thread('thread-c', false)],
        nextCursor: null,
      }),
      'thread/resume': (params) => {
        const threadId = (params as { threadId: string }).threadId;
        if (threadId === 'thread-b') return resumeB.promise;
        if (threadId === 'thread-c') return resumeC.promise;
        return resumeResponse(thread(threadId, true));
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    const selectingB = surface.selectConversation('thread-b');
    await vi.waitFor(() => expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-b', historyLoading: true,
    }));
    const selectingC = surface.selectConversation('thread-c');
    await vi.waitFor(() => expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-c', historyLoading: true,
    }));

    resumeB.resolve(resumeResponse(thread('thread-b', true)));
    await selectingB;
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-c', historyLoading: true });
    resumeC.resolve(resumeResponse(thread('thread-c', true)));
    await selectingC;
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: 'thread-c', historyLoading: false });
  });

  it('reads child metadata without loading turns or mutating surface state', async () => {
    const transport = new MockCodexAppServer({
      'thread/read': (params) => ({
        thread: {
          ...thread(String((params as { threadId: string }).threadId), false),
          sessionId: 'session-root',
          parentThreadId: 'thread-existing',
          agentNickname: 'Kuhn',
          agentRole: 'researcher',
        },
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await vi.waitFor(() => expect(surface.getSnapshot().pluginCatalogStatus).toBe('loaded'));
    const snapshotBefore = surface.getSnapshot();
    const events: CodexSurfaceEvent[] = [];
    const unsubscribe = surface.onEvent((event) => events.push(event));

    const summary = await surface.readConversationSummary('thread-child');
    unsubscribe();

    expect(lastRequest(transport, 'thread/read')).toMatchObject({
      params: { threadId: 'thread-child', includeTurns: false },
    });
    expect(summary).toMatchObject({
      id: 'thread-child',
      sessionId: 'session-root',
      parentConversationId: 'thread-existing',
      agentNickname: 'Kuhn',
      agentRole: 'researcher',
      turnCount: 0,
    });
    expect(surface.getSnapshot()).toStrictEqual(snapshotBefore);
    expect(events).toStrictEqual([]);
    expect(transport.sent.some((message) => (
      'method' in message
      && message.method === 'thread/turns/list'
      && (message.params as { threadId?: string }).threadId === 'thread-child'
    ))).toBe(false);
    expect(transport.sent.some((message) => (
      'method' in message
      && message.method === 'thread/resume'
      && (message.params as { threadId?: string }).threadId === 'thread-child'
    ))).toBe(false);
  });

  it('rejects a summary returned for a different conversation', async () => {
    const transport = new MockCodexAppServer({
      'thread/read': () => ({ thread: thread('thread-other', false) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();

    await expect(surface.readConversationSummary('thread-child')).rejects.toThrow(
      "Codex thread/read returned 'thread-other' for requested thread 'thread-child'",
    );
  });

});
