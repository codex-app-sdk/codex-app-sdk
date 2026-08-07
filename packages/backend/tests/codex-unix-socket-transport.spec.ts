import { createServer, type Socket } from 'node:net';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAppServerUnixSocketTransport } from '../src/node';

const temporaryDirectories: string[] = [];
const serverSockets = new WeakMap<ReturnType<typeof createServer>, Set<Socket>>();

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('CodexAppServerUnixSocketTransport', () => {
  it('connects to an existing app-server socket, exchanges WebSocket JSON-RPC, and leaves the server running', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-sdk-unix-'));
    temporaryDirectories.push(directory);
    const socketPath = join(directory, 'app-server.sock');
    const received: unknown[] = [];
    const server = createServer((socket) => serveWebSocket(socket, received));
    await new Promise<void>((resolve, reject) => server.listen(socketPath, () => resolve()).once('error', reject));

    try {
      const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });
      const messages: unknown[] = [];
      transport.onMessage((message) => messages.push(message));

      await transport.start();
      transport.send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'test' } } });
      await waitFor(() => received.length === 1 && messages.length === 1);

      expect(received).toStrictEqual([{ id: 1, method: 'initialize', params: { clientInfo: { name: 'test' } } }]);
      expect(messages).toStrictEqual([{ id: 1, result: { ok: true } }]);

      await transport.close();
      expect(server.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('derives the control socket from codexHome and treats repeated lifecycle calls as no-ops', async () => {
    const directory = await temporaryDirectory();
    const controlDirectory = join(directory, 'app-server-control');
    await mkdir(controlDirectory);
    const socketPath = join(controlDirectory, 'app-server-control.sock');
    const server = createServer((socket) => serveWebSocket(socket, []));
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', codexHome: directory });

    try {
      await transport.start();
      await transport.start();
      await transport.close();
      await transport.close();
    } finally {
      await closeServer(server);
    }
  });

  it('rejects use before startup and unsuccessful or interrupted upgrades', async () => {
    const idle = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath: '/unused' });
    expect(() => idle.send({ id: 1, method: 'initialize', params: {} })).toThrow('not started');
    await idle.close();

    const rejectedPath = join(await temporaryDirectory(), 'rejected.sock');
    const rejectedServer = createServer((socket) => {
      socket.once('data', () => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
    });
    await listen(rejectedServer, rejectedPath);
    await expect(new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath: rejectedPath }).start())
      .rejects.toThrow('403 Forbidden');
    await closeServer(rejectedServer);

    const closedPath = join(await temporaryDirectory(), 'closed.sock');
    const closedServer = createServer((socket) => socket.end());
    await listen(closedServer, closedPath);
    await expect(new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath: closedPath }).start())
      .rejects.toThrow('closed the Unix socket during WebSocket upgrade');
    await closeServer(closedServer);
  });

  it('handles ping, fragmentation, malformed messages, and unsupported frames', async () => {
    const socketPath = join(await temporaryDirectory(), 'frames.sock');
    const clientFrames: Array<{ opcode: number; payload: Buffer }> = [];
    const server = createServer((socket) => {
      upgradeWebSocket(socket, (buffer) => {
        readAllClientFrames(buffer, clientFrames);
      }, () => {
        socket.write(Buffer.concat([
          encodeServerFrame(0x9, Buffer.from('ping')),
          encodeServerFrame(0x1, Buffer.from('{"ok":'), false),
          encodeServerFrame(0x0, Buffer.from('true}')),
          encodeServerFrame(0xA, Buffer.alloc(0)),
          encodeServerFrame(0x1, Buffer.from('{bad json')),
          encodeServerFrame(0x0, Buffer.from('orphan')),
          encodeServerFrame(0x2, Buffer.from('binary')),
        ]));
      });
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    const stopMessages = transport.onMessage((message) => messages.push(message));
    const stopErrors = transport.onError((error) => errors.push(error));

    try {
      await transport.start();
      await waitFor(() => messages.length === 1 && errors.length === 3 && clientFrames.some((frame) => frame.opcode === 0xA));
      expect(messages).toStrictEqual([{ ok: true }]);
      expect(errors.map((error) => error.message)).toStrictEqual([
        'Codex app-server sent malformed JSON',
        'Codex app-server sent an unexpected WebSocket continuation frame',
        'Codex app-server sent unsupported WebSocket opcode 2',
      ]);
      expect(clientFrames.find((frame) => frame.opcode === 0xA)?.payload.toString()).toBe('ping');
      stopMessages();
      stopErrors();
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('encodes medium and large client payload lengths', async () => {
    const socketPath = join(await temporaryDirectory(), 'large.sock');
    const received: unknown[] = [];
    const server = createServer((socket) => serveWebSocket(socket, received));
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });

    try {
      await transport.start();
      transport.send({ id: 1, method: 'medium', params: { text: 'm'.repeat(200) } });
      transport.send({ id: 2, method: 'large', params: { text: 'l'.repeat(70_000) } });
      await waitFor(() => received.length === 2);
      expect((received[0] as { method: string }).method).toBe('medium');
      expect((received[1] as { method: string }).method).toBe('large');
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });
});

function serveWebSocket(socket: Socket, received: unknown[]): void {
  upgradeWebSocket(socket, (buffer) => {
    const frames: Array<{ opcode: number; payload: Buffer }> = [];
    const remainder = readAllClientFrames(buffer, frames);
    for (const frame of frames) {
      if (frame.opcode !== 0x1) continue;
      received.push(JSON.parse(frame.payload.toString('utf8')));
      socket.write(encodeServerFrame(0x1, Buffer.from(JSON.stringify({ id: 1, result: { ok: true } }))));
    }
    return remainder;
  });
}

function readClientFrame(buffer: Buffer): { opcode: number; payload: Buffer; bytesRead: number } | null {
  if (buffer.length < 6) return null;
  const firstByte = buffer[0] ?? 0;
  const secondByte = buffer[1] ?? 0;
  const opcode = firstByte & 0x0f;
  let length = secondByte & 0x7f;
  let offset = 2;
  if ((secondByte & 0x80) === 0) return null;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + 4 + length) return null;
  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  for (let index = 0; index < payload.length; index += 1) payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
  return { opcode, payload, bytesRead: offset + length };
}

function encodeServerFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  if (payload.length < 126) return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header[0] = (fin ? 0x80 : 0) | opcode;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function upgradeWebSocket(
  socket: Socket,
  onFrames: (buffer: Buffer) => Buffer | void,
  onUpgrade?: () => void,
): void {
  let buffer: Buffer = Buffer.alloc(0);
  let upgraded = false;
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const boundary = buffer.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      upgraded = true;
      buffer = buffer.subarray(boundary + 4);
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      onUpgrade?.();
    }
    buffer = onFrames(buffer) ?? Buffer.alloc(0);
  });
}

function readAllClientFrames(
  initial: Buffer,
  frames: Array<{ opcode: number; payload: Buffer }>,
): Buffer {
  let buffer = initial;
  while (true) {
    const frame = readClientFrame(buffer);
    if (!frame) return buffer;
    frames.push(frame);
    buffer = buffer.subarray(frame.bytesRead);
  }
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-sdk-unix-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function listen(server: ReturnType<typeof createServer>, socketPath: string): Promise<void> {
  const sockets = new Set<Socket>();
  serverSockets.set(server, sockets);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => server.listen(socketPath, resolve).once('error', reject));
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  for (const socket of serverSockets.get(server) ?? []) socket.destroy();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Unix socket transport activity');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
