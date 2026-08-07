import {
  invokeCodexSurfaceBridgeOperation,
  isCodexSurfaceBridgeOperation,
  type CodexSurfaceBridgeAttachmentResolver,
  type CodexSurfaceBridgeTarget,
} from '@codex-app-sdk/core/surface-bridge';
import {
  codexWebSocketProtocolVersion,
  encodeCodexWebSocketMessage,
  type CodexWebSocketFailure,
  type CodexWebSocketRequest,
  type CodexWebSocketServerMessage,
} from './protocol';
import {
  codexWebSocketText,
  positiveWebSocketLimit,
  type CodexWebSocketClose,
  type CodexWebSocketPort,
} from './socket-port';

type Awaitable<Value> = Value | Promise<Value>;

export type CodexWebSocketSessionRelease = {
  reason: 'authorization_failed' | 'server_closed' | 'socket_closed' | 'surface_failed';
  close?: CodexWebSocketClose;
  error?: unknown;
};

/** A host-authorized, connection-scoped lease. The host owns its lifecycle and isolation policy. */
export type CodexWebSocketSessionLease = {
  surface: CodexSurfaceBridgeTarget;
  resolveAttachment?: CodexSurfaceBridgeAttachmentResolver;
  release?(context: CodexWebSocketSessionRelease): Awaitable<void>;
};

export type BindCodexWebSocketOptions<Context> = {
  socket: CodexWebSocketPort;
  context: Context;
  authorize(context: Context): Awaitable<CodexWebSocketSessionLease | null>;
  maxMessageBytes?: number;
};

export type CodexWebSocketBinding = {
  /** Resolves after authorization and the initial surface snapshot have been sent. */
  ready: Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
};

/** The small EventEmitter-style subset implemented by the popular `ws` package. */
export type CodexNodeWebSocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown) => void): unknown;
  on(event: 'close', listener: (code: number, reason: unknown) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
};

const defaultMaximumMessageBytes = 16 * 1024 * 1024;

/**
 * Binds an established socket to a required host authorization callback.
 * HTTP upgrades, cookies, user lookup, runner pooling, and Express integration stay host-owned.
 */
export function bindCodexWebSocket<Context>(
  options: BindCodexWebSocketOptions<Context>,
): CodexWebSocketBinding {
  return new ServerBinding(options);
}

/** Adapts a `ws`-style socket without importing or depending on that library. */
export function createCodexNodeWebSocketPort(socket: CodexNodeWebSocketLike): CodexWebSocketPort {
  return {
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onMessage: (listener) => nodeSocketListener(socket, 'message', listener),
    onClose: (listener) => nodeSocketListener(socket, 'close', (code: unknown, reason: unknown) => listener({
      code: typeof code === 'number' ? code : undefined,
      reason: socketReason(reason),
    })),
    onError: (listener) => nodeSocketListener(socket, 'error', listener),
  };
}

class ServerBinding<Context> implements CodexWebSocketBinding {
  readonly ready: Promise<void>;
  readonly #socket: CodexWebSocketPort;
  readonly #context: Context;
  readonly #authorize: BindCodexWebSocketOptions<Context>['authorize'];
  readonly #maxMessageBytes: number;
  readonly #unsubscribers: Array<() => void> = [];
  #lease: CodexWebSocketSessionLease | null = null;
  #requestQueue = Promise.resolve();
  #acceptingRequests = false;
  #finished = false;
  #releasePromise: Promise<void> | null = null;

  constructor(options: BindCodexWebSocketOptions<Context>) {
    this.#socket = options.socket;
    this.#context = options.context;
    this.#authorize = options.authorize;
    this.#maxMessageBytes = positiveWebSocketLimit(
      options.maxMessageBytes,
      defaultMaximumMessageBytes,
      'Codex WebSocket message byte limit',
    );
    this.#unsubscribers.push(
      this.#socket.onMessage((data) => this.#receive(data)),
      this.#socket.onClose((close) => { void this.#finish({ reason: 'socket_closed', close }); }),
    );
    if (this.#socket.onError) {
      this.#unsubscribers.push(this.#socket.onError((error) => {
        void this.#finish({ reason: 'socket_closed', error });
      }));
    }
    this.ready = this.#initialize();
  }

  async close(code = 1000, reason = 'Codex web session closed'): Promise<void> {
    if (!this.#finished) this.#socket.close(code, reason);
    await this.#finish({ reason: 'server_closed', close: { code, reason, wasClean: true } });
  }

  async #initialize(): Promise<void> {
    try {
      const lease = await this.#authorize(this.#context);
      if (!lease) {
        this.#socket.close(4401, 'Unauthorized');
        await this.#finish({ reason: 'authorization_failed' });
        throw new Error('Codex WebSocket authorization was denied');
      }
      if (this.#finished) {
        await lease.release?.({ reason: 'socket_closed' });
        return;
      }
      this.#lease = lease;
      this.#unsubscribers.push(
        lease.surface.onStateChange((snapshot) => {
          if (this.#acceptingRequests) this.#send({
            version: codexWebSocketProtocolVersion,
            type: 'snapshot',
            snapshot,
          });
        }),
        lease.surface.onEvent((event) => {
          if (this.#acceptingRequests) this.#send({
            version: codexWebSocketProtocolVersion,
            type: 'event',
            event,
          });
        }),
      );
      const snapshot = await lease.surface.connect();
      if (this.#finished) return;
      this.#send({ version: codexWebSocketProtocolVersion, type: 'ready', snapshot });
      this.#acceptingRequests = true;
    } catch (error) {
      if (!this.#finished) {
        this.#socket.close(1011, 'Codex web session initialization failed');
        await this.#finish({ reason: 'surface_failed', error });
      }
      throw error;
    }
  }

  #receive(data: unknown): void {
    if (this.#finished) return;
    if (!this.#acceptingRequests) {
      this.#socket.close(4400, 'Request received before the session was ready');
      void this.#finish({ reason: 'socket_closed', close: { code: 4400 } });
      return;
    }
    let request: CodexWebSocketRequest;
    try {
      request = parseRequest(codexWebSocketText(data, this.#maxMessageBytes));
    } catch {
      this.#socket.close(4400, 'Invalid Codex WebSocket request');
      void this.#finish({ reason: 'socket_closed', close: { code: 4400 } });
      return;
    }
    this.#requestQueue = this.#requestQueue.then(() => this.#handle(request));
  }

  async #handle(request: CodexWebSocketRequest): Promise<void> {
    const lease = this.#lease;
    if (!lease || this.#finished) return;
    try {
      const result = await invokeCodexSurfaceBridgeOperation(
        lease.surface,
        request.operation,
        request.args,
        lease.resolveAttachment ? { resolveAttachment: lease.resolveAttachment } : {},
      );
      this.#send({
        version: codexWebSocketProtocolVersion,
        type: 'response',
        id: request.id,
        ok: true,
        result,
      });
    } catch (error) {
      this.#send(failure(
        request.id,
        error instanceof TypeError || error instanceof RangeError ? 'invalid_request' : 'operation_failed',
        errorMessage(error),
      ));
    }
  }

  #send(message: CodexWebSocketServerMessage): void {
    if (this.#finished) return;
    try {
      const encoded = encodeCodexWebSocketMessage(message);
      if (new TextEncoder().encode(encoded).byteLength > this.#maxMessageBytes) {
        throw new RangeError('Codex WebSocket response exceeds the configured byte limit');
      }
      this.#socket.send(encoded);
    } catch (error) {
      this.#socket.close(1011, 'Codex WebSocket response failed');
      void this.#finish({ reason: 'socket_closed', error });
    }
  }

  #finish(context: CodexWebSocketSessionRelease): Promise<void> {
    if (this.#releasePromise) return this.#releasePromise;
    this.#finished = true;
    this.#acceptingRequests = false;
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
    const lease = this.#lease;
    this.#lease = null;
    this.#releasePromise = Promise.resolve(lease?.release?.(context)).then(() => undefined);
    return this.#releasePromise;
  }
}

function parseRequest(text: string): CodexWebSocketRequest {
  const value = JSON.parse(text) as unknown;
  if (!isPlainObject(value)) throw new TypeError('Codex WebSocket request must be an object');
  onlyKeys(value, ['version', 'type', 'id', 'operation', 'args']);
  if (value.version !== codexWebSocketProtocolVersion || value.type !== 'request') {
    throw new TypeError('Codex WebSocket request version or type is invalid');
  }
  if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 128) {
    throw new TypeError('Codex WebSocket request id is invalid');
  }
  if (!isCodexSurfaceBridgeOperation(value.operation)) {
    throw new TypeError('Codex WebSocket operation is invalid');
  }
  if (!Array.isArray(value.args)) throw new TypeError('Codex WebSocket request args must be an array');
  return {
    version: codexWebSocketProtocolVersion,
    type: 'request',
    id: value.id,
    operation: value.operation,
    args: value.args,
  };
}

function failure(
  id: string,
  code: CodexWebSocketFailure['error']['code'],
  message: string,
): CodexWebSocketFailure {
  return {
    version: codexWebSocketProtocolVersion,
    type: 'response',
    id,
    ok: false,
    error: { code, message: message.slice(0, 2_000) },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function onlyKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  if (Reflect.ownKeys(record).some((key) => typeof key !== 'string' || !allowed.has(key))) {
    throw new TypeError('Codex WebSocket request contains unsupported properties');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nodeSocketListener(
  socket: CodexNodeWebSocketLike,
  event: 'message' | 'close' | 'error',
  listener: (first: unknown, second?: unknown) => void,
): () => void {
  if (event === 'message') socket.on(event, listener as (data: unknown) => void);
  if (event === 'close') socket.on(event, listener as (code: number, reason: unknown) => void);
  if (event === 'error') socket.on(event, listener as (error: unknown) => void);
  return () => {
    const removable = socket as CodexNodeWebSocketLike & {
      off?(name: string, callback: (first: unknown, second?: unknown) => void): unknown;
      removeListener?(name: string, callback: (first: unknown, second?: unknown) => void): unknown;
    };
    if (removable.off) removable.off(event, listener);
    else removable.removeListener?.(event, listener);
  };
}

function socketReason(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const reason = new TextDecoder().decode(value).trim();
    return reason || undefined;
  }
  return undefined;
}

export type {
  CodexWebSocketClose,
  CodexWebSocketPort,
} from './socket-port';
