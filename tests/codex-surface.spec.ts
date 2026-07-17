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
    const response = this.responses[message.method]?.(params) ?? responseFor(message.method, params);
    queueMicrotask(() => this.emit({ id: message.id, result: response }));
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
      activeConversationId: null,
      conversations: [{
        id: 'thread-existing',
        title: 'Existing thread',
        preview: 'Existing thread',
        cwd: '/tmp/project',
      }],
    });
    expect(transport.sent.map((message) => 'method' in message ? message.method : null)).toStrictEqual([
      'initialize', 'initialized', 'thread/list',
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
    const turnRequest = lastRequest(transport, 'turn/start');
    expect(turnRequest).toMatchObject({
      method: 'turn/start',
      params: { threadId: 'thread-existing', input: [{ type: 'text', text: 'Build the UI' }] },
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
    expect(snapshot.messages.find((message) => message.id === 'assistant-agent-live')).toMatchObject({
      id: 'assistant-agent-live',
      role: 'assistant',
      status: 'complete',
      parts: [{ type: 'text', text: 'Working… done' }],
    });
  });

  it('creates conversations with safe SDK defaults and interrupts active turns', async () => {
    const { surface, transport } = createSurface();
    await surface.connect();
    await surface.createConversation();
    const startRequest = transport.sent.find((message) => 'method' in message && message.method === 'thread/start');
    expect(startRequest).toMatchObject({
      method: 'thread/start',
      params: { approvalPolicy: 'never', cwd: '/tmp/project', sandbox: 'read-only' },
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

  it('maps product options, creates on first send, and guards concurrent turns', async () => {
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
    await expect(surface.sendMessage('Second')).rejects.toThrow('already responding');

    const fresh = createSurface();
    await fresh.surface.sendMessage('Create automatically');
    expect(lastRequest(fresh.transport, 'thread/start')).toBeDefined();
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
    expect(snapshot.messages.find((message) => message.id === 'assistant-command')).toMatchObject({
      id: 'assistant-command',
      parts: [{ type: 'tool', status: 'failed', body: 'failed' }],
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
    expect(snapshot.messages.filter((message) => message.id === 'user-user-variant')).toHaveLength(1);
    expect(snapshot.messages.find((message) => message.id === 'assistant-command-variant')).toMatchObject({
      parts: [{ status: 'completed' }], status: 'error',
    });
    expect(snapshot).toMatchObject({ busy: false, error: 'Failed turn' });
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
    case 'thread/list': return { data: [thread('thread-existing', false)], nextCursor: null };
    case 'thread/resume': return resumeResponse(thread(String((params as { threadId: string }).threadId), true));
    case 'thread/start': return resumeResponse(thread('thread-new', false));
    case 'turn/start': return { turn: turn('turn-live', 'inProgress', []) };
    case 'turn/interrupt': return {};
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
  return { thread: value, model: 'gpt-5', cwd: '/tmp/project' };
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
