import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodexAppServerClient,
  isRecord,
  isRpcError,
  RpcRemoteError,
  RpcTransportProtocolError,
  type RpcMessage,
  type RpcTransport,
} from '../packages/backend/src/codex';

class FakeTransport implements RpcTransport {
  readonly sent: RpcMessage[] = [];
  readonly start = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  private messageListener: ((message: unknown) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;

  send(message: RpcMessage): void {
    this.sent.push(message);
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.messageListener = listener;
    return () => {
      this.messageListener = null;
    };
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListener = listener;
    return () => {
      this.errorListener = null;
    };
  }

  receive(message: unknown): void {
    this.messageListener?.(message);
  }

  fail(error: Error): void {
    this.errorListener?.(error);
  }
}

describe('CodexAppServerClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('performs the required initialize handshake once', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();

    const params = {
      clientInfo: { name: 'test_surface', title: 'Test Surface', version: '1.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    };
    const first = client.initialize(params);
    const second = client.initialize(params);
    transport.receive({
      id: 1,
      result: {
        userAgent: 'codex',
        codexHome: '/tmp/codex',
        platformFamily: 'unix',
        platformOs: 'macos',
      },
    });

    await expect(first).resolves.toMatchObject({ userAgent: 'codex' });
    await expect(second).resolves.toMatchObject({ platformOs: 'macos' });
    expect(transport.sent).toStrictEqual([
      { id: 1, method: 'initialize', params },
      { method: 'initialized' },
    ]);
  });

  it('cleans subscriptions after start failures and permits retry', async () => {
    const transport = new FakeTransport();
    transport.start.mockRejectedValueOnce(new Error('spawn failed'));
    const client = new CodexAppServerClient(transport);

    await expect(client.start()).rejects.toThrow('spawn failed');
    await client.start();

    expect(transport.start).toHaveBeenCalledTimes(2);
  });

  it('matches typed responses and preserves remote error details', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();

    const models = client.request('model/list', { cursor: null, limit: null, includeHidden: false });
    const failed = client.request('configRequirements/read');
    transport.receive({ id: 1, result: { data: [], nextCursor: null } });
    transport.receive({ id: 2, error: { code: -32602, message: 'bad params', data: { field: 'cwd' } } });

    await expect(models).resolves.toStrictEqual({ data: [], nextCursor: null });
    const remoteError = await failed.catch((error: unknown) => error);
    expect(remoteError).toBeInstanceOf(RpcRemoteError);
    expect(remoteError).toMatchObject({
      code: -32602,
      data: { field: 'cwd' },
      message: 'bad params',
    });
  });

  it('registers pending requests before sending to synchronous transports', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();
    vi.spyOn(transport, 'send').mockImplementation((message) => {
      transport.sent.push(message);
      if ('id' in message && 'method' in message) {
        transport.receive({ id: message.id, result: { requirements: null } });
      }
    });

    await expect(client.request('configRequirements/read')).resolves.toStrictEqual({ requirements: null });
  });

  it('times out unanswered requests and rejects pending work on transport errors', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport, { requestTimeoutMs: 25 });
    await client.start();

    const timedOut = client.request('configRequirements/read');
    const timeoutExpectation = expect(timedOut).rejects.toThrow('Codex app-server request timed out: configRequirements/read');
    await vi.advanceTimersByTimeAsync(25);
    await timeoutExpectation;

    const disconnected = client.request('configRequirements/read');
    const onDisconnect = vi.fn();
    client.onDisconnect(onDisconnect);
    transport.fail(new Error('transport closed'));
    await expect(disconnected).rejects.toThrow('transport closed');
    expect(onDisconnect).toHaveBeenCalledWith(expect.objectContaining({ message: 'transport closed' }));

    await client.start();
    expect(transport.start).toHaveBeenCalledTimes(2);
  });

  it('reports malformed frames without disconnecting a healthy transport', async () => {
    const transport = new FakeTransport();
    const onProtocolError = vi.fn();
    const onDisconnect = vi.fn();
    const client = new CodexAppServerClient(transport, { onProtocolError });
    client.onDisconnect(onDisconnect);
    await client.start();

    const affected = client.request('configRequirements/read');
    const unaffected = client.request('configRequirements/read');
    transport.fail(new RpcTransportProtocolError('malformed frame', { requestId: 1 }));
    await expect(affected).rejects.toThrow('malformed frame');
    transport.receive({ id: 2, result: { requirements: null } });
    await expect(unaffected).resolves.toStrictEqual({ requirements: null });

    const uncorrelated = client.request('configRequirements/read');
    transport.fail(new RpcTransportProtocolError('uncorrelated malformed frame'));
    await expect(uncorrelated).rejects.toThrow('uncorrelated malformed frame');
    await client.start();

    expect(onProtocolError).toHaveBeenCalledTimes(2);
    expect(onProtocolError).toHaveBeenCalledWith(expect.objectContaining({ message: 'malformed frame', requestId: 1 }));
    expect(onDisconnect).not.toHaveBeenCalled();
    expect(transport.start).toHaveBeenCalledOnce();
  });

  it('routes all and method-specific notifications with unsubscribe cleanup', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    const all = vi.fn();
    const turns = vi.fn();
    await client.start();
    const unsubscribeAll = client.onNotification(all);
    const unsubscribeTurns = client.onNotification('turn/started', turns);

    const notification = {
      method: 'turn/started',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'inProgress', error: null } },
    } as const;
    transport.receive(notification);
    unsubscribeAll();
    unsubscribeTurns();
    transport.receive(notification);

    expect(all).toHaveBeenCalledOnce();
    expect(turns).toHaveBeenCalledOnce();
    expect(turns).toHaveBeenCalledWith(notification);
  });

  it('handles typed server requests and prevents duplicate responses', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();
    client.onServerRequest('item/tool/requestUserInput', (_request, responder) => {
      responder.resolve({ answers: { framework: { answers: ['Vue'] } } });
      responder.reject('too late');
      return true;
    });

    transport.receive({
      id: 'request-1',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        questions: [],
      },
    });
    await vi.waitFor(() => {
      expect(transport.sent).toStrictEqual([
        { id: 'request-1', result: { answers: { framework: { answers: ['Vue'] } } } },
      ]);
    });
  });

  it('rejects unhandled and failed server requests without hanging the turn', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport, {
      unhandledServerRequestError: (request) => ({ code: -32000, message: `Unsupported ${request.method}` }),
    });
    await client.start();

    transport.receive({ id: 'unknown-1', method: 'future/request', params: {} });
    await vi.waitFor(() => {
      expect(transport.sent).toContainEqual({
        id: 'unknown-1',
        error: { code: -32000, message: 'Unsupported future/request' },
      });
    });

    client.onAnyServerRequest(() => {
      throw new Error('handler failed');
    });
    transport.receive({ id: 'failed-1', method: 'item/tool/call', params: {} });
    await vi.waitFor(() => {
      expect(transport.sent).toContainEqual({
        id: 'failed-1',
        error: { code: -32603, message: 'handler failed' },
      });
    });
  });

  it('uses the standard method-not-found response and supports handler cleanup', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();
    const exactHandler = vi.fn(() => false);
    const anyHandler = vi.fn(() => false);
    const removeExact = client.onServerRequest('currentTime/read', exactHandler);
    const removeAny = client.onAnyServerRequest(anyHandler);

    transport.receive({ id: 'first', method: 'currentTime/read', params: {} });
    await vi.waitFor(() => expect(anyHandler).toHaveBeenCalledOnce());
    removeExact();
    removeAny();
    transport.receive({ id: 'second', method: 'currentTime/read', params: {} });

    await vi.waitFor(() => {
      expect(transport.sent).toContainEqual({
        id: 'second',
        error: { code: -32601, message: 'Codex app-server request is not implemented: currentTime/read' },
      });
    });
    expect(exactHandler).toHaveBeenCalledOnce();
    expect(anyHandler).toHaveBeenCalledOnce();
  });

  it('normalizes string and Error server-request rejections', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();
    let requestCount = 0;
    client.onAnyServerRequest((_request, responder) => {
      requestCount += 1;
      responder.reject(requestCount === 1 ? 'denied' : new Error('also denied'));
      return true;
    });

    transport.receive({ id: 'string-error', method: 'future/one' });
    transport.receive({ id: 'object-error', method: 'future/two' });

    await vi.waitFor(() => {
      expect(transport.sent).toContainEqual({ id: 'string-error', error: { code: -32603, message: 'denied' } });
      expect(transport.sent).toContainEqual({ id: 'object-error', error: { code: -32603, message: 'also denied' } });
    });
  });

  it('reports malformed messages and send failures at the abstraction boundary', async () => {
    const transport = new FakeTransport();
    const onProtocolError = vi.fn();
    const client = new CodexAppServerClient(transport, { onProtocolError });
    await client.start();

    transport.receive('not an object');
    transport.receive({ result: true });
    transport.receive({ id: 99, error: { nope: true } });
    expect(onProtocolError).toHaveBeenCalledTimes(2);

    const malformed = client.request('configRequirements/read');
    transport.receive({ id: 1, error: { nope: true } });
    await expect(malformed).rejects.toThrow('Codex app-server returned a malformed error for configRequirements/read');

    vi.spyOn(transport, 'send').mockImplementation(() => {
      throw 'write failed';
    });
    await expect(client.request('configRequirements/read')).rejects.toThrow('write failed');
  });

  it('cleans up subscriptions and pending work when closed', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();
    await client.start();
    const pending = client.request('configRequirements/read');

    await client.close();

    await expect(pending).rejects.toThrow('Codex app-server connection closed');
    expect(transport.start).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(() => client.request('configRequirements/read')).toThrow('Codex app-server client is not started');
  });
});

describe('RPC wire guards', () => {
  it('rejects arrays, nulls, and malformed errors', () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRpcError('bad')).toBe(false);
    expect(isRpcError({ code: 'bad', message: 'error' })).toBe(false);
    expect(isRpcError({ code: -1, message: 'error' })).toBe(true);
  });
});
