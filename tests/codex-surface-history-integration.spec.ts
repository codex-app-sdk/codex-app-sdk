import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../packages/backend/src/codex';
import { CodexSurface } from '../packages/backend/src/node';
import type { CodexSurfaceEvent, SurfaceMessage } from '../src/surface';
import { FakeTransport, createSurface, deferred, lastRequest, resumeResponse, thread, turn } from './helpers/codex-surface-fixture';

function historyTurn(id: string, index: number): Record<string, unknown> {
  return turn(id, 'completed', [
    { type: 'userMessage', id: `${id}-user-1`, clientId: null, content: [{ type: 'text', text: `Older ${index} request`, text_elements: [] }] },
    { type: 'agentMessage', id: `${id}-agent-1`, text: `Older ${index} first reply`, phase: null, memoryCitation: null },
    { type: 'userMessage', id: `${id}-user-2`, clientId: null, content: [{ type: 'text', text: `Older ${index} follow-up`, text_elements: [] }] },
    { type: 'agentMessage', id: `${id}-agent-2`, text: `Older ${index} second reply`, phase: null, memoryCitation: null },
    { type: 'userMessage', id: `${id}-user-3`, clientId: null, content: [{ type: 'text', text: `Older ${index} last request`, text_elements: [] }] },
    { type: 'agentMessage', id: `${id}-agent-3`, text: `Older ${index} last reply`, phase: null, memoryCitation: null },
  ]);
}

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

  it('renders a bounded full page before hydrating remaining history in the background', async () => {
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
      {
        type: 'commandExecution', id: 'command-second', command: 'npm run build', cwd: '/tmp/project', processId: null,
        source: 'unifiedExec', status: 'completed', commandActions: [], aggregatedOutput: 'passed', exitCode: 0,
        durationMs: 20,
      },
      { type: 'agentMessage', id: 'agent-second', text: 'Second reply', phase: null, memoryCitation: null },
    ]);
    const remainingFullPage = deferred<unknown>();
    const transport = new FakeTransport({
      'thread/resume': (params) => ({
        ...resumeResponse(thread(String((params as { threadId: string }).threadId), false)),
        initialTurnsPage: { data: [secondTurn], nextCursor: 'remaining-page-2', backwardsCursor: null },
      }),
      'thread/turns/list': (params) => {
        const cursor = (params as { cursor: string | null }).cursor;
        expect(params).toMatchObject({
          threadId: 'thread-existing', limit: 25, sortDirection: 'desc', itemsView: 'full',
        });
        return cursor === 'remaining-page-2'
          ? remainingFullPage.promise
          : { data: [firstTurn], nextCursor: null, backwardsCursor: null };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), loadingStrategy: 'eager' });
    const historyEvents: CodexSurfaceEvent[] = [];
    const historyPrependedEvents: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => {
      if (event.type === 'conversation.historyReplaced') historyEvents.push(event);
      if (event.type === 'conversation.historyPrepended') historyPrependedEvents.push(event);
    });

    const snapshot = await surface.connect();

    expect(snapshot.messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'Second' }),
      expect.objectContaining({ type: 'tool', id: 'command-second', kind: 'command' }),
      expect.objectContaining({ type: 'text', text: 'Second reply' }),
    ]));
    remainingFullPage.resolve({ data: [firstTurn], nextCursor: null, backwardsCursor: null });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: 'First' }),
      expect.objectContaining({ type: 'tool', id: 'command-first', kind: 'command' }),
      expect.objectContaining({ type: 'text', text: 'Second' }),
      expect.objectContaining({ type: 'tool', id: 'command-second', kind: 'command' }),
      expect.objectContaining({ type: 'text', text: 'Second reply' }),
    ])));
    expect(surface.getSnapshot().conversations[0]).toMatchObject({ id: 'thread-existing', turnCount: 2 });
    expect(transport.sent.filter((message) => (
      'method' in message && message.method === 'thread/turns/list'
    ))).toHaveLength(1);
    expect(historyEvents).toHaveLength(1);
    expect(historyEvents[0]).toMatchObject({
      type: 'conversation.historyReplaced',
      origin: 'action',
      payload: { reason: 'resume' },
    });
    expect(historyPrependedEvents).toHaveLength(1);
    expect(historyPrependedEvents[0]).toMatchObject({
      type: 'conversation.historyPrepended',
      origin: 'lifecycle',
      payload: {
        messages: [
          expect.objectContaining({ id: 'user-thread-existing-turn-first-user-first' }),
          expect.objectContaining({ id: 'assistant-turn-first' }),
        ],
      },
    });
  });

  it('emits chronological non-cumulative batches during background hydration', async () => {
    const initialTurn = turn('turn-initial', 'completed', [
      { type: 'userMessage', id: 'user-initial', clientId: null, content: [{ type: 'text', text: 'Initial', text_elements: [] }] },
      { type: 'agentMessage', id: 'agent-initial', text: 'Initial reply', phase: null, memoryCitation: null },
    ]);
    const olderTurns = Array.from({ length: 5 }, (_, index) => historyTurn(`turn-older-${index}`, index));
    const remainingPage = deferred<unknown>();
    const transport = new FakeTransport({
      'thread/resume': () => ({
        ...resumeResponse(thread('thread-existing', false)),
        initialTurnsPage: { data: [initialTurn], nextCursor: 'older-page', backwardsCursor: null },
      }),
      'thread/turns/list': (params) => {
        expect(params).toMatchObject({ threadId: 'thread-existing', cursor: 'older-page', limit: 25 });
        return remainingPage.promise;
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), loadingStrategy: 'eager' });
    const prepended: Extract<CodexSurfaceEvent, { type: 'conversation.historyPrepended' }>[] = [];
    const replaced: Extract<CodexSurfaceEvent, { type: 'conversation.historyReplaced' }>[] = [];
    surface.onEvent((event) => {
      if (event.type === 'conversation.historyPrepended') prepended.push(event);
      if (event.type === 'conversation.historyReplaced') replaced.push(event);
    });

    const initialSnapshot = await surface.connect();
    expect(initialSnapshot.messages).toHaveLength(2);
    expect(prepended).toHaveLength(0);

    remainingPage.resolve({
      data: [...olderTurns].reverse(),
      nextCursor: null,
      backwardsCursor: null,
    });
    await vi.waitFor(() => expect(prepended).toHaveLength(2));

    expect(prepended.map((event) => event.payload.messages.length)).toEqual([25, 5]);
    expect(prepended.every((event) => {
      const turnIndexes = event.payload.messages.map((message) => {
        const turnId = message.metadata?.turnId;
        return Number(typeof turnId === 'string' ? turnId.split('-').at(-1) : NaN);
      });
      return turnIndexes.every((index, offset, values) => offset === 0 || index >= values[offset - 1]!);
    })).toBe(true);
    const consumerMessages = prepended.reduce<SurfaceMessage[]>(
      (messages, event) => [...event.payload.messages, ...messages],
      [],
    );
    expect(consumerMessages.map((message) => message.metadata?.turnId)).toEqual(
      olderTurns.flatMap((olderTurn) => Array.from({ length: 6 }, () => olderTurn.id)),
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.origin).toBe('action');
    expect(surface.getSnapshot().messages).toHaveLength(32);
  });

  it('keeps older history demand-paged by default', async () => {
    const initialTurn = turn('turn-initial', 'completed', [
      { type: 'userMessage', id: 'user-initial', clientId: null, content: [{ type: 'text', text: 'Initial', text_elements: [] }] },
      { type: 'agentMessage', id: 'agent-initial', text: 'Initial reply', phase: null, memoryCitation: null },
    ]);
    const olderTurn = historyTurn('turn-older', 1);
    const transport = new FakeTransport({
      'thread/resume': () => ({
        ...resumeResponse(thread('thread-existing', false)),
        initialTurnsPage: { data: [initialTurn], nextCursor: 'older-page', backwardsCursor: null },
      }),
      'thread/read': () => ({ thread: thread('thread-existing', false) }),
      'thread/turns/list': (params) => {
        expect(params).toMatchObject({
          threadId: 'thread-existing',
          limit: (params as { cursor: string | null }).cursor === null ? 50 : 25,
        });
        return (params as { cursor: string | null }).cursor === null
          ? { data: [initialTurn], nextCursor: 'older-page', backwardsCursor: null }
          : { data: [olderTurn], nextCursor: null, backwardsCursor: null };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });

    const initial = await surface.connect();
    expect(initial.historyState).toMatchObject({ loadingStrategy: 'lazy', hasOlder: true, fullyLoaded: false });
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'thread/turns/list')).toHaveLength(0);

    const page = await surface.loadOlderConversationHistory('thread-existing');
    expect(page).toMatchObject({ conversationId: 'thread-existing', hasOlder: false });
    expect(page.messages).toHaveLength(6);
    expect(surface.getSnapshot().historyState).toMatchObject({ hasOlder: false, fullyLoaded: true });

    const history = await surface.readConversationHistory('thread-existing');
    expect(history.messages).toHaveLength(8);
    expect(surface.getSnapshot().historyState).toMatchObject({ hasOlder: false, fullyLoaded: true });
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'thread/turns/list')
      .map((message) => ('params' in message ? (message.params as { cursor: string | null }).cursor : undefined)))
      .toEqual(['older-page', null, 'older-page']);
  });

  it('does not resurrect a completed turn from a stale background history page', async () => {
    const staleFullPage = deferred<unknown>();
    const runningTurn = turn('turn-running', 'inProgress', []);
    const transport = new FakeTransport({
      'thread/resume': () => {
        const running = thread('thread-existing', false);
        running.status = { type: 'active', activeFlags: [] };
        running.turns = [runningTurn];
        return {
          ...resumeResponse(running),
          initialTurnsPage: { data: [runningTurn], nextCursor: 'stale-page-2', backwardsCursor: null },
        };
      },
      'thread/turns/list': (params) => {
        expect(params).toMatchObject({ cursor: 'stale-page-2', itemsView: 'full' });
        return staleFullPage.promise;
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    expect(surface.getSnapshot().busy).toBe(true);

    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-running', 'completed', []) },
    });
    expect(surface.getSnapshot().busy).toBe(false);
    staleFullPage.resolve({ data: [runningTurn], nextCursor: null, backwardsCursor: null });
    await vi.waitFor(() => expect(surface.conversation('thread-existing').getSnapshot().activeTurnId).toBeNull());

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
