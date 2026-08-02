import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import type { CodexSurfaceEvent } from '../src/surface';
import { FakeTransport, createSurface, deferred, lastRequest, resumeResponse, thread, turn } from './helpers/codex-surface-fixture';

describe('CodexSurface', () => {
  it('loads history, sends a message, and reduces streaming events into surface state', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const selected = await surface.selectConversation('thread-existing');
    expect(selected.messages.map((message) => message.parts[0])).toMatchObject([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'Hi there' },
    ]);

    await surface.sendMessage('  Build the UI  ');
    expect(surface.getSnapshot().messages.at(-1)).toMatchObject({
      id: 'assistant-turn-live',
      role: 'assistant',
      status: 'streaming',
      parts: [],
    });
    const turnRequest = lastRequest(transport, 'turn/start');
    expect(turnRequest).toMatchObject({
      method: 'turn/start',
      params: { threadId: 'thread-existing', input: [{ type: 'text', text: 'Build the UI' }] },
    });
    await surface.steerMessage('Focus on the renderer');
    expect(lastRequest(transport, 'turn/steer')).toMatchObject({
      params: {
        threadId: 'thread-existing', expectedTurnId: 'turn-live',
        input: [{ type: 'text', text: 'Focus on the renderer' }],
      },
    });

    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'agent-live', delta: 'Working' },
    });
    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'agent-live', delta: '… done' },
    });
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'completed', []) },
    });

    const snapshot = surface.getSnapshot();
    expect(snapshot).toMatchObject({ busy: false, error: null });
    expect(snapshot.messages.find((message) => (
      message.role === 'assistant'
      && message.parts.some((part) => part.type === 'text' && part.itemId === 'agent-live')
    ))).toMatchObject({
      role: 'assistant',
      status: 'complete',
      parts: [{ type: 'text', text: 'Working… done', itemId: 'agent-live' }],
    });
  });

  it('renders a bounded summary page before hydrating full history in the background', async () => {
    const firstTurn = turn('turn-first', 'completed', [
      { type: 'userMessage', id: 'user-first', clientId: null, content: [{ type: 'text', text: 'First', text_elements: [] }] },
      {
        type: 'commandExecution', id: 'command-first', command: 'npm test', cwd: '/tmp/project', processId: null,
        source: 'unifiedExec', status: 'completed', commandActions: [], aggregatedOutput: 'passed', exitCode: 0,
        durationMs: 20,
      },
      { type: 'agentMessage', id: 'agent-first', text: 'First reply', phase: null, memoryCitation: null },
    ]);
    const secondTurn = turn('turn-second', 'completed', [
      { type: 'userMessage', id: 'user-second', clientId: null, content: [{ type: 'text', text: 'Second', text_elements: [] }] },
      { type: 'agentMessage', id: 'agent-second', text: 'Second reply', phase: null, memoryCitation: null },
    ]);
    const firstFullPage = deferred<unknown>();
    const transport = new FakeTransport({
      'thread/resume': (params) => ({
        ...resumeResponse(thread(String((params as { threadId: string }).threadId), false)),
        initialTurnsPage: { data: [secondTurn], nextCursor: 'summary-page-2', backwardsCursor: null },
      }),
      'thread/turns/list': (params) => {
        const cursor = (params as { cursor: string | null }).cursor;
        expect(params).toMatchObject({
          threadId: 'thread-existing', limit: 5, sortDirection: 'desc', itemsView: 'full',
        });
        return cursor === null
          ? firstFullPage.promise
          : { data: [firstTurn], nextCursor: null, backwardsCursor: null };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    const historyEvents: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => {
      if (event.type === 'conversation.historyReplaced') historyEvents.push(event);
    });

    const snapshot = await surface.connect();

    expect(snapshot.messages.map((message) => message.parts[0])).toMatchObject([
      { type: 'text', text: 'Second' },
      { type: 'text', text: 'Second reply' },
    ]);
    firstFullPage.resolve({ data: [secondTurn], nextCursor: 'full-page-2', backwardsCursor: null });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.map((message) => message.parts[0])).toMatchObject([
      { type: 'text', text: 'First' },
      { type: 'tool', id: 'command-first', kind: 'command' },
      { type: 'text', text: 'Second' },
      { type: 'text', text: 'Second reply' },
    ]));
    expect(surface.getSnapshot().conversations[0]).toMatchObject({ id: 'thread-existing', turnCount: 2 });
    expect(transport.sent.filter((message) => (
      'method' in message && message.method === 'thread/turns/list'
    ))).toHaveLength(2);
    expect(historyEvents.at(-1)).toMatchObject({
      type: 'conversation.historyReplaced',
      origin: 'lifecycle',
      payload: { reason: 'resync' },
    });
  });

  it('does not resurrect a completed turn from a stale background history page', async () => {
    const staleFullPage = deferred<unknown>();
    const historyHydrated = deferred<void>();
    const runningTurn = turn('turn-running', 'inProgress', []);
    const transport = new FakeTransport({
      'thread/resume': () => {
        const running = thread('thread-existing', false);
        running.status = { type: 'active', activeFlags: [] };
        running.turns = [runningTurn];
        return resumeResponse(running);
      },
      'thread/turns/list': () => staleFullPage.promise,
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    surface.onEvent((event) => {
      if (event.type === 'conversation.historyReplaced' && event.payload.reason === 'resync') {
        historyHydrated.resolve();
      }
    });
    await surface.connect();
    expect(surface.getSnapshot().busy).toBe(true);

    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-running', 'completed', []) },
    });
    expect(surface.getSnapshot().busy).toBe(false);
    staleFullPage.resolve({ data: [runningTurn], nextCursor: null, backwardsCursor: null });
    await historyHydrated.promise;

    expect(surface.getSnapshot().busy).toBe(false);
    expect(surface.conversation('thread-existing').getSnapshot().activeTurnId).toBeNull();
    expect(surface.getSnapshot().messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ turnId: 'turn-running', status: 'streaming' }),
    ]));
  });

  it('emits ordered semantic events after matching state mutations for conversation handles', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const events: CodexSurfaceEvent[] = [];
    const handleEvents: CodexSurfaceEvent[] = [];
    const unsubscribeSurface = surface.onEvent((event) => {
      events.push(event);
      if (event.type === 'message.delta') {
        const message = surface.conversation(event.conversationId).getSnapshot().messages
          .find((candidate) => candidate.id === event.payload.messageId);
        expect(message?.parts).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: 'text', itemId: event.payload.itemId }),
        ]));
      }
      if (event.type === 'tool.updated') {
        const part = surface.conversation(event.conversationId).getSnapshot().messages
          .flatMap((message) => message.parts)
          .find((candidate) => candidate.type === 'tool' && candidate.id === event.payload.update.itemId);
        expect(part).toMatchObject({ body: expect.stringContaining(event.payload.update.bodyAppend ?? '') });
      }
    });
    const conversation = surface.conversation('thread-existing');
    const unsubscribeConversation = conversation.onEvent((event) => handleEvents.push(event));

    await conversation.sendMessage('Inspect these', {
      attachments: [
        {
          type: 'image', path: '/tmp/screenshot.png', name: 'shot.png', mimeType: 'image/png',
          previewUrl: 'data:image/png;base64,cG5n',
        },
        { type: 'file', path: '/tmp/notes.md', name: 'Notes', mimeType: 'text/markdown' },
      ],
    });
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'inProgress', []) },
    });
    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'agent-live', delta: 'Working' },
    });
    transport.emit({
      method: 'item/plan/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'plan-live', delta: '# Draft' },
    });
    transport.emit({
      method: 'turn/plan/updated',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', explanation: 'Implementation',
        plan: [{ step: 'Wire events', status: 'inProgress' }],
      },
    });
    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', startedAtMs: 1,
        item: {
          type: 'mcpToolCall', id: 'mcp-live', server: 'tools', tool: 'run', status: 'inProgress',
          arguments: {}, appContext: null, pluginId: null, result: null, error: null, durationMs: null,
        },
      },
    });
    transport.emit({
      method: 'item/mcpToolCall/progress',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'mcp-live', message: 'halfway' },
    });
    transport.emit({
      id: 'ask-event',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', itemId: 'ask-live', autoResolutionMs: null,
        questions: [{
          id: 'target', header: 'Target', question: 'Which target?', isOther: false, isSecret: false,
          options: null,
        }],
      },
    });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'clientRequest.requested')).toBe(true));
    await conversation.respondToClientRequest({
      id: 'ask-event', payload: { answers: { target: { answers: ['SDK'] } } },
    });
    transport.emit({
      id: 'approval-event',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', itemId: 'command-live', command: 'npm test',
        cwd: '/tmp/project', reason: null, environmentId: null, commandActions: [],
        networkApprovalContext: null, additionalPermissions: null,
        availableDecisions: ['accept', 'decline'], proposedExecpolicyAmendment: null,
      },
    });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'approval.requested')).toBe(true));
    await conversation.resolveApproval('approval-event', 'approve', 'once');
    transport.emit({ method: 'skills/changed', params: {} });
    await vi.waitFor(() => expect(handleEvents.some((event) => event.type === 'conversation.skillsChanged')).toBe(true));

    const appended = events.find((event) => (
      event.type === 'message.appended' && event.origin === 'action'
    ));
    expect(appended?.type === 'message.appended' ? appended.payload.message.parts : []).toStrictEqual([
      { type: 'text', text: 'Inspect these' },
      {
        type: 'attachment',
        attachment: {
          kind: 'image', name: 'shot.png', path: '/tmp/screenshot.png',
          url: 'data:image/png;base64,cG5n', mimeType: 'image/png',
        },
      },
      {
        type: 'attachment',
        attachment: { kind: 'file', name: 'Notes', path: '/tmp/notes.md', mimeType: 'text/markdown' },
      },
    ]);
    expect(events.filter((event) => event.type === 'turn.started' && event.turnId === 'turn-live')).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message.delta', payload: expect.objectContaining({ delta: 'Working' }) }),
      expect.objectContaining({ type: 'plan.delta', payload: expect.objectContaining({ markdown: '# Draft' }) }),
      expect.objectContaining({
        type: 'plan.updated',
        payload: expect.objectContaining({
          explanation: 'Implementation', status: 'completed',
          steps: [{ step: 'Wire events', status: 'inProgress' }],
        }),
      }),
      expect.objectContaining({ type: 'tool.started', payload: expect.objectContaining({ messageId: 'assistant-turn-live' }) }),
      expect.objectContaining({ type: 'tool.updated', payload: expect.objectContaining({ update: expect.objectContaining({ bodyAppend: 'halfway' }) }) }),
      expect.objectContaining({ type: 'clientRequest.resolved', payload: expect.objectContaining({ reason: 'host' }) }),
      expect.objectContaining({ type: 'approval.resolved', payload: expect.objectContaining({ decision: 'approve' }) }),
    ]));
    expect(events.map((event) => event.seq)).toStrictEqual(
      [...events.map((event) => event.seq)].sort((left, right) => left - right),
    );
    expect(new Set(events.map((event) => event.seq)).size).toBe(events.length);
    expect(handleEvents.every((event) => 'conversationId' in event && event.conversationId === 'thread-existing')).toBe(true);

    const handleEventCount = handleEvents.length;
    unsubscribeConversation();
    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'agent-live', delta: ' done' },
    });
    expect(handleEvents).toHaveLength(handleEventCount);
    const surfaceEventCount = events.length;
    unsubscribeSurface();
    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-live', itemId: 'agent-live', delta: '!' },
    });
    expect(events).toHaveLength(surfaceEventCount);
  });

  it('keeps reasoning internal and exposes an empty streaming assistant message for thinking UI', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.sendMessage('Think carefully');

    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', startedAtMs: 1,
        item: { type: 'reasoning', id: 'reasoning-live', summary: [], content: [] },
      },
    });
    transport.emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-live', completedAtMs: 2,
        item: { type: 'reasoning', id: 'reasoning-live', summary: ['Internal'], content: ['Hidden'] },
      },
    });

    const assistant = surface.getSnapshot().messages.at(-1);
    expect(assistant).toMatchObject({
      id: 'assistant-turn-live',
      role: 'assistant',
      status: 'streaming',
      parts: [],
    });
    expect(surface.getSnapshot().messages.some((message) => (
      message.parts.some((part) => part.type === 'tool' && part.kind === 'reasoning')
    ))).toBe(false);
  });

  it('preserves agent message phase before and during streaming', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-live', 'inProgress', []) },
    });
    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing',
        turnId: 'turn-live',
        startedAtMs: 1,
        item: {
          type: 'agentMessage',
          id: 'agent-final',
          text: '',
          phase: 'final_answer',
          memoryCitation: null,
        },
      },
    });
    transport.emit({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-existing',
        turnId: 'turn-live',
        itemId: 'agent-final',
        delta: 'Final response',
      },
    });

    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: 'Final response',
          itemId: 'agent-final',
          phase: 'final_answer',
        }),
      ]),
    );
  });

});
