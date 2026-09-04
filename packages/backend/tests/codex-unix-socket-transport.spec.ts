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
      const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath: ` ${socketPath} ` });
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
    let connections = 0;
    const server = createServer((socket) => {
      connections += 1;
      serveWebSocket(socket, []);
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', codexHome: ` ${directory} ` });

    try {
      await transport.start();
      await transport.start();
      expect(connections).toBe(1);
      await transport.close();
      await transport.start();
      expect(connections).toBe(2);
      await transport.close();
    } finally {
      await closeServer(server);
    }
  });

  it('derives the control socket from a trimmed CODEX_HOME environment value', async () => {
    const directory = await temporaryDirectory();
    const controlDirectory = join(directory, 'app-server-control');
    await mkdir(controlDirectory);
    const socketPath = join(controlDirectory, 'app-server-control.sock');
    const server = createServer((socket) => serveWebSocket(socket, []));
    await listen(server, socketPath);
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = ` ${directory} `;
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket' });

    try {
      await transport.start();
      await transport.close();
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
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

  it('accepts a minimal upgrade status and rejects it when it is not the first header line', async () => {
    const acceptedPath = join(await temporaryDirectory(), 'minimal-upgrade.sock');
    const acceptedServer = createServer((socket) => {
      socket.once('data', () => socket.write('HTTP/1.1 101\r\n\r\n'));
    });
    await listen(acceptedServer, acceptedPath);
    const accepted = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath: acceptedPath });
    await accepted.start();
    await accepted.close();
    await closeServer(acceptedServer);

    const rejectedPath = join(await temporaryDirectory(), 'prefixed-upgrade.sock');
    const rejectedServer = createServer((socket) => {
      socket.once('data', () => socket.end('Unexpected: HTTP/1.1 101 Switching Protocols\r\n\r\n'));
    });
    await listen(rejectedServer, rejectedPath);
    await expect(new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath: rejectedPath }).start())
      .rejects.toThrow('Unexpected: HTTP/1.1 101');
    await closeServer(rejectedServer);

    const emptyPath = join(await temporaryDirectory(), 'empty-upgrade.sock');
    const emptyServer = createServer((socket) => {
      socket.once('data', () => socket.end('\r\n\r\n'));
    });
    await listen(emptyServer, emptyPath);
    await expect(new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath: emptyPath }).start())
      .rejects.toThrowError(new Error('Codex app-server rejected Unix socket WebSocket upgrade: '));
    await closeServer(emptyServer);
  });

  it('writes the exact handshake and rejects sends while the upgrade is pending', async () => {
    const socketPath = join(await temporaryDirectory(), 'handshake.sock');
    let requestText = '';
    let serverSocket: Socket | undefined;
    const server = createServer((socket) => {
      serverSocket = socket;
      socket.once('data', (data) => {
        requestText = data.toString('utf8');
      });
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });

    try {
      const starting = transport.start();
      await waitFor(() => requestText.length > 0);
      expect(() => transport.send({ id: 1, method: 'too-early', params: {} })).toThrow('not started');
      const lines = requestText.split('\r\n');
      expect(lines[0]).toBe('GET /rpc HTTP/1.1');
      expect(lines).toContain('Host: localhost');
      expect(lines).toContain('Upgrade: websocket');
      expect(lines).toContain('Connection: Upgrade');
      expect(lines).toContain('Sec-WebSocket-Version: 13');
      expect(lines.find((line) => line.startsWith('Sec-WebSocket-Key: ')))
        .toMatch(/^Sec-WebSocket-Key: [A-Za-z0-9+/]{22}==$/);
      serverSocket!.write('HTTP/1.1 101 Switching Protocols\r\n\r\n');
      await starting;
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('destroys a socket after the server rejects an upgrade without closing it', async () => {
    const socketPath = join(await temporaryDirectory(), 'rejected-open.sock');
    let serverSocketClosed = false;
    const server = createServer((socket) => {
      socket.once('close', () => {
        serverSocketClosed = true;
      });
      socket.once('data', () => socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'));
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });

    await expect(transport.start()).rejects.toThrow('403 Forbidden');
    await waitFor(() => serverSocketClosed);
    await closeServer(server);
  });

  it('removes upgrade listeners before processing frames containing header separators', async () => {
    const socketPath = join(await temporaryDirectory(), 'upgrade-cleanup.sock');
    let serverSocket: Socket | undefined;
    const server = createServer((socket) => {
      serverSocket = socket;
      upgradeWebSocket(socket, () => undefined);
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.onMessage((message) => messages.push(message));
    transport.onError((error) => errors.push(error));

    try {
      await transport.start();
      serverSocket!.write(encodeServerFrame(0x1, Buffer.from('{"text":"before\\r\\n\\r\\nafter"}')));
      await waitFor(() => messages.length === 1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(messages).toStrictEqual([{ text: 'before\r\n\r\nafter' }]);
      expect(errors).toStrictEqual([]);
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('handles ping, fragmentation, malformed messages, and unsupported frames', async () => {
    const socketPath = join(await temporaryDirectory(), 'frames.sock');
    const clientFrames: ClientFrame[] = [];
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
      expect(errors[0]?.cause).toBeInstanceOf(SyntaxError);
      expect(clientFrames.find((frame) => frame.opcode === 0xA)?.payload.toString()).toBe('ping');
      stopMessages();
      stopErrors();
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('buffers a split upgrade response and a bytewise server frame', async () => {
    const socketPath = join(await temporaryDirectory(), 'partial.sock');
    const server = createServer((socket) => {
      socket.once('data', () => {
        void (async () => {
          socket.write('HTTP/1.');
          await immediate();
          socket.write('1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n');
          const frame = encodeServerFrame(0x1, Buffer.from('{"split":true}'));
          for (const byte of frame) {
            socket.write(Buffer.from([byte]));
            await immediate();
          }
        })();
      });
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });
    const messages: unknown[] = [];
    transport.onMessage((message) => messages.push(message));

    try {
      await transport.start();
      await waitFor(() => messages.length === 1);
      expect(messages).toStrictEqual([{ split: true }]);
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('buffers incomplete medium and large frame headers without reporting errors', async () => {
    const socketPath = join(await temporaryDirectory(), 'partial-extended.sock');
    const server = createServer((socket) => {
      upgradeWebSocket(socket, () => undefined, () => {
        void (async () => {
          for (const payload of [jsonPayloadOfLength(126), jsonPayloadOfLength(65_536)]) {
            const frame = encodeServerFrame(0x1, payload);
            socket.write(frame.subarray(0, 2));
            await immediate();
            socket.write(frame.subarray(2, frame[1] === 126 ? 4 : 10));
            await immediate();
            socket.write(frame.subarray(frame[1] === 126 ? 4 : 10));
            await immediate();
          }
        })();
      });
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.onMessage((message) => messages.push(message));
    transport.onError((error) => errors.push(error));

    try {
      await transport.start();
      await waitFor(() => messages.length === 2);
      expect(messages).toStrictEqual([{ length: 126 }, { length: 65_536 }]);
      expect(errors).toStrictEqual([]);
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('answers a remote close frame, stops sending, and suppresses expected close errors', async () => {
    const socketPath = join(await temporaryDirectory(), 'remote-close.sock');
    const clientFrames: ClientFrame[] = [];
    const server = createServer((socket) => {
      upgradeWebSocket(socket, (buffer) => readAllClientFrames(buffer, clientFrames), () => {
        setImmediate(() => socket.write(encodeServerFrame(0x8, Buffer.alloc(0))));
      });
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });
    const errors: Error[] = [];
    transport.onError((error) => errors.push(error));

    try {
      await transport.start();
      await waitFor(() => clientFrames.some((frame) => frame.opcode === 0x8));
      expect(() => transport.send({ id: 1, method: 'after-close', params: {} })).toThrow('not started');
      expect(errors).toStrictEqual([]);
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('reports an unexpected post-upgrade disconnect and clears started state', async () => {
    const socketPath = join(await temporaryDirectory(), 'disconnect.sock');
    let connections = 0;
    const server = createServer((socket) => {
      connections += 1;
      upgradeWebSocket(socket, () => undefined, () => setImmediate(() => socket.destroy()));
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });
    const errors: Error[] = [];
    transport.onError((error) => errors.push(error));

    try {
      await transport.start();
      await waitFor(() => errors.length > 0);
      expect(errors.map((error) => error.message)).toStrictEqual([
        'Codex app-server Unix socket connection closed',
      ]);
      expect(() => transport.send({ id: 1, method: 'after-close', params: {} })).toThrow('not started');
      await transport.start();
      expect(connections).toBe(2);
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('removes message and error listeners when their unsubscribe callbacks run', async () => {
    const socketPath = join(await temporaryDirectory(), 'unsubscribe.sock');
    let serverSocket: Socket | undefined;
    const server = createServer((socket) => {
      serverSocket = socket;
      upgradeWebSocket(socket, () => undefined);
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    const stopMessages = transport.onMessage((message) => messages.push(message));
    const stopErrors = transport.onError((error) => errors.push(error));

    try {
      await transport.start();
      serverSocket!.write(encodeServerFrame(0x1, Buffer.from('{"first":true}')));
      await waitFor(() => messages.length === 1);
      stopMessages();
      stopErrors();
      serverSocket!.write(Buffer.concat([
        encodeServerFrame(0x1, Buffer.from('{"second":true}')),
        encodeServerFrame(0x1, Buffer.from('{bad json')),
      ]));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(messages).toStrictEqual([{ first: true }]);
      expect(errors).toStrictEqual([]);
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('keeps the upgraded connection usable after malformed payload bytes contain a header separator', async () => {
    const socketPath = join(await temporaryDirectory(), 'separator-payload.sock');
    let serverSocket: Socket | undefined;
    const server = createServer((socket) => {
      serverSocket = socket;
      upgradeWebSocket(socket, () => undefined);
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.onMessage((message) => messages.push(message));
    transport.onError((error) => errors.push(error));

    try {
      await transport.start();
      serverSocket!.write(encodeServerFrame(0x1, Buffer.from('bad\r\n\r\njson')));
      await waitFor(() => errors.length === 1);
      serverSocket!.write(encodeServerFrame(0x1, Buffer.from('{"still":"connected"}')));
      await waitFor(() => messages.length === 1);
      expect(errors.map((error) => error.message)).toStrictEqual([
        'Codex app-server sent malformed JSON',
      ]);
      expect(messages).toStrictEqual([{ still: 'connected' }]);
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('supports multi-continuation messages and rejects a new data frame mid-fragment', async () => {
    const socketPath = join(await temporaryDirectory(), 'fragment-boundaries.sock');
    const server = createServer((socket) => {
      upgradeWebSocket(socket, () => undefined, () => {
        socket.write(Buffer.concat([
          encodeServerFrame(0x1, Buffer.from('{"three":'), false),
          encodeServerFrame(0x0, Buffer.from('tr'), false),
          encodeServerFrame(0x0, Buffer.from('ue}')),
          encodeServerFrame(0x1, Buffer.from('{"incomplete":'), false),
          encodeServerFrame(0x1, Buffer.from('{}')),
        ]));
      });
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.onMessage((message) => messages.push(message));
    transport.onError((error) => errors.push(error));

    try {
      await transport.start();
      await waitFor(() => messages.length === 1 && errors.length === 1);
      expect(messages).toStrictEqual([{ three: true }]);
      expect(errors.map((error) => error.message)).toStrictEqual([
        'Codex app-server sent unsupported WebSocket opcode 1',
      ]);
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('encodes medium and large client payload lengths', async () => {
    const socketPath = join(await temporaryDirectory(), 'large.sock');
    const received: unknown[] = [];
    const frameLengths: number[] = [];
    const lengthCodes: number[] = [];
    const server = createServer((socket) => {
      upgradeWebSocket(socket, (buffer) => {
        const frames: ClientFrame[] = [];
        const remainder = readAllClientFrames(buffer, frames);
        for (const frame of frames) {
          if (frame.opcode !== 0x1) continue;
          frameLengths.push(frame.payload.length);
          lengthCodes.push(frame.lengthCode);
          received.push(JSON.parse(frame.payload.toString('utf8')));
        }
        return remainder;
      });
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });

    try {
      await transport.start();
      for (const length of [125, 126, 65_535, 65_536]) transport.send(rpcMessageOfLength(length));
      await waitFor(() => received.length === 4);
      expect(frameLengths).toStrictEqual([125, 126, 65_535, 65_536]);
      expect(lengthCodes).toStrictEqual([125, 126, 126, 127]);
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('decodes short, medium, large, and masked server frames at exact boundaries', async () => {
    const socketPath = join(await temporaryDirectory(), 'server-boundaries.sock');
    const payloads = [125, 126, 65_535, 65_536].map((length) => jsonPayloadOfLength(length));
    const server = createServer((socket) => {
      upgradeWebSocket(socket, () => undefined, () => {
        socket.write(Buffer.concat([
          encodeServerFrame(0x1, payloads[0]!, true, true),
          encodeServerFrame(0x1, payloads[1]!),
          encodeServerFrame(0x1, payloads[2]!),
          encodeServerFrame(0x1, payloads[3]!),
        ]));
      });
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({ type: 'unixSocket', socketPath });
    const messages: unknown[] = [];
    transport.onMessage((message) => messages.push(message));

    try {
      await transport.start();
      await waitFor(() => messages.length === 4);
      expect(messages).toStrictEqual([
        { length: 125 }, { length: 126 }, { length: 65_535 }, { length: 65_536 },
      ]);
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('reports configured frame-limit violations without escaping the socket callback', async () => {
    const socketPath = join(await temporaryDirectory(), 'frame-limit.sock');
    const server = createServer((socket) => {
      upgradeWebSocket(socket, () => undefined, () => {
        socket.write(Buffer.concat([
          encodeServerFrame(0x1, jsonPayloadOfLength(126)),
          encodeServerFrame(0x1, jsonPayloadOfLength(127)),
        ]));
      });
    });
    await listen(server, socketPath);
    const transport = new CodexAppServerUnixSocketTransport({
      type: 'unixSocket', socketPath, maxFrameBytes: 126,
    });
    const messages: unknown[] = [];
    const errors: Error[] = [];
    transport.onMessage((message) => messages.push(message));
    transport.onError((error) => errors.push(error));

    try {
      await transport.start();
      await waitFor(() => errors.length === 1);
      expect(messages).toStrictEqual([{ length: 126 }]);
      expect(errors.map((error) => error.message)).toStrictEqual([
        'Codex app-server WebSocket frame exceeded the configured limit',
      ]);
    } finally {
      await transport.close();
      await closeServer(server);
    }
  });

  it('reports unsafe 64-bit frame lengths and accepts the safe-integer boundary', async () => {
    const oversizedPath = join(await temporaryDirectory(), 'oversized-frame.sock');
    const oversizedServer = createServer((socket) => {
      upgradeWebSocket(socket, () => undefined, () => {
        socket.write(serverFrameLengthHeader(BigInt(Number.MAX_SAFE_INTEGER) + 1n));
      });
    });
    await listen(oversizedServer, oversizedPath);
    const oversized = new CodexAppServerUnixSocketTransport({
      type: 'unixSocket', socketPath: oversizedPath, maxFrameBytes: Number.MAX_SAFE_INTEGER,
    });
    const oversizedErrors: Error[] = [];
    oversized.onError((error) => oversizedErrors.push(error));
    await oversized.start();
    await waitFor(() => oversizedErrors.length === 1);
    expect(oversizedErrors.map((error) => error.message)).toStrictEqual([
      'Codex app-server sent an oversized WebSocket frame',
    ]);
    await oversized.close();
    await closeServer(oversizedServer);

    const boundaryPath = join(await temporaryDirectory(), 'safe-frame.sock');
    const boundaryServer = createServer((socket) => {
      upgradeWebSocket(socket, () => undefined, () => {
        socket.write(serverFrameLengthHeader(BigInt(Number.MAX_SAFE_INTEGER)));
      });
    });
    await listen(boundaryServer, boundaryPath);
    const boundary = new CodexAppServerUnixSocketTransport({
      type: 'unixSocket', socketPath: boundaryPath, maxFrameBytes: Number.MAX_SAFE_INTEGER,
    });
    const boundaryErrors: Error[] = [];
    boundary.onError((error) => boundaryErrors.push(error));
    await boundary.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(boundaryErrors).toStrictEqual([]);
    await boundary.close();
    await closeServer(boundaryServer);
  });
});

type ClientFrame = { opcode: number; payload: Buffer; bytesRead: number; lengthCode: number };

function serveWebSocket(socket: Socket, received: unknown[]): void {
  upgradeWebSocket(socket, (buffer) => {
    const frames: ClientFrame[] = [];
    const remainder = readAllClientFrames(buffer, frames);
    for (const frame of frames) {
      if (frame.opcode !== 0x1) continue;
      received.push(JSON.parse(frame.payload.toString('utf8')));
      socket.write(encodeServerFrame(0x1, Buffer.from(JSON.stringify({ id: 1, result: { ok: true } }))));
    }
    return remainder;
  });
}

function readClientFrame(buffer: Buffer): ClientFrame | null {
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
  return { opcode, payload, bytesRead: offset + length, lengthCode: secondByte & 0x7f };
}

function encodeServerFrame(opcode: number, payload: Buffer, fin = true, masked = false): Buffer {
  const maskBit = masked ? 0x80 : 0;
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([(fin ? 0x80 : 0) | opcode, maskBit | payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = maskBit | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  if (!masked) return Buffer.concat([header, payload]);
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const encoded = Buffer.from(payload);
  for (let index = 0; index < encoded.length; index += 1) {
    encoded[index] = (encoded[index] ?? 0) ^ (mask[index % 4] ?? 0);
  }
  return Buffer.concat([header, mask, encoded]);
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
  frames: ClientFrame[],
): Buffer {
  let buffer = initial;
  while (true) {
    const frame = readClientFrame(buffer);
    if (!frame) return buffer;
    frames.push(frame);
    buffer = buffer.subarray(frame.bytesRead);
  }
}

function rpcMessageOfLength(length: number) {
  const message = { id: length, method: 'boundary', params: { text: '' } };
  const emptyLength = Buffer.byteLength(JSON.stringify(message));
  message.params.text = 'x'.repeat(length - emptyLength);
  expect(Buffer.byteLength(JSON.stringify(message))).toBe(length);
  return message;
}

function jsonPayloadOfLength(length: number): Buffer {
  const json = JSON.stringify({ length });
  return Buffer.from(`${json}${' '.repeat(length - Buffer.byteLength(json))}`);
}

function serverFrameLengthHeader(length: bigint): Buffer {
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(length, 2);
  return header;
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

function immediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
