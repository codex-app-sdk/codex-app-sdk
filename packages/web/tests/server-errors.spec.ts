import { describe, expect, it, vi } from 'vitest';
import { bindCodexWebSocket } from '../src';
import {
  ManualSocket,
  deferred,
  fakeSurface,
  nextTask,
  snapshot,
} from './web-test-helpers';

describe('Codex web server initialization and release', () => {
  it('rejects authorization callback failures and closes the socket', async () => {
    const socket = new ManualSocket();
    const binding = bindCodexWebSocket({
      socket,
      context: undefined,
      authorize: async () => { throw new Error('identity provider failed'); },
    });

    await expect(binding.ready).rejects.toThrow('identity provider failed');
    expect(socket.closes).toContainEqual({ code: 1011, reason: 'Codex web session initialization failed' });
  });

  it('releases a lease when surface initialization fails', async () => {
    const socket = new ManualSocket();
    const surface = fakeSurface();
    const release = vi.fn();
    surface.connect.mockRejectedValueOnce(new Error('app-server unavailable'));
    const binding = bindCodexWebSocket({
      socket,
      context: undefined,
      authorize: () => ({ surface: surface.target, release }),
    });

    await expect(binding.ready).rejects.toThrow('app-server unavailable');
    expect(release).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'surface_failed',
      error: expect.any(Error),
    }));
  });

  it('rejects requests received before authorization completes', async () => {
    const socket = new ManualSocket();
    const surface = fakeSurface();
    const release = vi.fn();
    const authorization = deferred<{ surface: typeof surface.target; release: typeof release }>();
    const binding = bindCodexWebSocket({
      socket,
      context: undefined,
      authorize: () => authorization.promise,
    });
    socket.emitMessage(validRequest());
    authorization.resolve({ surface: surface.target, release });

    await binding.ready;
    expect(socket.closes).toContainEqual({ code: 4400, reason: 'Request received before the session was ready' });
    expect(release).toHaveBeenCalledWith({ reason: 'socket_closed' });
    expect(surface.connect).not.toHaveBeenCalled();
  });

  it('supports explicit server close and releases once', async () => {
    const socket = new ManualSocket();
    const surface = fakeSurface();
    const release = vi.fn();
    const binding = bindCodexWebSocket({
      socket,
      context: undefined,
      authorize: () => ({ surface: surface.target, release }),
    });
    await binding.ready;

    await binding.close(1001, 'deploy');
    await binding.close(1000, 'duplicate');
    expect(socket.closes).toStrictEqual([{ code: 1001, reason: 'deploy' }]);
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith({
      reason: 'server_closed',
      close: { code: 1001, reason: 'deploy', wasClean: true },
    });
  });

  it('uses default server close metadata', async () => {
    const socket = new ManualSocket();
    const surface = fakeSurface();
    const binding = bindCodexWebSocket({
      socket,
      context: undefined,
      authorize: () => ({ surface: surface.target }),
    });
    await binding.ready;
    await binding.close();
    expect(socket.closes).toContainEqual({ code: 1000, reason: 'Codex web session closed' });
  });

  it('releases the lease after socket errors', async () => {
    const socket = new ManualSocket();
    const surface = fakeSurface();
    const release = vi.fn();
    const binding = bindCodexWebSocket({
      socket,
      context: undefined,
      authorize: () => ({ surface: surface.target, release }),
    });
    await binding.ready;
    socket.emitError('connection reset');
    await nextTask();
    expect(release).toHaveBeenCalledWith({ reason: 'socket_closed', error: 'connection reset' });
  });
});

describe('Codex web server request validation', () => {
  it.each([
    ['null', 'non-object'],
    [JSON.stringify({ version: 1, type: 'request', id: 'id', operation: 'refreshAccount', args: [], extra: true }), 'extra key'],
    [JSON.stringify({ version: 2, type: 'request', id: 'id', operation: 'refreshAccount', args: [] }), 'version'],
    [JSON.stringify({ version: 1, type: 'other', id: 'id', operation: 'refreshAccount', args: [] }), 'type'],
    [JSON.stringify({ version: 1, type: 'request', id: '', operation: 'refreshAccount', args: [] }), 'blank id'],
    [JSON.stringify({ version: 1, type: 'request', id: 'x'.repeat(129), operation: 'refreshAccount', args: [] }), 'long id'],
    [JSON.stringify({ version: 1, type: 'request', id: 'id', operation: 'missing', args: [] }), 'operation'],
    [JSON.stringify({ version: 1, type: 'request', id: 'id', operation: 'refreshAccount', args: {} }), 'args'],
    [new Uint8Array(2_001), 'oversized binary'],
  ])('closes malformed requests: %s', async (frame, _label) => {
    const socket = new ManualSocket();
    const surface = fakeSurface();
    const binding = bindCodexWebSocket({
      socket,
      context: undefined,
      maxMessageBytes: 2_000,
      authorize: () => ({ surface: surface.target }),
    });
    await binding.ready;
    socket.emitMessage(frame);
    await nextTask();
    expect(socket.closes.at(-1)).toEqual({ code: 4400, reason: 'Invalid Codex WebSocket request' });
  });

  it('returns invalid_request for bridge validation failures', async () => {
    const { socket } = await readyBinding();
    socket.emitMessage(validRequest({ args: ['unexpected'] }));
    await nextTask();
    expect(lastServerMessage(socket)).toMatchObject({
      type: 'response',
      id: 'request-1',
      ok: false,
      error: { code: 'invalid_request' },
    });
  });

  it('returns operation_failed and bounds host error messages', async () => {
    const surface = fakeSurface();
    surface.refreshAccount.mockRejectedValueOnce('x'.repeat(3_000));
    const { socket } = await readyBinding(surface);
    socket.emitMessage(validRequest());
    await nextTask();
    const response = lastServerMessage(socket) as { error: { code: string; message: string } };
    expect(response.error.code).toBe('operation_failed');
    expect(response.error.message).toHaveLength(2_000);
  });
});

describe('Codex web server response failures', () => {
  it('closes and releases when a response exceeds the configured limit', async () => {
    const socket = new ManualSocket();
    const surface = fakeSurface();
    const release = vi.fn();
    surface.refreshAccount.mockResolvedValueOnce('x'.repeat(4_000) as never);
    const binding = bindCodexWebSocket({
      socket,
      context: undefined,
      maxMessageBytes: 2_000,
      authorize: () => ({ surface: surface.target, release }),
    });
    await binding.ready;
    socket.emitMessage(validRequest());
    await nextTask();
    expect(socket.closes.at(-1)).toEqual({ code: 1011, reason: 'Codex WebSocket response failed' });
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ reason: 'socket_closed' }));
  });

  it('closes and releases when the socket send method throws', async () => {
    const socket = new ManualSocket();
    const surface = fakeSurface();
    const release = vi.fn();
    const binding = bindCodexWebSocket({
      socket,
      context: undefined,
      authorize: () => ({ surface: surface.target, release }),
    });
    await binding.ready;
    socket.sendError = new Error('write failed');
    socket.emitMessage(validRequest());
    await nextTask();
    expect(socket.closes.at(-1)).toEqual({ code: 1011, reason: 'Codex WebSocket response failed' });
    expect(release).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'socket_closed',
      error: expect.any(Error),
    }));
  });

  it('does not emit state or event messages after closure', async () => {
    const surface = fakeSurface();
    const { binding, socket } = await readyBinding(surface);
    await binding.close();
    const sentCount = socket.sent.length;
    surface.emitState({ ...snapshot, busy: true });
    surface.emitEvent({
      seq: 2,
      occurredAt: '2026-08-07T10:00:00.000Z',
      origin: 'lifecycle',
      type: 'surface.statusChanged',
      payload: { status: 'ready', error: null },
    });
    expect(socket.sent).toHaveLength(sentCount);
  });
});

function validRequest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    type: 'request',
    id: 'request-1',
    operation: 'refreshAccount',
    args: [],
    ...overrides,
  });
}

function lastServerMessage(socket: ManualSocket): unknown {
  return JSON.parse(socket.sent.at(-1)!);
}

async function readyBinding(surface = fakeSurface()) {
  const socket = new ManualSocket();
  const binding = bindCodexWebSocket({
    socket,
    context: undefined,
    authorize: () => ({ surface: surface.target }),
  });
  await binding.ready;
  return { binding, socket, surface };
}
