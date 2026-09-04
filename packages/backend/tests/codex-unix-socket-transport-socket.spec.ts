import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createConnection: vi.fn(),
  homedir: vi.fn(() => '/mock-home'),
}));

vi.mock('node:net', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:net')>(),
  createConnection: mocks.createConnection,
}));

vi.mock('node:os', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: mocks.homedir,
}));

import { CodexAppServerUnixSocketTransport } from '../src/node/codex-unix-socket-transport';

describe('CodexAppServerUnixSocketTransport socket lifecycle', () => {
  const previousCodexHome = process.env.CODEX_HOME;

  beforeEach(() => {
    mocks.createConnection.mockReset();
    mocks.homedir.mockClear();
    delete process.env.CODEX_HOME;
  });

  afterEach(() => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  });

  it('uses the OS home fallback and preserves the original connection failure', async () => {
    const socket = new FakeSocket();
    mocks.createConnection.mockReturnValue(socket as unknown as Socket);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket' });
    const failure = new Error('controlled connection failure');

    const starting = transport.start();
    expect(mocks.homedir).toHaveBeenCalledOnce();
    expect(mocks.createConnection).toHaveBeenCalledWith('/mock-home/.codex/app-server-control/app-server-control.sock');
    expect(() => socket.emit('error', failure)).not.toThrow();

    await expect(starting).rejects.toBe(failure);
    expect(socket.destroyed).toBe(true);
  });

  it('removes every upgrade listener before installing the live socket handlers', async () => {
    const { socket, transport } = await upgradedTransport();

    expect(socket.listenerCount('connect')).toBe(0);
    expect(socket.listenerCount('data')).toBe(1);
    expect(socket.listenerCount('error')).toBe(1);
    expect(socket.listenerCount('close')).toBe(1);

    socket.emit('connect');
    expect(socket.writes).toHaveLength(1);
    await transport.close();
  });

  it('waits for the complete HTTP header boundary before validating the upgrade', async () => {
    const socket = new FakeSocket();
    mocks.createConnection.mockReturnValue(socket as unknown as Socket);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath: '/mock.sock' });
    const starting = transport.start();
    socket.emit('connect');

    socket.emit('data', Buffer.from('HTTP/1.'));
    expect(socket.destroyed).toBe(false);
    socket.emit('data', Buffer.from('1 101 Switching Protocols\r\n\r\n'));

    await starting;
    await transport.close();
  });

  it('forwards live socket errors exactly once and suppresses errors after close', async () => {
    const { socket, transport } = await upgradedTransport();
    const errors: Error[] = [];
    transport.onError((error) => errors.push(error));
    const failure = new Error('live socket failure');

    expect(() => socket.emit('error', failure)).not.toThrow();
    expect(errors).toStrictEqual([failure]);
    expect(socket.destroyed).toBe(false);

    await transport.close();
    socket.emit('error', new Error('expected after close'));
    expect(errors).toStrictEqual([failure]);
  });

  it('does not write close or ping frames to a socket already known to be destroyed', async () => {
    const { socket, transport } = await upgradedTransport();
    const handshakeWrites = socket.writes.length;
    socket.destroyed = true;

    socket.emit('data', serverFrame(0x9, Buffer.from('ping')));
    expect(socket.writes).toHaveLength(handshakeWrites);

    await transport.close();
    expect(socket.writes).toHaveLength(handshakeWrites);
    expect(socket.endCalls).toBe(0);
  });

  it('waits for a complete extended header before parsing a zero-length frame', async () => {
    const { socket, transport } = await upgradedTransport();
    const errors: Error[] = [];
    transport.onError((error) => errors.push(error));
    const nonCanonicalEmptyFrame = Buffer.from([0x81, 126, 0, 0]);

    socket.emit('data', nonCanonicalEmptyFrame.subarray(0, 2));
    expect(errors).toStrictEqual([]);
    socket.emit('data', nonCanonicalEmptyFrame.subarray(2));
    expect(errors.map((error) => error.message)).toStrictEqual([
      'Codex app-server sent malformed JSON',
    ]);
    await transport.close();
  });

  it('waits for a masked frame mask and payload before decoding it', async () => {
    const { socket, transport } = await upgradedTransport();
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.onMessage((message) => messages.push(message));
    transport.onError((error) => errors.push(error));
    const frame = serverFrame(0x1, Buffer.from('{"masked":true}'), true);

    socket.emit('data', frame.subarray(0, frame.length - 3));
    expect(messages).toStrictEqual([]);
    expect(errors).toStrictEqual([]);
    socket.emit('data', frame.subarray(frame.length - 3));
    expect(messages).toStrictEqual([{ masked: true }]);
    expect(errors).toStrictEqual([]);
    await transport.close();
  });
});

class FakeSocket extends EventEmitter {
  destroyed = false;
  endCalls = 0;
  readonly writes: Buffer[] = [];

  write(data: string | Uint8Array): boolean {
    this.writes.push(Buffer.from(data));
    return true;
  }

  destroy(): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.emit('close');
    return this;
  }

  end(): this {
    this.endCalls += 1;
    this.destroy();
    return this;
  }
}

async function upgradedTransport(): Promise<{
  socket: FakeSocket;
  transport: CodexAppServerUnixSocketTransport;
}> {
  const socket = new FakeSocket();
  mocks.createConnection.mockReturnValue(socket as unknown as Socket);
  const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath: '/mock.sock' });
  const starting = transport.start();
  socket.emit('connect');
  socket.emit('data', Buffer.from('HTTP/1.1 101 Switching Protocols\r\n\r\n'));
  await starting;
  return { socket, transport };
}

function serverFrame(opcode: number, payload: Buffer, masked = false): Buffer {
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const maskBit = masked ? 0x80 : 0;
  const header = Buffer.from([0x80 | opcode, maskBit | payload.length]);
  if (!masked) return Buffer.concat([header, payload]);
  const encoded = Buffer.from(payload);
  for (let index = 0; index < encoded.length; index += 1) {
    encoded[index] = (encoded[index] ?? 0) ^ (mask[index % 4] ?? 0);
  }
  return Buffer.concat([header, mask, encoded]);
}
