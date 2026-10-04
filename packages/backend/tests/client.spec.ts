import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodexAppServerClient,
  isRecord,
  isRpcError,
  RpcRemoteError,
  RpcTransportProtocolError,
  type RpcMessage,
  type RpcTransport,
} from '../src/codex';

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

  get subscribed(): boolean {
    return this.messageListener !== null && this.errorListener !== null;
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
      name: 'RpcRemoteError',
      code: -32602,
      data: { field: 'cwd' },
      message: 'bad params',
    });
  });

  it('registers pending requests before synchronous responses and preserves them through late write failures', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();
    let writes = 0;
    vi.spyOn(transport, 'send').mockImplementation((message) => {
      transport.sent.push(message);
      if ('id' in message && 'method' in message) {
        transport.receive({ id: message.id, result: { requirements: null } });
      }
      writes += 1;
      if (writes === 2) throw new Error('late write failure');
    });

    await expect(client.request('configRequirements/read')).resolves.toStrictEqual({ requirements: null });
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
    vi.useFakeTimers();
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
    expect(vi.getTimerCount()).toBe(1);
    transport.receive({ id: 2, result: { requirements: null } });
    await expect(unaffected).resolves.toStrictEqual({ requirements: null });
    expect(vi.getTimerCount()).toBe(0);

    const uncorrelated = client.request('configRequirements/read');
    transport.fail(new RpcTransportProtocolError('uncorrelated malformed frame'));
    await expect(uncorrelated).rejects.toThrow('uncorrelated malformed frame');
    expect(vi.getTimerCount()).toBe(0);
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

  it('isolates throwing notification listeners from other listeners and pending requests', async () => {
    const transport = new FakeTransport();
    const onListenerError = vi.fn();
    const client = new CodexAppServerClient(transport, { onListenerError });
    const later = vi.fn();
    await client.start();
    client.onNotification(() => { throw new Error('first listener bug'); });
    client.onNotification('turn/started', () => { throw new Error('method listener bug'); });
    client.onNotification(later);
    const pending = client.request('thread/list', {});

    transport.receive({
      method: 'turn/started',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'inProgress', error: null } },
    });
    transport.receive({ id: 1, result: { data: [], nextCursor: null, backwardsCursor: null } });

    await expect(pending).resolves.toMatchObject({ data: [] });
    expect(later).toHaveBeenCalledOnce();
    expect(onListenerError.mock.calls.map(([error]) => (error as Error).message))
      .toStrictEqual(['first listener bug', 'method listener bug']);
  });

  it('handles typed server requests and prevents duplicate responses', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();
    client.onServerRequest('item/tool/requestUserInput', (_request, responder) => {
      responder.resolve({ answers: { framework: { answers: ['Vue'] } } });
      responder.resolve({ answers: { framework: { answers: ['ignored duplicate'] } } });
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
      responder.reject('ignored duplicate');
      return true;
    });

    transport.receive({ id: 'string-error', method: 'future/one' });
    transport.receive({ id: 'object-error', method: 'future/two' });

    await vi.waitFor(() => {
      expect(transport.sent).toContainEqual({ id: 'string-error', error: { code: -32603, message: 'denied' } });
      expect(transport.sent).toContainEqual({ id: 'object-error', error: { code: -32603, message: 'also denied' } });
    });
    expect(transport.sent).toHaveLength(2);
  });

  it('reports malformed messages and send failures at the abstraction boundary', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const onProtocolError = vi.fn();
    const client = new CodexAppServerClient(transport, { onProtocolError, requestTimeoutMs: 50 });
    await client.start();

    transport.receive('not an object');
    transport.receive({ result: true });
    transport.receive({ id: 99, error: { nope: true } });
    expect(onProtocolError).toHaveBeenCalledTimes(2);

    const malformed = client.request('configRequirements/read');
    transport.receive({ id: 1, error: { nope: true } });
    await expect(malformed).rejects.toThrow('Codex app-server returned a malformed error for configRequirements/read');

    const send = vi.spyOn(transport, 'send').mockImplementation(() => {
      throw 'write failed';
    });
    await expect(client.request('configRequirements/read')).rejects.toThrow('write failed');
    expect(vi.getTimerCount()).toBe(0);

    send.mockRestore();
    const successful = client.request('configRequirements/read');
    expect(vi.getTimerCount()).toBe(1);
    transport.receive({ id: 3, result: { requirements: null } });
    await successful;
    expect(vi.getTimerCount()).toBe(0);
    transport.receive({ id: 3, result: { requirements: 'late duplicate' } });
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

  it('fully detaches after a failed start and after close', async () => {
    const transport = new FakeTransport();
    const protocolErrors = vi.fn();
    transport.start.mockRejectedValueOnce(new Error('spawn failed'));
    const client = new CodexAppServerClient(transport, { onProtocolError: protocolErrors });

    await expect(client.start()).rejects.toThrow('spawn failed');
    expect(transport.subscribed).toBe(false);
    transport.receive('ignored after failure');
    await client.start();
    expect(transport.subscribed).toBe(true);
    expect(transport.start).toHaveBeenCalledTimes(2);
    await client.close();
    expect(transport.subscribed).toBe(false);
    transport.receive('ignored after close');

    expect(protocolErrors).not.toHaveBeenCalled();
  });

  it('retries initialization after a rejected handshake and notifies only on success', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();
    const params = {
      clientInfo: { name: 'test', title: 'Test', version: '1' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    };

    const failed = client.initialize(params);
    transport.receive({ id: 1, error: { code: -32000, message: 'not ready' } });
    await expect(failed).rejects.toThrow('not ready');
    const retry = client.initialize(params);
    transport.receive({
      id: 2,
      result: { userAgent: 'codex', codexHome: null, platformFamily: 'unix', platformOs: 'linux' },
    });
    await expect(retry).resolves.toMatchObject({ platformOs: 'linux' });

    expect(transport.sent).toStrictEqual([
      { id: 1, method: 'initialize', params },
      { id: 2, method: 'initialize', params },
      { method: 'initialized' },
    ]);
  });

  it('enforces start state and emits exact request and notification shapes', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    expect(() => client.notify('initialized')).toThrow('Codex app-server client is not started');
    await client.start();

    const noParams = client.request('configRequirements/read');
    client.notify('initialized');
    transport.receive({ id: 1, result: { requirements: null } });
    await noParams;

    expect(transport.sent).toStrictEqual([
      { id: 1, method: 'configRequirements/read' },
      { method: 'initialized' },
    ]);
  });

  it('preserves params when sending a parameter-bearing future notification', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();

    const notify = client.notify.bind(client) as unknown as (method: string, params: unknown) => void;
    notify('future/notification', { enabled: false });

    expect(transport.sent).toStrictEqual([
      { method: 'future/notification', params: { enabled: false } },
    ]);
  });

  it('honors disconnect unsubscription and isolates unknown correlated protocol errors', async () => {
    const transport = new FakeTransport();
    const disconnected = vi.fn();
    const client = new CodexAppServerClient(transport);
    const unsubscribe = client.onDisconnect(disconnected);
    await client.start();
    unsubscribe();
    const pending = client.request('configRequirements/read');

    transport.fail(new RpcTransportProtocolError('unknown response', { requestId: 999 }));
    transport.receive({ id: 1, result: { requirements: null } });
    await expect(pending).resolves.toStrictEqual({ requirements: null });
    transport.fail(new Error('disconnected'));

    expect(disconnected).not.toHaveBeenCalled();
    expect(transport.subscribed).toBe(false);
  });

  it('classifies zero and empty-string IDs without confusing responses, requests, or notifications', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    const notifications = vi.fn();
    const requests = vi.fn((_request, responder) => {
      responder.resolve({ time: 'now' });
      return true;
    });
    client.onNotification(notifications);
    client.onServerRequest('currentTime/read', requests);
    await client.start();

    transport.receive({ id: 0, method: 'currentTime/read' });
    transport.receive({ id: '', method: 'currentTime/read', params: undefined });
    transport.receive({ method: 'turn/started', params: { threadId: 't', turn: {} } });
    await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(2));

    expect(transport.sent).toContainEqual({ id: 0, result: { time: 'now' } });
    expect(transport.sent).toContainEqual({ id: '', result: { time: 'now' } });
    expect(requests.mock.calls[0]?.[0]).not.toHaveProperty('params');
    expect(requests.mock.calls[1]?.[0]).toHaveProperty('params', undefined);
    expect(notifications).toHaveBeenCalledOnce();
  });

  it('routes a method-bearing response as a server request and reports exact malformed messages', async () => {
    const transport = new FakeTransport();
    const protocolErrors = vi.fn();
    const client = new CodexAppServerClient(transport, { onProtocolError: protocolErrors });
    const handler = vi.fn((_request, responder) => {
      responder.reject({ code: -32001, message: 'method wins' });
      return true;
    });
    client.onAnyServerRequest(handler);
    await client.start();

    transport.receive({ id: 7, method: 'future/request', result: 'not a response' });
    transport.receive(null);
    transport.receive({ id: true, result: 'invalid' });
    transport.receive({ id: 8 });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());

    expect(transport.sent).toContainEqual({ id: 7, error: { code: -32001, message: 'method wins' } });
    expect(protocolErrors.mock.calls.map(([error]) => error.message)).toStrictEqual([
      'Codex app-server sent a non-object message',
      'Codex app-server sent an invalid RPC message',
      'Codex app-server sent an invalid RPC message',
    ]);
  });

  it('lets a response without an explicit claim stop later server-request handlers', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    const later = vi.fn();
    client.onAnyServerRequest((_request, responder) => {
      expect(responder.responded).toBe(false);
      responder.resolve({ accepted: true });
      expect(responder.responded).toBe(true);
    });
    client.onAnyServerRequest(later);
    await client.start();

    transport.receive({ id: 'claim', method: 'future/request' });
    await vi.waitFor(() => expect(transport.sent).toContainEqual({ id: 'claim', result: { accepted: true } }));

    expect(later).not.toHaveBeenCalled();
  });

  it('tolerates malformed inbound data when no protocol-error callback is configured', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    await client.start();

    expect(() => transport.receive(false)).not.toThrow();
    expect(() => transport.receive({ nope: true })).not.toThrow();
  });
});

describe('RPC wire guards', () => {
  it('rejects arrays, nulls, and malformed errors', () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRpcError('bad')).toBe(false);
    expect(isRpcError(null)).toBe(false);
    expect(isRpcError(Object.assign([], { code: -1, message: 'array error' }))).toBe(false);
    expect(isRpcError({ code: 'bad', message: 'error' })).toBe(false);
    expect(isRpcError({ code: -1, message: 42 })).toBe(false);
    expect(isRpcError({ code: -1, message: 'error' })).toBe(true);
  });
});
