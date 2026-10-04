import { describe, expect, it, vi } from 'vitest';
import { createCodexConversationReplica } from '@codex-app-sdk/core/conversation-replica';
import { CodexAppServerClient, type v2 } from '../src/codex';
import { CodexSurface } from '../src/node';
import type { CodexSurfaceEvent } from '@codex-app-sdk/core/surface';
import { deferred, generatedPngBase64, MockCodexAppServer, createSurface, lastRequest, requestsFor, resumeResponse, thread, turn } from './helpers/codex-surface-fixture';

describe('CodexSurface', () => {
  it.each(['completed', 'interrupted', 'failed', 'error'] as const)('waits for authoritative %s after idle', async (status) => {
    const { surface, transport } = createSurface('turn/interrupt');
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();
    try {
      const replica = createCodexConversationReplica(surface.getConversationSnapshot('thread-existing'));
      surface.onConversationEvent('thread-existing', (event) => replica.apply(event));
      transport.emitNotification('turn/started', {
        threadId: 'thread-existing', turn: turn('turn-idle-first', 'inProgress', []),
      });
      if (status === 'interrupted') {
        await surface.interrupt();
        expect(lastRequest(transport, 'turn/interrupt')).toMatchObject({
          params: { threadId: 'thread-existing', turnId: 'turn-idle-first' },
        });
      }
      transport.emitNotification('thread/status/changed', {
        threadId: 'thread-existing', status: { type: 'idle' },
      });
      expect(events.filter((event) => event.type === 'turn.completed')).toEqual([]);
      expect(surface.getSnapshot()).toMatchObject({
        busy: false, activeTurnId: null, threadStatus: { type: 'idle' },
        turns: expect.arrayContaining([expect.objectContaining({ id: 'turn-idle-first', status: 'inProgress' })]),
      });

      if (status === 'error') {
        transport.emitNotification('error', {
          threadId: 'thread-existing', turnId: 'turn-idle-first', willRetry: false,
          error: { message: 'Terminal failure', codexErrorInfo: null, additionalDetails: null, misalignment: null },
        });
      } else {
        transport.emitNotification('turn/completed', {
          threadId: 'thread-existing', turn: turn('turn-idle-first', status, []),
        });
      }
      expect(surface.getSnapshot().turns).toContainEqual(expect.objectContaining({
        id: 'turn-idle-first', status: status === 'error' ? 'failed' : status,
      }));
      expect(replica.getSnapshot().turns).toEqual(surface.getSnapshot().turns);
      expect(events.filter((event) => event.type === 'turn.completed' || event.type === 'turn.error')).toEqual([
        expect.objectContaining({
          origin: 'notification', turnId: 'turn-idle-first',
          payload: expect.objectContaining(status === 'error' ? { willRetry: false } : { status }),
        }),
      ]);
    } finally {
      await surface.close();
    }
  });

  it.each(['pending', 'started'] as const)('recovers the queue on idle without settling unknown work or clearing a %s next turn', async (phase) => {
    const next = deferred<v2.TurnStartResponse>();
    const transport = new MockCodexAppServer({ 'turn/start': () => next.promise });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();
    const replica = createCodexConversationReplica(surface.getConversationSnapshot('thread-existing'));
    const completedStates: Array<{ busy: boolean; activeTurnId: string | null }> = [];
    surface.onConversationEvent('thread-existing', (event) => {
      const state = replica.apply(event);
      if (event.type === 'turn.completed') completedStates.push({ busy: state.busy, activeTurnId: state.activeTurnId });
    });
    try {
      transport.emitNotification('turn/started', {
        threadId: 'thread-existing', turn: turn('turn-previous', 'inProgress', []),
      });
      await surface.sendMessage('Queued next');
      await surface.sendMessage('Keep queued');
      transport.emitNotification('thread/status/changed', {
        threadId: 'thread-existing', status: { type: 'idle' },
      });
      await vi.waitFor(() => expect(requestsFor(transport, 'turn/start')).toHaveLength(1));
      expect(surface.getSnapshot()).toMatchObject({ busy: true, queuedPrompts: [{ text: 'Keep queued' }] });
      expect(events.filter((event) => event.type === 'turn.completed')).toEqual([]);

      if (phase === 'started') {
        next.resolve({ turn: turn('turn-next', 'inProgress', []) });
        await vi.waitFor(() => expect(surface.getSnapshot().activeTurnId).toBe('turn-next'));
      }
      transport.emitNotification('turn/completed', {
        threadId: 'thread-existing', turn: turn('turn-previous', 'completed', []),
      });
      expect(surface.getSnapshot()).toMatchObject({
        busy: true, activeTurnId: phase === 'started' ? 'turn-next' : null,
        queuedPrompts: [{ text: 'Keep queued' }],
        conversations: [expect.objectContaining({ status: 'active' })],
      });
      expect(requestsFor(transport, 'turn/start')).toHaveLength(1);
      expect(completedStates).toEqual([{ busy: true, activeTurnId: phase === 'started' ? 'turn-next' : null }]);
      expect(events.filter((event) => event.type === 'turn.completed')).toEqual([
        expect.objectContaining({ turnId: 'turn-previous', payload: expect.objectContaining({ status: 'completed' }) }),
      ]);
    } finally {
      next.resolve({ turn: turn('turn-next', 'inProgress', []) });
      await surface.close();
    }
  });

  it('continues the latest interrupted turn without creating a user message', async () => {
    const interrupted = turn('turn-interrupted', 'interrupted', [
      {
        type: 'agentMessage', id: 'agent-interrupted', text: 'Partial work',
        phase: 'commentary', memoryCitation: null, delivery: null, questions: null,
      },
    ]);
    const transport = new MockCodexAppServer({
      'thread/resume': (params) => resumeResponse({
        ...thread(String((params as { threadId: string }).threadId), false),
        turns: [interrupted],
      }),
      'turn/start': () => ({ turn: turn('turn-continuation', 'inProgress', []) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();
    const userMessageCount = surface.getSnapshot().messages.filter((message) => message.role === 'user').length;
    events.length = 0;

    await surface.continueInterruptedTurn();

    const continuationRequest = lastRequest(transport, 'turn/start');
    expect(continuationRequest).toMatchObject({
      params: { threadId: 'thread-existing', input: [] },
    });
    expect(continuationRequest && 'params' in continuationRequest
      ? continuationRequest.params
      : undefined).not.toHaveProperty('clientUserMessageId');
    expect(surface.getSnapshot()).toMatchObject({
      activeTurnId: 'turn-continuation',
      busy: true,
      turns: [
        expect.objectContaining({ id: 'turn-interrupted', status: 'interrupted' }),
        expect.objectContaining({ id: 'turn-continuation', status: 'inProgress' }),
      ],
    });
    expect(surface.getSnapshot().messages.filter((message) => message.role === 'user')).toHaveLength(userMessageCount);
    expect(events.some((event) => event.type === 'message.appended' && event.payload.message.role === 'user')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn.started', conversationId: 'thread-existing', turnId: 'turn-continuation',
    }));
  });

  it('only continues an idle conversation whose latest turn is interrupted', async () => {
    const completedTransport = new MockCodexAppServer({
      'thread/resume': (params) => resumeResponse({
        ...thread(String((params as { threadId: string }).threadId), false),
        turns: [turn('turn-completed', 'completed', [])],
      }),
    });
    const completedSurface = new CodexSurface({
      client: new CodexAppServerClient(completedTransport), cwd: '/tmp/project',
    });
    await completedSurface.connect();

    await expect(completedSurface.continueInterruptedTurn()).rejects.toThrow('latest turn is not interrupted');
    expect(lastRequest(completedTransport, 'turn/start')).toBeUndefined();

    const { surface: activeSurface, transport: activeTransport } = createSurface('turn/start');
    await activeSurface.connect();
    await activeSurface.sendMessage('Begin');
    const activeTurnStart = lastRequest(activeTransport, 'turn/start');

    await expect(activeSurface.continueInterruptedTurn()).rejects.toThrow('while a turn is active');
    expect(lastRequest(activeTransport, 'turn/start')).toBe(activeTurnStart);
  });

  it('restores an interrupted conversation when continuation fails', async () => {
    const interrupted = turn('turn-interrupted', 'interrupted', []);
    const transport = new MockCodexAppServer({
      'thread/resume': (params) => resumeResponse({
        ...thread(String((params as { threadId: string }).threadId), false),
        turns: [interrupted],
      }),
      'turn/start': () => { throw new Error('continuation rejected'); },
    });
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport), cwd: '/tmp/project',
    });
    await surface.connect();

    await expect(surface.continueInterruptedTurn()).rejects.toThrow('continuation rejected');

    expect(surface.getSnapshot()).toMatchObject({
      activeTurnId: null,
      busy: false,
      error: 'continuation rejected',
      turns: [expect.objectContaining({ id: 'turn-interrupted', status: 'interrupted' })],
    });
  });

  it('publishes the authoritative turn identity for an optimistic user prompt', async () => {
    const { surface } = createSurface('turn/start');
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));

    await surface.connect();
    await surface.sendMessage('Begin');

    const appended = events.find((event): event is Extract<CodexSurfaceEvent, { type: 'message.appended' }> => (
      event.type === 'message.appended' && event.payload.message.role === 'user'
    ));
    const updated = events.find((event): event is Extract<CodexSurfaceEvent, { type: 'message.updated' }> => (
      event.type === 'message.updated' && event.payload.message.role === 'user'
    ));
    expect(appended).toMatchObject({
      type: 'message.appended', conversationId: 'thread-existing',
    });
    expect(appended?.payload.message).not.toHaveProperty('turnId');
    expect(updated).toMatchObject({
      type: 'message.updated', conversationId: 'thread-existing', turnId: 'turn-live',
      payload: { message: { id: appended?.payload.message.id, turnId: 'turn-live' } },
    });
  });

  it('reconciles a turnless app-server user item with the pending optimistic prompt', async () => {
    let resolveStart!: (value: v2.TurnStartResponse) => void;
    const transport = new MockCodexAppServer({
      'turn/start': () => new Promise((resolve) => { resolveStart = resolve; }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();

    const sending = surface.sendMessage('One prompt');
    await vi.waitFor(() => expect(lastRequest(transport, 'turn/start')).toBeDefined());
    transport.emitNotification('item/started', {
        threadId: 'thread-existing', turnId: 'turn-live', startedAtMs: 1_700_000_000_000,
        item: {
          type: 'userMessage', id: 'server-user', clientId: null,
          content: [{ type: 'text', text: 'One prompt', text_elements: [] }],
        },
      });
    resolveStart({ turn: turn('turn-live', 'inProgress', []) });
    await sending;

    expect(surface.getSnapshot().messages.filter((message) => message.role === 'user'
      && message.parts.some((part) => part.type === 'text' && part.text === 'One prompt'))).toEqual([
      expect.objectContaining({ turnId: 'turn-live', parts: [{ type: 'text', text: 'One prompt' }] }),
    ]);
    expect(events.filter((event) => event.type === 'message.appended'
      && event.payload.message.role === 'user')).toHaveLength(1);
  });

  it('reports invalid and failed steering without losing the active conversation', async () => {
    const transport = new MockCodexAppServer({
      'turn/start': () => ({ turn: turn('turn-live', 'inProgress', []) }),
      'turn/steer': () => { throw new Error('steer rejected'); },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    await surface.connect();
    await expect(surface.steerMessage('')).rejects.toThrow('empty message');
    await expect(surface.steerMessage('No active turn')).rejects.toThrow('no active turn');
    await surface.sendMessage('Begin');
    await expect(surface.steerMessage('Redirect')).rejects.toThrow('steer rejected');
    expect(surface.getSnapshot()).toMatchObject({
      activeConversationId: 'thread-existing',
      busy: true,
      error: 'steer rejected',
    });
  });

  it('uses the authoritative turn returned after steering', async () => {
    const transport = new MockCodexAppServer({
      'turn/start': () => ({ turn: turn('turn-live', 'inProgress', []) }),
      'turn/steer': () => ({ turnId: 'turn-after-steer' }),
      'turn/interrupt': () => ({}),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    await surface.sendMessage('Begin');
    await surface.steerMessage('Redirect');

    expect(surface.getSnapshot().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'steer', metadata: expect.objectContaining({ turnId: 'turn-after-steer' }) }),
      expect.objectContaining({ role: 'assistant', metadata: expect.objectContaining({ turnId: 'turn-after-steer' }) }),
    ]));
    await surface.interrupt();
    expect(lastRequest(transport, 'turn/interrupt')).toMatchObject({
      params: { threadId: 'thread-existing', turnId: 'turn-after-steer' },
    });
  });

  it('includes attachments in steering input and the optimistic steer message', async () => {
    const { surface, transport } = createSurface('turn/start', 'turn/steer');
    await surface.connect();
    await surface.sendMessage('Begin');
    await surface.steerMessage('Inspect these', {
      attachments: [
        { type: 'image', path: '/tmp/screenshot.png', detail: 'original' },
        { type: 'file', path: '/tmp/notes.md', name: 'Notes' },
      ],
    });

    expect(lastRequest(transport, 'turn/steer')).toMatchObject({
      params: {
        input: [
          { type: 'text', text: 'Inspect these' },
          { type: 'localImage', path: '/tmp/screenshot.png', detail: 'original' },
          { type: 'mention', path: '/tmp/notes.md', name: 'Notes' },
        ],
      },
    });
    expect(surface.getSnapshot().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'steer',
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'attachment', attachment: expect.objectContaining({ kind: 'image' }) }),
          expect.objectContaining({ type: 'attachment', attachment: expect.objectContaining({ kind: 'file' }) }),
        ]),
        metadata: expect.objectContaining({ attachments: expect.any(Array) }),
      }),
    ]));
  });

  it('handles completed start responses and running history', async () => {
    const transport = new MockCodexAppServer({
      'thread/resume': (params) => {
        const value = thread(String((params as { threadId: string }).threadId), false);
        value.status = { type: 'active', activeFlags: [] };
        value.turns = [turn('turn-running', 'inProgress', [])];
        return resumeResponse(value);
      },
      'turn/start': () => ({ turn: turn('turn-already-done', 'completed', []) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    await surface.connect();
    expect((await surface.selectConversation('thread-existing')).busy).toBe(true);
    transport.emitNotification('turn/completed', { threadId: 'thread-existing', turn: turn('turn-running', 'completed', []) });
    await surface.sendMessage('Quick answer');
    expect(surface.getSnapshot().busy).toBe(false);
    await expect(surface.interrupt()).resolves.toMatchObject({ busy: false });
  });

  it('tracks names, completed tool items, errors, and lifecycle cleanup', async () => {
    const { surface, transport } = createSurface();
    const lifecycleEvents: unknown[] = [];
    surface.onEvent((event) => lifecycleEvents.push(event));
    await surface.connect();
    await surface.selectConversation('thread-existing');
    transport.emitNotification('thread/name/updated', { threadId: 'thread-existing', threadName: 'Renamed' });
    transport.emitNotification('item/completed', {
        threadId: 'thread-existing', turnId: 'turn-tool', completedAtMs: 1_700_000_002_000,
        item: { pluginId: null, scriptPath: null,
          type: 'commandExecution', id: 'command', command: 'npm test', cwd: '/tmp/project', processId: null,
          source: 'unifiedExecInteraction', status: 'failed', commandActions: [], aggregatedOutput: 'failed', exitCode: 1,
          durationMs: 20,
        },
      });
    transport.emitNotification('error', {
        threadId: 'thread-existing', turnId: 'turn-tool', willRetry: false,
        error: { message: 'No network', codexErrorInfo: null, additionalDetails: null, misalignment: null },
      });

    const snapshot = surface.getSnapshot();
    expect(snapshot.conversations[0]).toMatchObject({ title: 'Renamed' });
    expect(snapshot.error).toBe('No network');
    expect(snapshot.messages.find((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'command')
    ))).toMatchObject({
      id: 'assistant-turn-tool',
      parts: [{ type: 'tool', status: 'failed' }],
    });
    transport.emitServerRequest('close-approval', 'item/commandExecution/requestApproval', { kind: 'command', startedAtMs: 1,
        threadId: 'thread-existing', turnId: 'turn-close', itemId: 'command-close', command: 'npm test',
        cwd: '/tmp/project', reason: null, environmentId: null, commandActions: [],
        networkApprovalContext: null, additionalPermissions: null,
        availableDecisions: ['accept', 'decline'], proposedExecpolicyAmendment: null,
      });
    transport.emitServerRequest('close-input', 'item/tool/requestUserInput', { isBlocking: false,
        threadId: 'thread-existing', turnId: 'turn-close', itemId: 'input-close', autoResolutionMs: null,
        questions: [{
          id: 'answer', header: 'Answer', question: 'Continue?', isOther: false, isSecret: false,
          options: null,
        }],
      });
    await vi.waitFor(() => expect(surface.getSnapshot()).toMatchObject({
      busy: true,
      approvals: [{ id: 'close-approval' }],
      clientRequests: [{ id: 'close-input' }],
    }));
    expect(surface.getConversationSnapshot('thread-existing').activeTurnId).toBe('turn-close');
    await surface.close();
    await surface.close();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(surface.getSnapshot()).toMatchObject({
      status: 'idle', activeTurnId: null, busy: false,
      approvals: [], clientRequests: [], historyLoading: false,
    });
    expect(surface.getConversationSnapshot('thread-existing')).toMatchObject({
      activeTurnId: null, busy: false, approvals: [], clientRequests: [],
    });
    expect(lifecycleEvents).toContainEqual(expect.objectContaining({
      type: 'surface.statusChanged', origin: 'lifecycle',
      payload: { status: 'idle', error: 'No network' },
    }));
    await expect(surface.connect()).rejects.toThrow('Codex surface is closed');
  });

  it('emits file activity events for read and file changes as paths become known', async () => {
    const { surface, transport } = createSurface();
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();

    transport.emitNotification('item/started', {
        threadId: 'thread-existing', turnId: 'turn-files', startedAtMs: 1,
        item: { pluginId: null, scriptPath: null,
          type: 'commandExecution', id: 'read-file', command: 'cat README.md', cwd: '/tmp/project',
          source: 'unifiedExecInteraction', status: 'inProgress', commandActions: [
            { type: 'read', command: 'cat README.md', name: 'README.md', path: 'README.md' },
          ],
          processId: null, aggregatedOutput: null, exitCode: null, durationMs: null,
        },
      });
    transport.emitNotification('item/completed', {
        threadId: 'thread-existing', turnId: 'turn-files', completedAtMs: 2,
        item: {
          type: 'fileChange', id: 'create-file', status: 'completed', changes: [
            { kind: { type: 'add' }, path: 'src/new-file.ts', diff: '+export {}' },
          ],
        },
      });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'file.activity',
        conversationId: 'thread-existing',
        turnId: 'turn-files',
        payload: expect.objectContaining({
          messageId: 'assistant-turn-files', itemId: 'read-file',
          path: '/tmp/project/README.md', action: 'read', status: 'running',
        }),
      }),
      expect.objectContaining({
        type: 'file.activity',
        conversationId: 'thread-existing',
        turnId: 'turn-files',
        payload: expect.objectContaining({
          messageId: 'assistant-turn-files', itemId: 'create-file',
          path: '/tmp/project/src/new-file.ts', action: 'create', status: 'completed',
        }),
      }),
    ]));
  });

  it('projects live generated images once while preserving technical tool events', async () => {
    const { surface, transport } = createSurface();
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));
    await surface.connect();

    transport.emitNotification('item/started', {
        threadId: 'thread-existing', turnId: 'turn-image', startedAtMs: 1,
        item: { failure: null,
          type: 'imageGeneration', id: 'image-live', status: 'inProgress',
          revisedPrompt: null, result: '',
        },
      });
    expect(surface.getSnapshot().messages.find((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'image-live')
    ))?.parts).toStrictEqual([
      expect.objectContaining({ type: 'tool', id: 'image-live', status: 'running' }),
    ]);

    transport.emitNotification('rawResponseItem/completed', {
        threadId: 'thread-existing', turnId: 'turn-image',
        item: {
          type: 'image_generation_call', id: 'image-live', status: 'completed',
          revised_prompt: 'Draw the route map', result: generatedPngBase64,
        },
      });
    expect(JSON.stringify(surface.getSnapshot())).not.toContain(generatedPngBase64);

    const completedItem: v2.ThreadItem = {
      type: 'imageGeneration', id: 'image-live', status: 'completed',
      revisedPrompt: 'Draw the route map', result: generatedPngBase64,
      savedPath: '/tmp/generated route.png', failure: null,
    };
    transport.emitNotification('item/completed', {
        threadId: 'thread-existing', turnId: 'turn-image', completedAtMs: 2,
        item: completedItem,
      });
    transport.emitNotification('item/completed', {
        threadId: 'thread-existing', turnId: 'turn-image', completedAtMs: 2,
        item: completedItem,
      });

    const message = surface.getSnapshot().messages.find((candidate) => (
      candidate.parts.some((part) => part.type === 'tool' && part.id === 'image-live')
    ));
    expect(message?.parts).toStrictEqual([
      expect.objectContaining({
        type: 'tool', id: 'image-live', status: 'completed', output: '/tmp/generated route.png',
      }),
      {
        type: 'media',
        itemId: 'image-live',
        media: {
          url: `data:image/png;base64,${generatedPngBase64}`,
          alt: 'Generated image',
          mimeType: 'image/png',
          prompt: 'Draw the route map',
          title: 'Generated image',
        },
      },
    ]);
    expect(message?.parts.filter((part) => part.type === 'media')).toHaveLength(1);
    expect(JSON.stringify(message?.parts.find((part) => part.type === 'tool'))).not.toContain(generatedPngBase64);
    expect(JSON.stringify(surface.getSnapshot()).split(generatedPngBase64)).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool.completed',
        payload: expect.objectContaining({ toolPart: expect.objectContaining({ id: 'image-live' }) }),
      }),
      expect.objectContaining({
        type: 'message.updated',
        payload: expect.objectContaining({
          message: expect.objectContaining({
            parts: expect.arrayContaining([expect.objectContaining({ type: 'media', itemId: 'image-live' })]),
          }),
        }),
      }),
    ]));
    expect(events.filter((event) => event.type === 'message.updated')).toHaveLength(1);
  });

  it('reduces started, replaced, ignored, and failed lifecycle variants', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.selectConversation('thread-existing');
    const startedThread = thread('thread-started', false);
    startedThread.name = 'Named thread';
    startedThread.status = { type: 'active', activeFlags: [] };
    startedThread.recencyAt = 1_700_000_010;
    transport.emitNotification('thread/started', { thread: startedThread });
    transport.emitNotification('thread/name/updated', { threadId: 'missing', threadName: '' });
    transport.emitNotification('turn/started', { threadId: 'thread-existing', turn: turn('turn-variant', 'inProgress', []) });
    const command: v2.ThreadItem = {
      type: 'commandExecution', id: 'command-variant', pluginId: null, scriptPath: null,
      command: 'pwd', cwd: '/tmp/project', processId: null,
      source: 'unifiedExecInteraction', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null,
    };
    transport.emitNotification('item/started', { threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 1, item: command });
    transport.emitNotification('item/completed', {
        threadId: 'thread-existing', turnId: 'turn-variant', completedAtMs: 2,
        item: { ...command, status: 'completed' },
      });
    const user: v2.ThreadItem = {
      type: 'userMessage', id: 'user-variant', clientId: null,
      content: [{ type: 'text', text: 'Steer', text_elements: [] }],
    };
    transport.emitNotification('item/started', { threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 3, item: user });
    transport.emitNotification('item/started', { threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 3, item: user });
    transport.emitNotification('item/started', {
        threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 4,
        item: { type: 'contextCompaction', id: 'compact' },
      });
    transport.emitNotification('item/agentMessage/delta', { threadId: 'other', turnId: 'turn', itemId: 'ignored', delta: 'ignored' });
    transport.emitNotification('item/started', { threadId: 'other', turnId: 'turn', startedAtMs: 1, item: command });
    transport.emitNotification('turn/completed', { threadId: 'other', turn: turn('turn', 'completed', []) });
    transport.emitNotification('error', {
        threadId: 'other', turnId: 'turn', willRetry: false,
        error: { message: 'Ignored', codexErrorInfo: null, additionalDetails: null, misalignment: null },
      });
    transport.emitNotification('turn/completed', {
        threadId: 'thread-existing',
        turn: { ...turn('turn-variant', 'failed', []), error: { misalignment: null, message: 'Failed turn', codexErrorInfo: null, additionalDetails: null } },
      });

    const snapshot = surface.getSnapshot();
    expect(snapshot.conversations.find((conversation) => conversation.id === 'thread-started')).toMatchObject({
      title: 'Named thread', status: 'active', updatedAt: new Date(1_700_000_010_000).toISOString(),
    });
    expect(snapshot.messages.filter((message) => (
      message.parts.some((part) => part.type === 'text' && part.text === 'Steer')
    ))).toHaveLength(1);
    expect(snapshot.messages.find((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'command-variant')
    ))).toMatchObject({
      parts: [{ status: 'completed' }], status: 'error',
    });
    expect(snapshot).toMatchObject({ busy: false, error: 'Failed turn' });
  });

});
