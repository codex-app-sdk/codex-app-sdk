import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAppServerUnixSocketTransport } from '../src/node';

const temporaryDirectories: string[] = [];

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
});

function serveWebSocket(socket: Socket, received: unknown[]): void {
  let buffer = Buffer.alloc(0);
  let upgraded = false;
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const boundary = buffer.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      upgraded = true;
      buffer = buffer.subarray(boundary + 4);
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    }
    const frame = readClientFrame(buffer);
    if (!frame) return;
    buffer = buffer.subarray(frame.bytesRead);
    if (frame.opcode !== 0x1) return;
    received.push(JSON.parse(frame.payload.toString('utf8')));
    socket.write(encodeServerTextFrame(JSON.stringify({ id: 1, result: { ok: true } }), false));
  });
}

function readClientFrame(buffer: Buffer): { opcode: number; payload: Buffer; bytesRead: number } | null {
  if (buffer.length < 6) return null;
  const firstByte = buffer[0] ?? 0;
  const secondByte = buffer[1] ?? 0;
  const opcode = firstByte & 0x0f;
  const length = secondByte & 0x7f;
  if ((secondByte & 0x80) === 0 || length >= 126 || buffer.length < 6 + length) return null;
  const mask = buffer.subarray(2, 6);
  const payload = Buffer.from(buffer.subarray(6, 6 + length));
  for (let index = 0; index < payload.length; index += 1) payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
  return { opcode, payload, bytesRead: 6 + length };
}

function encodeServerTextFrame(text: string, fragmented: boolean): Buffer {
  const payload = Buffer.from(text);
  return Buffer.concat([Buffer.from([fragmented ? 0x01 : 0x81, payload.length]), payload]);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Unix socket transport activity');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
