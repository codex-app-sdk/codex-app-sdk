import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodexWebSocketTransportError,
  createCodexWebSurfaceClient,
} from '../src';
import {
  ManualSocket,
  deferred,
  nextTask,
  readyMessage,
  requestId,
  snapshot,
} from './web-test-helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('Codex web client validation', () => {
  it.each([
    [{ maxMessageBytes: 0 }, 'Codex WebSocket message byte limit must be a positive integer'],
    [{ requestTimeoutMs: -1 }, 'Codex WebSocket request timeout must be a positive integer'],
    [{ reconnect: { maxAttempts: -1 } }, 'Reconnect maximum attempts must be a non-negative integer'],
    [{ reconnect: { maxAttempts: 1.5 } }, 'Reconnect maximum attempts must be a non-negative integer'],
    [{ reconnect: { initialDelayMs: 0 } }, 'Reconnect initial delay must be a positive integer'],
    [{ reconnect: { maximumDelayMs: Number.POSITIVE_INFINITY } }, 'Reconnect maximum delay must be a positive integer'],
  ] as const)('rejects invalid client options', (invalid, message) => {
    expect(() => createCodexWebSurfaceClient({
      createSocket: () => new ManualSocket(),
      ...invalid,
    })).toThrow(message);
  });

  it.each([
    ['not-json'],
    [JSON.stringify([])],
    [JSON.stringify({ version: 2, type: 'ready', snapshot })],
    [JSON.stringify({ version: 1, type: 'ready', snapshot: null })],
    [new Uint8Array(20)],
  ])('rejects malformed server frames', async (frame) => {
    const socket = new ManualSocket();
    const client = createCodexWebSurfaceClient({
      createSocket: () => socket,
      maxMessageBytes: 10,
    });
    const connecting = client.connect();
    await nextTask();
    socket.emitMessage(frame);

    await expect(connecting).rejects.toBeInstanceOf(CodexWebSocketTransportError);
    expect(socket.closes.at(-1)).toEqual(expect.objectContaining({ code: 4400 }));
    expect(client.getConnectionState()).toBe('disconnected');
  });

  it('reports socket creation failures as transport errors', async () => {
    const client = createCodexWebSurfaceClient({
      createSocket: async () => { throw 'offline'; },
    });

    await expect(client.connect()).rejects.toMatchObject({
      name: 'CodexWebSocketTransportError',
      message: 'offline',
    });
    expect(client.getConnectionState()).toBe('disconnected');
  });
});

describe('Codex web client responses and lifecycle', () => {
  it('returns the cached snapshot and supports listener removal', async () => {
    const socket = new ManualSocket();
    const client = createCodexWebSurfaceClient({ createSocket: () => socket });
    const stateListener = vi.fn();
    const eventListener = vi.fn();
    const offState = client.onStateChange(stateListener);
    const offEvent = client.onEvent(eventListener);
    const firstConnect = client.connect();
    const duplicateConnect = client.connect();
    expect(duplicateConnect).toBe(firstConnect);
    await nextTask();
    socket.emitMessage(readyMessage());
    await expect(firstConnect).resolves.toStrictEqual(snapshot);
    await expect(client.connect()).resolves.toStrictEqual(snapshot);

    offState();
    offEvent();
    socket.emitMessage(JSON.stringify({ version: 1, type: 'snapshot', snapshot: { ...snapshot, busy: true } }));
    socket.emitMessage(JSON.stringify({ version: 1, type: 'event', event: { type: 'test' } }));
    expect(stateListener).toHaveBeenCalledOnce();
    expect(eventListener).not.toHaveBeenCalled();
  });

  it('resolves successes and exposes valid remote failures', async () => {
    const { client, socket } = await connectedClient();
    const success = client.refreshAccount();
    await nextTask();
    socket.emitMessage(JSON.stringify({
      version: 1, type: 'response', id: requestId(socket), ok: true, result: { ...snapshot, busy: true },
    }));
    await expect(success).resolves.toEqual({ ...snapshot, busy: true });

    const failure = client.refreshAccount();
    await nextTask();
    socket.emitMessage(JSON.stringify({
      version: 1,
      type: 'response',
      id: requestId(socket),
      ok: false,
      error: { code: 'operation_failed', message: 'surface exploded' },
    }));
    await expect(failure).rejects.toMatchObject({
      name: 'CodexWebSocketRemoteError',
      code: 'operation_failed',
      message: 'surface exploded',
    });
  });

  it('rejects invalid remote errors and ignores unknown response ids', async () => {
    const { client, socket } = await connectedClient();
    socket.emitMessage(JSON.stringify({ version: 1, type: 'response', id: 'missing', ok: true, result: snapshot }));
    const result = client.refreshAccount();
    await nextTask();
    socket.emitMessage(JSON.stringify({
      version: 1, type: 'response', id: requestId(socket), ok: false, error: { code: 'unknown', message: 'bad' },
    }));
    await expect(result).rejects.toThrow('Codex WebSocket returned an invalid error');
  });

  it('closes an otherwise valid but unknown server message', async () => {
    const { client, socket } = await connectedClient();
    socket.emitMessage(JSON.stringify({ version: 1, type: 'unknown' }));
    expect(socket.closes.at(-1)).toEqual({ code: 4400, reason: 'Invalid Codex WebSocket response' });
    expect(client.getConnectionState()).toBe('disconnected');
  });

  it('rejects requests when sending fails', async () => {
    const { client, socket } = await connectedClient();
    socket.sendError = new Error('write failed');
    await expect(client.refreshAccount()).rejects.toMatchObject({
      name: 'CodexWebSocketTransportError',
      message: 'write failed',
    });
  });

  it('times out unanswered requests', async () => {
    vi.useFakeTimers();
    const socket = new ManualSocket();
    const client = createCodexWebSurfaceClient({ createSocket: () => socket, requestTimeoutMs: 10 });
    const connecting = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    socket.emitMessage(readyMessage());
    await connecting;
    const result = client.refreshAccount();
    const timedOut = expect(result).rejects.toMatchObject({
      name: 'CodexWebSocketRemoteError',
      code: 'request_timeout',
    });
    await vi.advanceTimersByTimeAsync(11);
    await timedOut;
  });

  it('trims trailing undefined arguments from requests', async () => {
    const { client, socket } = await connectedClient();
    const result = client.steerMessage('continue', undefined);
    await nextTask();
    const request = JSON.parse(socket.sent.at(-1)!) as { args: unknown[]; id: string };
    expect(request.args).toStrictEqual(['continue']);
    socket.emitMessage(JSON.stringify({ version: 1, type: 'response', id: request.id, ok: true, result: snapshot }));
    await result;
  });

  it('rejects pending work with close codes when no reason is supplied', async () => {
    const { client, socket } = await connectedClient();
    const result = client.refreshAccount();
    await nextTask();
    socket.emitClose({ code: 1012 });
    await expect(result).rejects.toThrow('Codex WebSocket closed (1012)');
    expect(client.getConnectionState()).toBe('disconnected');
  });

  it('closes a socket that arrives after manual disconnection', async () => {
    const socketResult = deferred<ManualSocket>();
    const client = createCodexWebSurfaceClient({ createSocket: () => socketResult.promise });
    const connecting = client.connect();
    client.disconnect(1000, 'closed early');
    const socket = new ManualSocket();
    socketResult.resolve(socket);

    await expect(connecting).rejects.toThrow('Codex web client is closed');
    expect(socket.closes).toContainEqual({ code: 1000, reason: 'Codex web client is closed' });
    expect(client.getConnectionState()).toBe('closed');
  });

  it('uses the default disconnect metadata', async () => {
    const { client, socket } = await connectedClient();
    client.disconnect();
    expect(socket.closes).toContainEqual({ code: 1000, reason: 'Codex web client disconnected' });
    expect(client.getConnectionState()).toBe('closed');
  });
});

describe('Codex web client reconnect policy', () => {
  it('recovers from socket factory failures with default reconnect options', async () => {
    vi.useFakeTimers();
    const socket = new ManualSocket();
    const createSocket = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(socket);
    const client = createCodexWebSurfaceClient({ createSocket, reconnect: true });
    await expect(client.connect()).rejects.toThrow('offline');

    await vi.advanceTimersByTimeAsync(250);
    socket.emitMessage(readyMessage());
    await vi.waitFor(() => expect(client.getConnectionState()).toBe('ready'));
    expect(createSocket).toHaveBeenCalledTimes(2);
  });

  it.each([1000, 4401])('does not reconnect after close code %s', async (code) => {
    vi.useFakeTimers();
    const socket = new ManualSocket();
    const createSocket = vi.fn(() => socket);
    const client = createCodexWebSurfaceClient({
      createSocket,
      reconnect: { initialDelayMs: 1, maximumDelayMs: 1, maxAttempts: 2 },
    });
    const connecting = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    socket.emitMessage(readyMessage());
    await connecting;
    socket.emitClose({ code });
    await vi.advanceTimersByTimeAsync(10);
    expect(createSocket).toHaveBeenCalledOnce();
  });

  it('reconnects after a socket error and stops at the configured attempt limit', async () => {
    vi.useFakeTimers();
    const first = new ManualSocket();
    const createSocket = vi.fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValue(new Error('still offline'));
    const client = createCodexWebSurfaceClient({
      createSocket,
      reconnect: { initialDelayMs: 1, maximumDelayMs: 2, maxAttempts: 2 },
    });
    const connecting = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    first.emitMessage(readyMessage());
    await connecting;
    first.emitError('network lost');
    await vi.advanceTimersByTimeAsync(20);
    expect(createSocket).toHaveBeenCalledTimes(3);
    expect(client.getConnectionState()).toBe('disconnected');
  });
});

async function connectedClient() {
  const socket = new ManualSocket();
  const client = createCodexWebSurfaceClient({ createSocket: () => socket });
  const connecting = client.connect();
  await nextTask();
  socket.emitMessage(readyMessage());
  await connecting;
  return { client, socket };
}
