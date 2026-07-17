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

  send(message: RpcMessage): void {
    this.sent.push(message);
    if (!('id' in message) || !('method' in message)) return;
    const response = responseFor(message.method, 'params' in message ? message.params : undefined);
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
}

describe('CodexSurface', () => {
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

  it('rejects invalid sends and ignores interrupts without an active turn', async () => {
    const { surface } = createSurface();
    await surface.connect();
    await expect(surface.sendMessage('   ')).rejects.toThrow('empty message');
    await expect(surface.interrupt()).resolves.toMatchObject({ busy: false });
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
