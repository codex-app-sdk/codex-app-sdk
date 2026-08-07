import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createConnection, type Socket } from 'node:net';
import { RpcTransportProtocolError, type RpcMessage, type RpcTransport } from '../codex/wire';

const DEFAULT_MAX_FRAME_BYTES = 64 * 1024 * 1024;

export type CodexAppServerUnixSocketTransportOptions = {
  /** Discriminates this opt-in transport from the default spawned stdio transport. */
  type: 'unixSocket';
  /** Absolute path to an app-server control socket. */
  socketPath?: string;
  /** Used to derive the default control socket when socketPath is omitted. */
  codexHome?: string;
  maxFrameBytes?: number;
};

/**
 * Connects to an already-running Codex app-server listening on a Unix socket.
 * It never owns, starts, or stops the remote server.
 */
export class CodexAppServerUnixSocketTransport implements RpcTransport {
  private socket: Socket | null = null;
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private handshakeBuffer = Buffer.alloc(0);
  private frameBuffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentOpcode: number | null = null;
  private started = false;
  private closed = false;

  constructor(private readonly options: CodexAppServerUnixSocketTransportOptions) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.closed = false;
    const socket = createConnection(this.socketPath());
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error): void => {
        cleanup();
        this.socket = null;
        socket.destroy();
        reject(error);
      };
      const onConnect = (): void => {
        socket.write(websocketHandshakeRequest());
      };
      const onData = (chunk: Buffer): void => {
        this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk]);
        const boundary = this.handshakeBuffer.indexOf('\r\n\r\n');
        if (boundary < 0) return;
        const header = this.handshakeBuffer.subarray(0, boundary).toString('utf8');
        const remainder = this.handshakeBuffer.subarray(boundary + 4);
        this.handshakeBuffer = Buffer.alloc(0);
        if (!/^HTTP\/1\.1 101(?: |$)/m.test(header)) {
          fail(new Error(`Codex app-server rejected Unix socket WebSocket upgrade: ${header.split('\r\n', 1)[0] ?? 'invalid response'}`));
          return;
        }
        cleanup();
        socket.on('data', (data: Buffer) => this.handleFrameData(data));
        socket.on('error', (error) => this.handleSocketError(error));
        socket.on('close', () => this.handleSocketClose());
        this.started = true;
        if (remainder.length > 0) this.handleFrameData(remainder);
        resolve();
      };
      const cleanup = (): void => {
        socket.off('connect', onConnect);
        socket.off('data', onData);
        socket.off('error', fail);
        socket.off('close', onClose);
      };
      const onClose = (): void => fail(new Error('Codex app-server closed the Unix socket during WebSocket upgrade'));
      socket.once('connect', onConnect);
      socket.on('data', onData);
      socket.once('error', fail);
      socket.once('close', onClose);
    });
  }

  send(message: RpcMessage): void {
    if (!this.socket || !this.started) throw new Error('Codex app-server Unix socket transport is not started');
    this.writeFrame(0x1, Buffer.from(JSON.stringify(message)));
  }

  async close(): Promise<void> {
    this.closed = true;
    this.started = false;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    if (!socket.destroyed) {
      try {
        this.writeFrame(0x8, Buffer.alloc(0), socket);
      } finally {
        socket.end();
      }
    }
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private socketPath(): string {
    const explicit = this.options.socketPath?.trim();
    if (explicit) return explicit;
    const home = this.options.codexHome?.trim() || process.env.CODEX_HOME?.trim() || join(homedir(), '.codex');
    return join(home, 'app-server-control', 'app-server-control.sock');
  }

  private handleFrameData(chunk: Buffer): void {
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);
    while (true) {
      const frame = readFrame(this.frameBuffer, this.options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES);
      if (!frame) return;
      this.frameBuffer = this.frameBuffer.subarray(frame.bytesRead);
      this.handleFrame(frame.fin, frame.opcode, frame.payload);
    }
  }

  private handleFrame(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode === 0x8) {
      void this.close();
      return;
    }
    if (opcode === 0x9) {
      if (this.socket && !this.socket.destroyed) this.writeFrame(0xA, payload);
      return;
    }
    if (opcode === 0xA) return;
    if (opcode === 0x0) {
      if (this.fragmentOpcode === null) return this.emitError(new RpcTransportProtocolError('Codex app-server sent an unexpected WebSocket continuation frame'));
      this.fragments.push(payload);
      if (!fin) return;
      const initialOpcode = this.fragmentOpcode;
      const complete = Buffer.concat(this.fragments);
      this.fragments = [];
      this.fragmentOpcode = null;
      return this.handleFrame(true, initialOpcode, complete);
    }
    if (opcode !== 0x1 || this.fragmentOpcode !== null) {
      return this.emitError(new RpcTransportProtocolError(`Codex app-server sent unsupported WebSocket opcode ${opcode}`));
    }
    if (!fin) {
      this.fragmentOpcode = opcode;
      this.fragments = [payload];
      return;
    }
    try {
      const message: unknown = JSON.parse(payload.toString('utf8'));
      for (const listener of this.messageListeners) listener(message);
    } catch (error) {
      this.emitError(new RpcTransportProtocolError('Codex app-server sent malformed JSON', { cause: error }));
    }
  }

  private writeFrame(opcode: number, payload: Buffer, target = this.socket): void {
    if (!target) return;
    target.write(encodeClientFrame(opcode, payload));
  }

  private handleSocketError(error: Error): void {
    if (!this.closed) this.emitError(error);
  }

  private handleSocketClose(): void {
    this.started = false;
    this.socket = null;
    if (!this.closed) this.emitError(new Error('Codex app-server Unix socket connection closed'));
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

function websocketHandshakeRequest(): string {
  const key = randomBytes(16).toString('base64');
  return [
    'GET /rpc HTTP/1.1',
    'Host: localhost',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    '',
    '',
  ].join('\r\n');
}

function encodeClientFrame(opcode: number, payload: Buffer): Buffer {
  const mask = randomBytes(4);
  const header = frameHeader(opcode, payload.length, true);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) masked[index] = (masked[index] ?? 0) ^ (mask[index % 4] ?? 0);
  return Buffer.concat([header, mask, masked]);
}

function frameHeader(opcode: number, length: number, masked: boolean): Buffer {
  const maskBit = masked ? 0x80 : 0;
  if (length < 126) return Buffer.from([0x80 | opcode, maskBit | length]);
  if (length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = maskBit | 126;
    header.writeUInt16BE(length, 2);
    return header;
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = maskBit | 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return header;
}

function readFrame(buffer: Buffer, maxFrameBytes: number): { fin: boolean; opcode: number; payload: Buffer; bytesRead: number } | null {
  if (buffer.length < 2) return null;
  const firstByte = buffer[0] ?? 0;
  const secondByte = buffer[1] ?? 0;
  const fin = (firstByte & 0x80) !== 0;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let length = secondByte & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const longLength = buffer.readBigUInt64BE(offset);
    if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new RpcTransportProtocolError('Codex app-server sent an oversized WebSocket frame');
    length = Number(longLength);
    offset += 8;
  }
  if (length > maxFrameBytes) throw new RpcTransportProtocolError('Codex app-server WebSocket frame exceeded the configured limit');
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) return null;
  const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
  offset += maskLength;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
  return { fin, opcode, payload, bytesRead: offset + length };
}
