import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';
import type { CodexSurfaceEvent } from '../src/surface';
import { FakeTransport, createSurface, lastRequest, lastResponse, requestsFor, thread, turn } from './helpers/codex-surface-fixture';

describe('CodexSurface', () => {
  it('renders and resolves MCP confirmations that are not associated with a turn', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      id: 'mcp-thread-level',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-existing', turnId: null, serverName: 'calendar', mode: 'form',
        message: 'Allow calendar.list?', requestedSchema: { type: 'object', properties: {} },
        _meta: {
          codex_approval_kind: 'mcp_tool_call', tool_name: 'list', persist: null, tool_params: {},
        },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool', id: 'approval-mcp-thread-level', status: 'running',
          metadata: expect.objectContaining({ confirmationRequestId: 'mcp-thread-level' }),
        }),
      ]),
    ));
    await surface.respondToClientRequest({ id: 'mcp-thread-level', payload: { decision: 'allow' } });
    expect(lastResponse(transport, 'mcp-thread-level')).toMatchObject({ result: { action: 'accept' } });
    expect(surface.getSnapshot()).toMatchObject({
      busy: false,
      answeredClientRequestIds: ['mcp-thread-level'],
    });
    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool', id: 'approval-mcp-thread-level', status: 'running' }),
    ]));
  });

  it('completes plan items and finalizes orphaned running tools with the turn', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-plan', 'inProgress', []) },
    });
    transport.emit({
      method: 'item/plan/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-plan', itemId: 'plan-item', delta: 'draft' },
    });
    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing', turnId: 'turn-plan', startedAtMs: 1,
        item: {
          type: 'mcpToolCall', id: 'mcp-orphan', server: 'tools', tool: 'run', status: 'inProgress',
          arguments: {}, appContext: null, pluginId: null, result: null, error: null, durationMs: null,
        },
      },
    });
    transport.emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-plan', completedAtMs: 2,
        item: { type: 'plan', id: 'plan-item', text: '# Final plan' },
      },
    });
    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plan-progress-turn-plan', status: 'completed', body: '# Final plan' }),
      expect.objectContaining({ id: 'mcp-orphan', status: 'running' }),
    ]));
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-plan', 'interrupted', []) },
    });
    expect(surface.getSnapshot().messages.flatMap((message) => message.parts)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plan-progress-turn-plan', status: 'completed' }),
      expect.objectContaining({ id: 'mcp-orphan', status: 'failed' }),
    ]));
  });

  it('merges rate limits, preserves waiting status, and applies thread lifecycle events', async () => {
    const transport = new FakeTransport({
      'account/rateLimits/read': () => ({
        rateLimits: {
          limitId: 'codex', limitName: 'Codex',
          primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 100 },
          secondary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: 200 },
          credits: { hasCredits: true, unlimited: false, balance: '42' },
          individualLimit: null, planType: 'pro', rateLimitReachedType: null,
        },
        rateLimitsByLimitId: null,
        rateLimitResetCredits: { availableCount: 2n, credits: null },
      }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    expect(surface.getSnapshot().rateLimits).toMatchObject({
      rateLimits: { limitName: 'Codex', primary: { usedPercent: 10 }, credits: { balance: '42' } },
      rateLimitResetCredits: { availableCount: '2' },
    });
    transport.emit({
      method: 'account/rateLimits/updated',
      params: {
        rateLimits: {
          limitId: 'codex', limitName: null,
          primary: { usedPercent: 55, windowDurationMins: 300, resetsAt: 150 },
          secondary: null, credits: null, individualLimit: null, planType: null,
          rateLimitReachedType: null,
        },
      },
    });
    expect(surface.getSnapshot().rateLimits).toMatchObject({
      rateLimits: {
        limitName: 'Codex', primary: { usedPercent: 55, resetsAt: 150 },
        secondary: { usedPercent: 20 }, credits: { balance: '42' }, planType: 'pro',
      },
    });

    transport.emit({
      method: 'thread/status/changed',
      params: {
        threadId: 'thread-existing',
        status: { type: 'active', activeFlags: ['waitingOnApproval', 'waitingOnUserInput'] },
      },
    });
    expect(surface.getSnapshot()).toMatchObject({
      busy: true,
      threadStatus: { type: 'active', activeFlags: ['waitingOnApproval', 'waitingOnUserInput'] },
      conversations: [expect.objectContaining({ id: 'thread-existing', status: 'active' })],
    });
    transport.emit({
      method: 'thread/status/changed',
      params: { threadId: 'thread-existing', status: { type: 'idle' } },
    });
    expect(surface.getSnapshot()).toMatchObject({ busy: false, threadStatus: { type: 'idle' } });

    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-error', 'inProgress', []) },
    });
    transport.emit({
      method: 'error',
      params: {
        threadId: 'thread-existing', turnId: 'turn-error', willRetry: true,
        error: { message: 'Retrying', codexErrorInfo: null, additionalDetails: null },
      },
    });
    expect(surface.getSnapshot()).toMatchObject({ busy: true, error: 'Retrying' });
    transport.emit({
      method: 'error',
      params: {
        threadId: 'thread-existing', turnId: 'turn-error', willRetry: false,
        error: { message: 'Stopped', codexErrorInfo: null, additionalDetails: null },
      },
    });
    expect(surface.getSnapshot()).toMatchObject({ busy: false, error: 'Stopped' });

    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-system-error', 'inProgress', []) },
    });
    transport.emit({
      method: 'thread/status/changed',
      params: { threadId: 'thread-existing', status: { type: 'systemError' } },
    });
    expect(surface.getSnapshot()).toMatchObject({
      busy: false,
      error: 'Codex app-server reported a system error',
      threadStatus: { type: 'systemError' },
    });
    transport.emit({ method: 'thread/archived', params: { threadId: 'thread-existing' } });
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: null, conversations: [], messages: [] });
    transport.emit({ method: 'thread/unarchived', params: { threadId: 'thread-existing' } });
    await vi.waitFor(() => expect(surface.getSnapshot().conversations).toHaveLength(1));
    await surface.selectConversation('thread-existing');
    await surface.sendMessage('Running');
    transport.emit({ method: 'thread/closed', params: { threadId: 'thread-existing' } });
    expect(surface.getSnapshot()).toMatchObject({ busy: false, threadStatus: { type: 'idle' } });
    transport.emit({ method: 'thread/deleted', params: { threadId: 'thread-existing' } });
    expect(surface.getSnapshot()).toMatchObject({ activeConversationId: null, conversations: [] });
  });

  it('contains rejected fire-and-forget conversation refreshes after unarchive', async () => {
    let failRefresh = false;
    const transport = new FakeTransport({
      'thread/list': () => {
        if (failRefresh) throw new Error('refresh unavailable');
        return { data: [thread('thread-existing', false)], nextCursor: null };
      },
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport) });
    await surface.connect();
    failRefresh = true;

    transport.emit({ method: 'thread/unarchived', params: { threadId: 'thread-existing' } });
    await vi.waitFor(() => expect(surface.getSnapshot().error).toBe('refresh unavailable'));
    expect(surface.getSnapshot().conversations).toHaveLength(1);
  });

  it('exposes realtime voice as a typed conversation session', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const conversation = surface.conversation('thread-existing');
    const events: CodexSurfaceEvent[] = [];
    conversation.onEvent((event) => events.push(event));

    const session = await conversation.startRealtime({
      outputModality: 'audio',
      version: 'v2',
      voice: 'marin',
      includeStartupContext: true,
      flushTranscriptTailOnSessionEnd: true,
    });
    expect(lastRequest(transport, 'thread/realtime/start')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        outputModality: 'audio',
        version: 'v2',
        voice: 'marin',
        includeStartupContext: true,
        flushTranscriptTailOnSessionEnd: true,
        transport: { type: 'websocket' },
      },
    });

    await session.appendAudio({
      data: new Uint8Array([1, 2, 3, 4]),
      sampleRate: 16_000,
      numChannels: 1,
    });
    expect(lastRequest(transport, 'thread/realtime/appendAudio')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        audio: {
          data: 'AQIDBA==',
          sampleRate: 16_000,
          numChannels: 1,
          samplesPerChannel: 2,
          itemId: null,
        },
      },
    });

    await session.appendText('check the tests', 'user');
    await session.appendSpeech('I am checking the tests');
    expect(lastRequest(transport, 'thread/realtime/appendText')).toMatchObject({
      params: { threadId: 'thread-existing', text: 'check the tests', role: 'user' },
    });
    expect(lastRequest(transport, 'thread/realtime/appendSpeech')).toMatchObject({
      params: { threadId: 'thread-existing', text: 'I am checking the tests' },
    });

    transport.emit({
      method: 'thread/realtime/started',
      params: { threadId: 'thread-existing', realtimeSessionId: 'rtc_123', version: 'v2' },
    });
    transport.emit({
      method: 'thread/realtime/transcript/delta',
      params: { threadId: 'thread-existing', role: 'user', delta: 'check the' },
    });
    transport.emit({
      method: 'thread/realtime/transcript/done',
      params: { threadId: 'thread-existing', role: 'user', text: 'check the tests' },
    });
    transport.emit({
      method: 'thread/realtime/outputAudio/delta',
      params: {
        threadId: 'thread-existing',
        audio: {
          data: 'AQID',
          sampleRate: 24_000,
          numChannels: 1,
          samplesPerChannel: 3,
          itemId: 'audio-1',
        },
      },
    });
    transport.emit({
      method: 'thread/realtime/closed',
      params: { threadId: 'thread-existing', reason: 'requested' },
    });

    expect(events.map((event) => event.type)).toStrictEqual([
      'realtime.started',
      'realtime.transcriptDelta',
      'realtime.transcriptCompleted',
      'realtime.audioDelta',
      'realtime.closed',
    ]);
    expect(events[3]).toMatchObject({
      payload: {
        audio: {
          data: new Uint8Array([1, 2, 3]),
          sampleRate: 24_000,
          numChannels: 1,
          samplesPerChannel: 3,
          itemId: 'audio-1',
        },
      },
    });

    await session.stop();
    await session.stop();
    expect(requestsFor(transport, 'thread/realtime/stop')).toHaveLength(1);
    await expect(session.appendText('too late')).rejects.toThrow(
      "Realtime session for 'thread-existing' is stopped",
    );
  });

  it('negotiates WebRTC realtime before returning the session handle', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const conversation = surface.conversation('thread-existing');

    const sessionPromise = conversation.startRealtime({
      outputModality: 'audio',
      version: 'v1',
      transport: {
        type: 'webrtc',
        sdp: 'v=0\r\no=codex-remote-offer\r\n',
      },
    });
    await vi.waitFor(() => {
      expect(requestsFor(transport, 'thread/realtime/start')).toHaveLength(1);
    });
    expect(lastRequest(transport, 'thread/realtime/start')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        outputModality: 'audio',
        version: 'v1',
        transport: {
          type: 'webrtc',
          sdp: 'v=0\r\no=codex-remote-offer\r\n',
        },
      },
    });

    transport.emit({
      method: 'thread/realtime/sdp',
      params: {
        threadId: 'thread-existing',
        sdp: 'v=0\r\no=codex-remote-answer\r\n',
      },
    });
    const session = await sessionPromise;
    expect(session).toMatchObject({
      conversationId: 'thread-existing',
      transport: 'webrtc',
      remoteSdp: 'v=0\r\no=codex-remote-answer\r\n',
    });
    await expect(session.appendAudio({
      data: new Uint8Array([0, 0]),
      sampleRate: 24_000,
      numChannels: 1,
    })).rejects.toThrow('must be sent through its negotiated media track');
    await session.stop();
  });

  it('explicitly tolerates every known notification that has no surface projection', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const before = surface.getSnapshot();
    const ignoredMethods = [
      'hook/started',
      'hook/completed',
      'item/autoApprovalReview/started',
      'item/autoApprovalReview/completed',
      'command/exec/outputDelta',
      'process/outputDelta',
      'process/exited',
      'item/commandExecution/terminalInteraction',
      'item/fileChange/outputDelta',
      'mcpServer/oauthLogin/completed',
      'mcpServer/startupStatus/updated',
      'app/list/updated',
      'externalAgentConfig/import/progress',
      'externalAgentConfig/import/completed',
      'fs/changed',
      'model/verification',
      'turn/moderationMetadata',
      'model/safetyBuffering/updated',
      'warning',
      'guardianWarning',
      'deprecationNotice',
      'configWarning',
      'fuzzyFileSearch/sessionUpdated',
      'fuzzyFileSearch/sessionCompleted',
      'windows/worldWritableWarning',
      'windowsSandbox/setupCompleted',
    ];
    for (const method of ignoredMethods) transport.emit({ method, params: {} });
    expect(surface.getSnapshot()).toStrictEqual(before);
  });

  it('projects remote-control status changes as a host event', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    const events: CodexSurfaceEvent[] = [];
    surface.onEvent((event) => events.push(event));

    transport.emit({
      method: 'remoteControl/status/changed',
      params: {
        status: 'connected',
        serverName: 'Codex remote control',
        installationId: 'installation-1',
        environmentId: 'environment-1',
      },
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'remoteControl.statusChanged',
      origin: 'notification',
      payload: {
        status: {
          status: 'connected',
          serverName: 'Codex remote control',
          installationId: 'installation-1',
          environmentId: 'environment-1',
        },
      },
    }));
  });

  it('ignores and reports notifications added by a newer app-server schema', async () => {
    const transport = new FakeTransport();
    const onUnknownNotification = vi.fn();
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      onUnknownNotification,
    });
    await surface.connect();
    const before = surface.getSnapshot();
    const notification = {
      method: 'future/notification',
      params: { threadId: 'thread-existing', future: true },
    };

    expect(() => transport.emit(notification)).not.toThrow();
    expect(onUnknownNotification).toHaveBeenCalledOnce();
    expect(onUnknownNotification).toHaveBeenCalledWith(notification);
    expect(surface.getSnapshot()).toStrictEqual(before);
  });

  it('makes every non-UI server-request policy explicit and fail-closed', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({ id: 'time', method: 'currentTime/read', params: { threadId: 'thread-existing' } });
    await vi.waitFor(() => expect(lastResponse(transport, 'time')).toMatchObject({
      result: { currentTimeAt: expect.any(Number) },
    }));

    const unsupported = [
      {
        id: 'dynamic', method: 'item/tool/call',
        params: { threadId: 'thread-existing', turnId: 'turn', callId: 'call', namespace: null, tool: 'host', arguments: {} },
      },
      {
        id: 'auth', method: 'account/chatgptAuthTokens/refresh',
        params: { reason: 'unauthorized', previousAccountId: null },
      },
      { id: 'attestation', method: 'attestation/generate', params: {} },
    ];
    for (const request of unsupported) {
      transport.emit(request);
      await vi.waitFor(() => expect(lastResponse(transport, request.id)).toMatchObject({
        error: { code: -32601 },
      }));
    }
  });

  it('removes externally resolved approvals from the active surface', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      id: 'external-approval',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn', itemId: 'command', command: 'npm test',
        cwd: '/tmp/project', reason: null, environmentId: null, commandActions: [],
        networkApprovalContext: null, additionalPermissions: null, availableDecisions: null,
        proposedExecpolicyAmendment: null,
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    transport.emit({
      method: 'serverRequest/resolved',
      params: { threadId: 'thread-existing', requestId: 'external-approval' },
    });
    expect(surface.getSnapshot().approvals).toStrictEqual([]);
    await expect(surface.resolveApproval('external-approval', 'approve')).rejects.toThrow('Unknown approval');
  });

});
