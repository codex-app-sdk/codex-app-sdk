import { describe, expect, it, vi } from 'vitest';
import type { RpcMessage, RpcTransport } from '../src/codex';
import { CodexAppServerClient } from '../src/codex';
import { CodexSurface } from '../src/node';

class FakeTransport implements RpcTransport {
  readonly sent: RpcMessage[] = [];
  readonly close = vi.fn(async () => undefined);
  readonly start = vi.fn(async () => undefined);
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  constructor(private readonly responses: Record<string, (params: unknown) => unknown> = {}) {}

  send(message: RpcMessage): void {
    this.sent.push(message);
    if (!('id' in message) || !('method' in message)) return;
    const params = 'params' in message ? message.params : undefined;
    try {
      const response = this.responses[message.method]?.(params) ?? responseFor(message.method, params);
      queueMicrotask(() => this.emit({ id: message.id, result: response }));
    } catch (error) {
      queueMicrotask(() => this.emit({
        id: message.id,
        error: { code: -1, message: error instanceof Error ? error.message : String(error) },
      }));
    }
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  emit(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  fail(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

describe('CodexSurface', () => {
  it('enters an error state after disconnect and reconnects the app-server', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();

    transport.fail(new Error('app-server exited'));
    expect(surface.getSnapshot()).toMatchObject({
      status: 'error',
      busy: false,
      approvals: [],
      error: 'app-server exited',
    });

    await expect(surface.connect()).resolves.toMatchObject({ status: 'ready', error: null });
    expect(transport.start).toHaveBeenCalledTimes(2);
  });

  it('bootstraps Codex and exposes conversation summaries without protocol details', async () => {
    const { surface, transport } = createSurface();
    const listener = vi.fn();
    surface.onStateChange(listener);

    const snapshot = await surface.connect();

    expect(snapshot).toMatchObject({
      status: 'ready',
      activeConversationId: 'thread-existing',
      conversations: [{
        id: 'thread-existing',
        title: 'Existing thread',
        preview: 'Existing thread',
        cwd: '/tmp/project',
      }],
      messages: expect.arrayContaining([expect.objectContaining({
        id: 'user-thread-existing-turn-history-user-history',
      })]),
      modelCatalogStatus: 'loaded',
      selectedModelId: 'gpt-5',
      approvalPreset: 'ask-for-approval',
    });
    expect(transport.sent.map((message) => 'method' in message ? message.method : null)).toStrictEqual([
      'initialize', 'initialized', 'model/list', 'skills/list', 'permissionProfile/list', 'thread/list',
      'configRequirements/read', 'thread/resume',
    ]);
    expect(listener).toHaveBeenCalled();
    await expect(surface.connect()).resolves.toMatchObject({ status: 'ready' });
    expect(transport.start).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent bootstrap and honors client and list configuration', async () => {
    const transport = new FakeTransport();
    const surface = new CodexSurface({
      client: new CodexAppServerClient(transport),
      clientInfo: { name: 'custom_surface', version: '2.0.0' },
      conversationLimit: 12,
      cwd: '/tmp/project',
    });
    const first = surface.connect();
    const second = surface.connect();
    expect(second).toBe(first);
    await first;
    expect(transport.sent.find((message) => 'method' in message && message.method === 'initialize')).toMatchObject({
      params: { clientInfo: { name: 'custom_surface', title: null, version: '2.0.0' } },
    });
    expect(transport.sent.find((message) => 'method' in message && message.method === 'thread/list')).toMatchObject({
      params: { limit: 12 },
    });
    expect(transport.sent.find((message) => 'method' in message && message.method === 'thread/list')).not.toMatchObject({
      params: { cwd: expect.anything() },
    });
  });

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

  it('creates conversations with app-server-backed permission defaults and interrupts active turns', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.createConversation();
    const startRequest = transport.sent.find((message) => 'method' in message && message.method === 'thread/start');
    expect(startRequest).toMatchObject({
      method: 'thread/start',
      params: {
        approvalPolicy: 'on-request', approvalsReviewer: 'user', cwd: '/tmp/project', permissions: ':workspace',
      },
    });

    await surface.sendMessage('Inspect this project');
    await surface.interrupt();
    expect(lastRequest(transport, 'turn/interrupt')).toMatchObject({
      params: { threadId: 'thread-new', turnId: 'turn-live' },
    });
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'another-thread', turn: turn('ignored-turn', 'inProgress', []) },
    });
  });

  it('maps product options, creates on first send, and queues concurrent prompts', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.createConversation({
      approvalMode: 'ask', cwd: '/tmp/other', model: 'gpt-custom', permissionMode: 'full-access',
    });
    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: {
        approvalPolicy: 'on-request', cwd: '/tmp/other', model: 'gpt-custom', sandbox: 'danger-full-access',
      },
    });
    await surface.sendMessage('First', { model: 'gpt-turn' });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({ params: { model: 'gpt-turn' } });
    await expect(surface.sendMessage('Second')).resolves.toMatchObject({
      queuedPrompts: [{ text: 'Second' }],
    });

    const fresh = createSurface();
    await fresh.surface.sendMessage('Continue automatically');
    expect(lastRequest(fresh.transport, 'thread/start')).toBeUndefined();
    expect(lastRequest(fresh.transport, 'turn/start')).toMatchObject({ params: { threadId: 'thread-existing' } });
  });

  it('updates model, reasoning, plan mode, and permissions through app-server settings', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();

    const snapshot = await surface.updateConversationSettings({
      modelId: 'gpt-mini',
      reasoningEffort: 'high',
      approvalPreset: 'full-access',
      planMode: true,
    });

    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: {
        threadId: 'thread-existing',
        model: 'gpt-mini-runtime',
        effort: 'high',
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        permissions: ':danger-full-access',
        collaborationMode: {
          mode: 'plan',
          settings: { model: 'gpt-mini-runtime', reasoning_effort: 'high' },
        },
      },
    });
    expect(snapshot).toMatchObject({
      selectedModelId: 'gpt-mini',
      selectedReasoningEffort: 'high',
      approvalPreset: 'full-access',
      planMode: true,
    });
  });

  it('keeps catalogs and settings useful when there is no persisted conversation', async () => {
    const transport = new FakeTransport({
      'model/list': () => ({ data: [], nextCursor: null }),
      'permissionProfile/list': () => ({ data: [], nextCursor: null }),
      'thread/list': () => ({ data: [], nextCursor: null }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });

    await expect(surface.connect()).resolves.toMatchObject({
      activeConversationId: null,
      models: [],
      selectedModelId: null,
      selectedReasoningEffort: null,
      approvalPresets: [],
      approvalPreset: null,
    });
    await surface.updateConversationSettings({ planMode: true });
    expect(lastRequest(transport, 'thread/settings/update')).toBeUndefined();

    await surface.sendMessage('Start the first thread');
    expect(lastRequest(transport, 'thread/start')).toMatchObject({
      params: { approvalPolicy: 'never', sandbox: 'read-only' },
    });
    expect(lastRequest(transport, 'turn/start')).toMatchObject({
      params: { threadId: 'thread-new' },
    });
  });

  it('degrades catalogs safely when app-server catalog requests fail', async () => {
    const transport = new FakeTransport({
      'model/list': () => { throw new Error('models unavailable'); },
      'permissionProfile/list': () => { throw new Error('profiles unavailable'); },
      'thread/list': () => ({ data: [], nextCursor: null }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });

    await expect(surface.connect()).resolves.toMatchObject({
      status: 'ready',
      modelCatalogStatus: 'error',
      models: [],
      permissionProfiles: [],
      approvalPresets: [],
      approvalPreset: null,
    });
    expect(lastRequest(transport, 'configRequirements/read')).toBeUndefined();
  });

  it('paginates catalogs and applies app-server permission requirements', async () => {
    const transport = new FakeTransport({
      'model/list': (params) => (params as { cursor?: string | null }).cursor
        ? { data: [testModel('model-default', 'runtime-default', true)], nextCursor: null }
        : { data: [testModel('model-first', 'runtime-first', false)], nextCursor: 'models-2' },
      'permissionProfile/list': (params) => (params as { cursor?: string | null }).cursor
        ? {
            data: [
              { id: ':danger-full-access', description: null, allowed: true },
              { id: ':disabled', description: null, allowed: false },
            ],
            nextCursor: null,
          }
        : {
            data: [{ id: ':workspace', description: 'Project files', allowed: true }],
            nextCursor: 'profiles-2',
          },
      'configRequirements/read': () => ({
        requirements: {
          allowedApprovalPolicies: ['on-request'],
          allowedApprovalsReviewers: ['user'],
        },
      }),
      'thread/list': (params) => (params as { cursor?: string | null }).cursor
        ? { data: [thread('thread-second-page', false)], nextCursor: null }
        : { data: [thread('thread-first-page', false)], nextCursor: 'threads-2' },
    });
    const surface = new CodexSurface({
      approvalPreset: 'full-access',
      client: new CodexAppServerClient(transport),
      cwd: '/tmp/project',
    });

    await expect(surface.connect()).resolves.toMatchObject({
      models: [{ id: 'model-first' }, { id: 'model-default' }],
      selectedModelId: 'model-default',
      approvalPresets: ['ask-for-approval'],
      approvalPreset: 'ask-for-approval',
    });
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'model/list')).toHaveLength(2);
    expect(transport.sent.filter((message) => 'method' in message && message.method === 'permissionProfile/list')).toHaveLength(2);
    const threadListRequests = transport.sent.filter(
      (message) => 'method' in message && message.method === 'thread/list',
    );
    expect(threadListRequests).toHaveLength(2);
    expect(threadListRequests).not.toContainEqual(expect.objectContaining({ params: { cwd: expect.anything() } }));
    expect(surface.getSnapshot().conversations.map((conversation) => conversation.id)).toStrictEqual([
      'thread-first-page',
      'thread-second-page',
    ]);
  });

  it('rejects invalid settings and falls back to a supported effort when the model changes', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();

    await expect(surface.updateConversationSettings({ modelId: 'missing' })).rejects.toThrow("Unknown model 'missing'");
    await expect(surface.updateConversationSettings({ reasoningEffort: 'ultra' })).rejects.toThrow(
      "Reasoning effort 'ultra' is not available",
    );
    await expect(surface.updateConversationSettings({
      approvalPreset: 'blocked' as never,
    })).rejects.toThrow("Approval preset 'blocked' is not available");

    await surface.updateConversationSettings({ modelId: 'gpt-mini', reasoningEffort: 'high' });
    const snapshot = await surface.updateConversationSettings({ modelId: 'gpt-5' });
    expect(snapshot.selectedReasoningEffort).toBe('medium');
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: { model: 'gpt-5', effort: 'medium' },
    });
  });

  it('supports focused settings updates and authoritative settings notifications', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();

    await surface.updateConversationSettings({ approvalPreset: 'approve-for-me' });
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', permissions: ':workspace' },
    });
    await surface.updateConversationSettings({ planMode: false });
    expect(lastRequest(transport, 'thread/settings/update')).toMatchObject({
      params: { collaborationMode: { mode: 'default' } },
    });

    transport.emit({
      method: 'thread/settings/updated',
      params: {
        threadId: 'thread-existing',
        threadSettings: threadSettings({
          approvalPolicy: 'never',
          approvalsReviewer: 'user',
          sandboxPolicy: { type: 'readOnly', networkAccess: false },
          activePermissionProfile: { id: ':danger-no-sandbox', extends: null },
          collaborationMode: {
            mode: 'plan',
            settings: { model: 'gpt-mini-runtime', reasoning_effort: 'high', developer_instructions: null },
          },
          model: 'gpt-mini-runtime',
          effort: 'high',
        }),
      },
    });
    expect(surface.getSnapshot()).toMatchObject({
      approvalPreset: 'full-access',
      planMode: true,
      selectedModelId: 'gpt-mini',
      selectedReasoningEffort: 'high',
    });
  });

  it('honors explicit main-process policy defaults', async () => {
    const cases = [
      { options: { approvalPreset: 'full-access' as const }, expected: 'full-access' },
      { options: { approvalMode: 'never' as const, permissionMode: 'full-access' as const }, expected: 'full-access' },
      { options: { approvalMode: 'ask' as const, permissionMode: 'workspace-write' as const }, expected: 'ask-for-approval' },
      { options: { approvalMode: 'never' as const, permissionMode: 'read-only' as const }, expected: null },
    ];

    for (const entry of cases) {
      const transport = new FakeTransport({ 'thread/list': () => ({ data: [], nextCursor: null }) });
      const surface = new CodexSurface({
        ...entry.options,
        client: new CodexAppServerClient(transport),
        cwd: '/tmp/project',
      });
      expect((await surface.connect()).approvalPreset).toBe(entry.expected);
    }
  });

  it('reports invalid and failed steering without losing the active conversation', async () => {
    const transport = new FakeTransport({
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

  it('handles completed start responses and running history', async () => {
    const transport = new FakeTransport({
      'thread/resume': (params) => {
        const value = thread(String((params as { threadId: string }).threadId), false);
        value.turns = [turn('turn-running', 'inProgress', [])];
        return resumeResponse(value);
      },
      'turn/start': () => ({ turn: turn('turn-already-done', 'completed', []) }),
    });
    const surface = new CodexSurface({ client: new CodexAppServerClient(transport), cwd: '/tmp/project' });
    await surface.connect();
    expect((await surface.selectConversation('thread-existing')).busy).toBe(true);
    transport.emit({
      method: 'turn/completed',
      params: { threadId: 'thread-existing', turn: turn('turn-running', 'completed', []) },
    });
    await surface.sendMessage('Quick answer');
    expect(surface.getSnapshot().busy).toBe(false);
    await expect(surface.interrupt()).resolves.toMatchObject({ busy: false });
  });

  it('tracks names, completed tool items, errors, and lifecycle cleanup', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.selectConversation('thread-existing');
    transport.emit({ method: 'thread/name/updated', params: { threadId: 'thread-existing', threadName: 'Renamed' } });
    transport.emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-tool', completedAtMs: 1_700_000_002_000,
        item: {
          type: 'commandExecution', id: 'command', command: 'npm test', cwd: '/tmp/project', processId: null,
          source: 'unifiedExec', status: 'failed', commandActions: [], aggregatedOutput: 'failed', exitCode: 1,
          durationMs: 20,
        },
      },
    });
    transport.emit({
      method: 'error',
      params: {
        threadId: 'thread-existing', turnId: 'turn-tool', willRetry: false,
        error: { message: 'No network', codexErrorInfo: null, additionalDetails: null },
      },
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
    await surface.close();
    await surface.close();
    expect(transport.close).toHaveBeenCalledOnce();
    await expect(surface.connect()).rejects.toThrow('Codex surface is closed');
  });

  it('reduces started, replaced, ignored, and failed lifecycle variants', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.selectConversation('thread-existing');
    const startedThread = thread('thread-started', false);
    startedThread.name = 'Named thread';
    startedThread.status = { type: 'active', activeFlags: [] };
    startedThread.recencyAt = 1_700_000_010;
    transport.emit({ method: 'thread/started', params: { thread: startedThread } });
    transport.emit({ method: 'thread/name/updated', params: { threadId: 'missing', threadName: '' } });
    transport.emit({
      method: 'turn/started',
      params: { threadId: 'thread-existing', turn: turn('turn-variant', 'inProgress', []) },
    });
    const command = {
      type: 'commandExecution', id: 'command-variant', command: 'pwd', cwd: '/tmp/project', processId: null,
      source: 'unifiedExec', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null,
    };
    transport.emit({
      method: 'item/started',
      params: { threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 1, item: command },
    });
    transport.emit({
      method: 'item/completed',
      params: {
        threadId: 'thread-existing', turnId: 'turn-variant', completedAtMs: 2,
        item: { ...command, status: 'completed' },
      },
    });
    const user = {
      type: 'userMessage', id: 'user-variant', clientId: null,
      content: [{ type: 'text', text: 'Steer', text_elements: [] }],
    };
    transport.emit({
      method: 'item/started',
      params: { threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 3, item: user },
    });
    transport.emit({
      method: 'item/started',
      params: { threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 3, item: user },
    });
    transport.emit({
      method: 'item/started',
      params: {
        threadId: 'thread-existing', turnId: 'turn-variant', startedAtMs: 4,
        item: { type: 'contextCompaction', id: 'compact' },
      },
    });
    transport.emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'other', turnId: 'turn', itemId: 'ignored', delta: 'ignored' },
    });
    transport.emit({
      method: 'item/started',
      params: { threadId: 'other', turnId: 'turn', startedAtMs: 1, item: command },
    });
    transport.emit({ method: 'turn/completed', params: { threadId: 'other', turn: turn('turn', 'completed', []) } });
    transport.emit({
      method: 'error',
      params: {
        threadId: 'other', turnId: 'turn', willRetry: false,
        error: { message: 'Ignored', codexErrorInfo: null, additionalDetails: null },
      },
    });
    transport.emit({
      method: 'turn/completed',
      params: {
        threadId: 'thread-existing',
        turn: { ...turn('turn-variant', 'failed', []), error: { message: 'Failed turn', codexErrorInfo: null, additionalDetails: null } },
      },
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
    await surface.respondToClientRequest({
      id: 'ask-1', payload: { answers: { target: { answers: ['README.md'] } } },
    });
    expect(lastResponse(transport, 'ask-1')).toMatchObject({
      result: { answers: { target: { answers: ['README.md'] } } },
    });

    transport.emit({
      id: 'mcp-1',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread-existing', turnId: 'turn-input', serverName: 'calendar', mode: 'form',
        message: 'Allow calendar.create_event?', requestedSchema: { type: 'object', properties: {} },
        _meta: {
          codex_approval_kind: 'mcp_tool_call', tool_name: 'create_event', persist: ['session', 'always'],
          tool_params: { title: 'Planning' },
        },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.some((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'approval-mcp-1')
    ))).toBe(true));
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
    await expect(surface.setGoal('Ship')).rejects.toThrow('no active conversation');
    await expect(surface.clearGoal()).rejects.toThrow('no active conversation');
    await expect(surface.sendMessage('/compact')).rejects.toThrow('no active conversation');
    await expect(surface.sendMessage('/review')).rejects.toThrow('no active conversation');

    await surface.createConversation();
    expect(lastRequest(transport, 'thread/start')).not.toMatchObject({ params: { cwd: expect.anything() } });
    await expect(surface.setGoal('   ')).rejects.toThrow('cannot be empty');
    await surface.setGoal(' Ship ', null);
    expect(lastRequest(transport, 'thread/goal/set')).toMatchObject({
      params: { threadId: 'thread-new', objective: 'Ship', tokenBudget: null },
    });
    await surface.clearGoal();
    expect(lastRequest(transport, 'thread/goal/clear')).toMatchObject({ params: { threadId: 'thread-new' } });
    await surface.sendMessage('/review');
    expect(surface.getSnapshot().busy).toBe(false);
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
    const secondQueue = await queued.surface.sendMessage('Steer now');
    const steerId = secondQueue.queuedPrompts[0]!.id;
    await queued.surface.steerQueuedPrompt(steerId);
    expect(lastRequest(queued.transport, 'turn/steer')).toMatchObject({
      params: { input: [{ type: 'text', text: 'Steer now' }] },
    });
    await expect(queued.surface.steerQueuedPrompt('missing')).rejects.toThrow('Unknown queued prompt');
  });

  it('reduces every streamed tool update and resolves cancellation and confirmation variants', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    transport.emit({
      method: 'turn/started', params: { threadId: 'thread-existing', turn: turn('turn-stream', 'inProgress', []) },
    });
    transport.emit({
      method: 'item/commandExecution/outputDelta',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'cmd-stream', delta: 'one' },
    });
    transport.emit({
      method: 'item/commandExecution/outputDelta',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'cmd-stream', delta: 'two' },
    });
    transport.emit({
      method: 'item/fileChange/patchUpdated',
      params: {
        threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'patch-stream',
        changes: [{ path: 'src/new.ts', kind: { type: 'add' }, diff: 'one\ntwo' }],
      },
    });
    transport.emit({
      method: 'item/mcpToolCall/progress',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'mcp-stream', message: 'opening' },
    });
    transport.emit({
      method: 'item/mcpToolCall/progress',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'mcp-stream', message: 'done' },
    });
    transport.emit({
      method: 'item/plan/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'plan', delta: 'First\n' },
    });
    transport.emit({
      method: 'item/plan/delta',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'plan', delta: 'Second\n' },
    });
    transport.emit({
      method: 'turn/plan/updated',
      params: { threadId: 'thread-existing', turnId: 'turn-stream', explanation: null, plan: [] },
    });
    transport.emit({
      method: 'thread/compacted', params: { threadId: 'thread-existing', turnId: 'turn-stream' },
    });
    transport.emit({
      method: 'thread/compacted', params: { threadId: 'thread-existing', turnId: 'turn-stream' },
    });
    const parts = surface.getSnapshot().messages.flatMap((message) => message.parts);
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cmd-stream', body: 'onetwo' }),
      expect.objectContaining({ id: 'patch-stream', status: 'running' }),
      expect.objectContaining({ id: 'mcp-stream', body: 'opening\ndone' }),
    ]));
    expect(surface.getSnapshot().messages.filter((message) => message.kind === 'compaction')).toHaveLength(1);

    transport.emit({
      id: 'ask-cancel', method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-existing', turnId: 'turn-stream', itemId: 'ask-cancel-item', autoResolutionMs: 60_000,
        questions: [{ id: 'q', header: 'Q', question: 'Answer?', isOther: false, isSecret: true, options: null }],
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().messages.some((message) => (
      message.parts.some((part) => part.type === 'tool' && part.id === 'ask-cancel-item')
    ))).toBe(true));
    await surface.respondToClientRequest({ id: 'ask-cancel', payload: { cancelled: true } });
    expect(lastResponse(transport, 'ask-cancel')).toMatchObject({ result: { answers: {} } });
    await expect(surface.respondToClientRequest({ id: 'ask-cancel' })).rejects.toThrow('Unknown client request');

    for (const [id, decision, persist] of [
      ['mcp-once', 'allow', null],
      ['mcp-always', 'always_allow', 'always'],
      ['mcp-deny', 'deny', null],
    ] as const) {
      transport.emit({
        id, method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'thread-existing', turnId: 'turn-stream', serverName: 'tools', mode: 'form',
          message: '', requestedSchema: { type: 'object', properties: {} },
          _meta: {
            codex_approval_kind: 'mcp_tool_call', tool_title: 'Run', persist,
            tool_params_display: [{ name: 'path', display_name: 'Path', value: { file: 'README.md' } }, null],
          },
        },
      });
      await vi.waitFor(() => expect(surface.getSnapshot().messages.some((message) => (
        message.parts.some((part) => part.type === 'tool' && part.id === `approval-${id}`)
      ))).toBe(true));
      await surface.respondToClientRequest({ id, payload: { decision } });
    }
    expect(lastResponse(transport, 'mcp-once')).toMatchObject({ result: { action: 'accept', _meta: null } });
    expect(lastResponse(transport, 'mcp-always')).toMatchObject({ result: { _meta: { persist: 'always' } } });
    expect(lastResponse(transport, 'mcp-deny')).toMatchObject({ result: { action: 'decline' } });
  });

  it('rejects invalid sends and ignores interrupts without an active turn', async () => {
    const { surface } = createSurface();
    await surface.connect();
    await expect(surface.sendMessage('   ')).rejects.toThrow('empty message');
    await expect(surface.interrupt()).resolves.toMatchObject({ busy: false });
    await expect(surface.resolveApproval('missing', 'deny')).rejects.toThrow('Unknown approval');
  });

  it('adapts server approval requests and resolves them through one surface API', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();

    transport.emit({
      id: 90,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'command-1', startedAtMs: 1,
        command: 'npm test', cwd: '/tmp/project', reason: 'Run tests', environmentId: null,
        networkApprovalContext: { host: 'registry.npmjs.org', protocol: 'https' },
        additionalPermissions: {
          network: { enabled: true },
          fileSystem: {
            read: null,
            write: null,
            entries: [{ path: { type: 'glob_pattern', pattern: '/tmp/results/**' }, access: 'write' }],
          },
        },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    expect(surface.getSnapshot().approvals[0]).toMatchObject({
      id: '90', kind: 'command', title: 'Run command', command: 'npm test',
      requestedPermissions: [
        { kind: 'network', enabled: true, host: 'registry.npmjs.org', protocol: 'https' },
        { kind: 'filesystem', access: 'write', path: '/tmp/results/**' },
      ],
    });
    await surface.resolveApproval('90', 'approve', 'session');
    expect(lastResponse(transport, 90)).toMatchObject({ result: { decision: 'acceptForSession' } });

    transport.emit({
      id: 'patch-1', method: 'item/fileChange/requestApproval',
      params: { threadId: 'thread-existing', turnId: 'turn-1', itemId: 'patch-item', startedAtMs: 1, grantRoot: '/tmp/project' },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('patch-1', 'deny');
    expect(lastResponse(transport, 'patch-1')).toMatchObject({ result: { decision: 'decline' } });

    transport.emit({
      id: 91, method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'permissions-1', startedAtMs: 1,
        environmentId: null, cwd: '/tmp/project', reason: null,
        permissions: {
          network: { enabled: null },
          fileSystem: {
            read: ['/tmp'],
            write: ['/tmp'],
            entries: [
              { path: { type: 'path', path: '/var/log' }, access: 'read' },
              { path: { type: 'special', value: { kind: 'root' } }, access: 'deny' },
              { path: { type: 'special', value: { kind: 'minimal' } }, access: 'read' },
              { path: { type: 'special', value: { kind: 'project_roots', subpath: 'src' } }, access: 'write' },
              { path: { type: 'special', value: { kind: 'tmpdir' } }, access: 'write' },
              { path: { type: 'special', value: { kind: 'slash_tmp' } }, access: 'write' },
              { path: { type: 'special', value: { kind: 'unknown', path: '/private', subpath: 'cache' } }, access: 'write' },
            ],
          },
        },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    expect(surface.getSnapshot().approvals[0]?.requestedPermissions).toStrictEqual([
      { kind: 'network', enabled: false },
      { kind: 'filesystem', access: 'read', path: '/tmp' },
      { kind: 'filesystem', access: 'write', path: '/tmp' },
      { kind: 'filesystem', access: 'read', path: '/var/log' },
      { kind: 'filesystem', access: 'deny', path: 'filesystem root' },
      { kind: 'filesystem', access: 'read', path: 'minimal runtime paths' },
      { kind: 'filesystem', access: 'write', path: 'project roots/src' },
      { kind: 'filesystem', access: 'write', path: 'system temporary directory' },
      { kind: 'filesystem', access: 'write', path: '/tmp' },
      { kind: 'filesystem', access: 'write', path: '/private/cache' },
    ]);
    await surface.resolveApproval('91', 'approve');
    expect(lastResponse(transport, 91)).toMatchObject({ result: { scope: 'turn' } });

    transport.emit({
      id: 92, method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'permissions-2', startedAtMs: 1,
        environmentId: null, cwd: '/tmp/project', reason: 'Use network',
        permissions: { fileSystem: null, network: { enabled: true } },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('92', 'deny', 'session');
    expect(lastResponse(transport, 92)).toMatchObject({ result: { permissions: {}, scope: 'session' } });

    transport.emit({
      id: 'legacy-command', method: 'execCommandApproval',
      params: {
        conversationId: 'thread-existing', callId: 'legacy-command-item', approvalId: null,
        command: ['npm', 'test'], cwd: '/tmp/project', reason: 'Verify', parsedCmd: [],
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('legacy-command', 'approve');
    expect(lastResponse(transport, 'legacy-command')).toMatchObject({ result: { decision: 'approved' } });

    transport.emit({
      id: 'legacy-patch', method: 'applyPatchApproval',
      params: {
        conversationId: 'thread-existing', callId: 'legacy-patch-item', fileChanges: {},
        reason: null, grantRoot: '/tmp/project',
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    expect(surface.getSnapshot().approvals[0]?.description).toBe('Write under /tmp/project');
    await surface.resolveApproval('legacy-patch', 'approve', 'session');
    expect(lastResponse(transport, 'legacy-patch')).toMatchObject({ result: { decision: 'approved_for_session' } });

    transport.emit({
      id: 93, method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'command-2', startedAtMs: 1,
        command: null, cwd: null, reason: null, environmentId: null,
        availableDecisions: ['accept', 'cancel'],
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    expect(surface.getSnapshot().approvals[0]).toMatchObject({ allowedScopes: ['once'], canDeny: true });
    await expect(surface.resolveApproval('93', 'approve', 'session')).rejects.toThrow(
      "Approval decision 'approve:session' is not available",
    );
    await surface.resolveApproval('93', 'deny');
    expect(lastResponse(transport, 93)).toMatchObject({ result: { decision: 'cancel' } });

    transport.emit({
      id: 'patch-2', method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'patch-item-2', startedAtMs: 1,
        reason: 'Update generated files', grantRoot: null,
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('patch-2', 'approve', 'session');
    expect(lastResponse(transport, 'patch-2')).toMatchObject({ result: { decision: 'acceptForSession' } });

    transport.emit({
      id: 94, method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-existing', turnId: 'turn-1', itemId: 'permissions-3', startedAtMs: 1,
        environmentId: null, cwd: '/tmp/project', reason: 'Use network',
        permissions: { fileSystem: null, network: { enabled: true } },
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('94', 'approve', 'session');
    expect(lastResponse(transport, 94)).toMatchObject({ result: { scope: 'session' } });

    transport.emit({
      id: 'legacy-command-deny', method: 'execCommandApproval',
      params: {
        conversationId: 'thread-existing', callId: 'legacy-command-deny-item', approvalId: null,
        command: ['false'], cwd: '/tmp/project', reason: null, parsedCmd: [],
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('legacy-command-deny', 'deny');
    expect(lastResponse(transport, 'legacy-command-deny')).toMatchObject({ result: { decision: 'denied' } });

    transport.emit({
      id: 'legacy-patch-deny', method: 'applyPatchApproval',
      params: {
        conversationId: 'thread-existing', callId: 'legacy-patch-deny-item', fileChanges: {},
        reason: 'Review changes', grantRoot: null,
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('legacy-patch-deny', 'deny');
    expect(lastResponse(transport, 'legacy-patch-deny')).toMatchObject({ result: { decision: 'denied' } });

    transport.emit({
      id: 'legacy-patch-once', method: 'applyPatchApproval',
      params: {
        conversationId: 'thread-existing', callId: 'legacy-patch-once-item', fileChanges: {},
        reason: null, grantRoot: null,
      },
    });
    await vi.waitFor(() => expect(surface.getSnapshot().approvals).toHaveLength(1));
    await surface.resolveApproval('legacy-patch-once', 'approve');
    expect(lastResponse(transport, 'legacy-patch-once')).toMatchObject({ result: { decision: 'approved' } });
  });
});

function createSurface(): { surface: CodexSurface; transport: FakeTransport } {
  const transport = new FakeTransport();
  return {
    transport,
    surface: new CodexSurface({
      client: new CodexAppServerClient(transport),
      cwd: '/tmp/project',
    }),
  };
}

function responseFor(method: string, params: unknown): unknown {
  switch (method) {
    case 'initialize': return { userAgent: 'test' };
    case 'model/list': return {
      data: [
        {
          id: 'gpt-5', model: 'gpt-5', upgrade: null, upgradeInfo: null, availabilityNux: null,
          displayName: 'GPT-5', description: 'Test model', hidden: false,
          supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
          defaultReasoningEffort: 'medium', inputModalities: ['text'], supportsPersonality: true,
          additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null, isDefault: true,
        },
        {
          id: 'gpt-mini', model: 'gpt-mini-runtime', upgrade: null, upgradeInfo: null, availabilityNux: null,
          displayName: 'GPT Mini', description: 'Fast model', hidden: false,
          supportedReasoningEfforts: [
            { reasoningEffort: 'medium', description: 'Balanced' },
            { reasoningEffort: 'high', description: 'Deep' },
          ],
          defaultReasoningEffort: 'medium', inputModalities: ['text'], supportsPersonality: true,
          additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null, isDefault: false,
        },
      ],
      nextCursor: null,
    };
    case 'skills/list': return { data: [{ cwd: '/tmp/project', skills: [], errors: [] }] };
    case 'permissionProfile/list': return {
      data: [
        { id: ':read-only', description: null, allowed: true },
        { id: ':workspace', description: null, allowed: true },
        { id: ':danger-full-access', description: null, allowed: true },
      ],
      nextCursor: null,
    };
    case 'configRequirements/read': return { requirements: null };
    case 'thread/list': return { data: [thread('thread-existing', false)], nextCursor: null };
    case 'thread/resume': return resumeResponse(thread(String((params as { threadId: string }).threadId), true));
    case 'thread/start': return resumeResponse(thread('thread-new', false));
    case 'turn/start': return { turn: turn('turn-live', 'inProgress', []) };
    case 'turn/steer': return { turnId: 'turn-live' };
    case 'turn/interrupt': return {};
    case 'thread/compact/start': return {};
    case 'review/start': return { turn: turn('turn-review', 'inProgress', []), reviewThreadId: 'thread-existing' };
    case 'thread/rollback': return { thread: thread('thread-existing', false) };
    default: return {};
  }
}

function thread(id: string, includeHistory: boolean): Record<string, unknown> {
  return {
    id,
    preview: id === 'thread-existing' ? 'Existing thread' : '',
    name: null,
    cwd: '/tmp/project',
    status: { type: 'idle' },
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_001,
    recencyAt: null,
    turns: includeHistory ? [turn('turn-history', 'completed', [
      { type: 'userMessage', id: 'user-history', clientId: null, content: [{ type: 'text', text: 'Hello', text_elements: [] }] },
      { type: 'agentMessage', id: 'agent-history', text: 'Hi there', phase: null, memoryCitation: null },
    ])] : [],
  };
}

function turn(id: string, status: string, items: unknown[]): Record<string, unknown> {
  return { id, status, items, startedAt: 1_700_000_000, completedAt: null, error: null };
}

function resumeResponse(value: Record<string, unknown>): Record<string, unknown> {
  return {
    thread: value,
    model: 'gpt-5',
    cwd: '/tmp/project',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: {
      type: 'workspaceWrite', writableRoots: ['/tmp/project'], networkAccess: false,
      excludeTmpdirEnvVar: false, excludeSlashTmp: false,
    },
    activePermissionProfile: { id: ':workspace', extends: null },
    reasoningEffort: 'medium',
  };
}

function testModel(id: string, model: string, isDefault: boolean): Record<string, unknown> {
  return {
    id,
    model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: id,
    description: 'Test model',
    hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
    defaultReasoningEffort: 'medium',
    inputModalities: ['text'],
    supportsPersonality: true,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault,
  };
}

function threadSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cwd: '/tmp/project',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxPolicy: {
      type: 'workspaceWrite', writableRoots: ['/tmp/project'], networkAccess: false,
      excludeTmpdirEnvVar: false, excludeSlashTmp: false,
    },
    activePermissionProfile: { id: ':workspace', extends: null },
    model: 'gpt-5',
    modelProvider: 'openai',
    serviceTier: null,
    effort: 'medium',
    summary: null,
    collaborationMode: {
      mode: 'default',
      settings: { model: 'gpt-5', reasoning_effort: 'medium', developer_instructions: null },
    },
    multiAgentMode: 'explicitRequestOnly',
    personality: null,
    ...overrides,
  };
}

function lastRequest(transport: FakeTransport, method: string): RpcMessage | undefined {
  for (let index = transport.sent.length - 1; index >= 0; index -= 1) {
    const message = transport.sent[index];
    if (message && 'method' in message && message.method === method) return message;
  }
  return undefined;
}

function lastResponse(transport: FakeTransport, id: string | number): RpcMessage | undefined {
  for (let index = transport.sent.length - 1; index >= 0; index -= 1) {
    const message = transport.sent[index];
    if (message && 'id' in message && message.id === id && !('method' in message)) return message;
  }
  return undefined;
}
