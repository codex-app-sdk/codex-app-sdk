import type { ClientNotification } from './generated/ClientNotification';
import type { InitializeParams } from './generated/InitializeParams';
import type { InitializeResponse } from './generated/InitializeResponse';
import type { ServerNotification } from './generated/ServerNotification';
import type { ServerRequest } from './generated/ServerRequest';
import type { CodexAppServerMethodMap } from './method-map';
import type { CodexServerRequestMethodMap } from './server-request-map';
import {
  isRecord,
  isRpcError,
  RpcRemoteError,
  RpcTransportProtocolError,
  type RpcError,
  type RpcId,
  type RpcMessage,
  type RpcTransport,
} from './wire';

type MethodName = keyof CodexAppServerMethodMap & string;
type MethodParams<Method extends MethodName> = CodexAppServerMethodMap[Method]['params'];
type MethodResult<Method extends MethodName> = CodexAppServerMethodMap[Method]['result'];
type MethodArguments<Params> = undefined extends Params ? [params?: Params] : [params: Params];

type ClientNotificationMethod = ClientNotification['method'];
type ClientNotificationFor<Method extends ClientNotificationMethod> = Extract<ClientNotification, { method: Method }>;
type ClientNotificationParams<Method extends ClientNotificationMethod> = ClientNotificationFor<Method> extends { params: infer Params }
  ? Params
  : undefined;

type ServerNotificationMethod = ServerNotification['method'];
type ServerNotificationFor<Method extends ServerNotificationMethod> = Extract<ServerNotification, { method: Method }>;

type ServerRequestMethod = keyof CodexServerRequestMethodMap & string;
type ServerRequestFor<Method extends ServerRequestMethod> = Extract<ServerRequest, { method: Method }>;
type ServerRequestResult<Method extends ServerRequestMethod> = CodexServerRequestMethodMap[Method]['result'];

type PendingRequest = {
  method: string;
  resolve(result: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const LONG_MUTATION_REQUEST_TIMEOUT_MS = 120_000;
const requestTimeoutByMethod: Partial<Record<MethodName, number>> = {
  'thread/revert': LONG_MUTATION_REQUEST_TIMEOUT_MS,
  'thread/rollback': LONG_MUTATION_REQUEST_TIMEOUT_MS,
};

export type CodexServerRequestResponder<Method extends ServerRequestMethod> = {
  readonly responded: boolean;
  resolve(result: ServerRequestResult<Method>): void;
  reject(error: Error | RpcError | string): void;
};

export type UntypedCodexServerRequestResponder = {
  readonly responded: boolean;
  resolve(result: unknown): void;
  reject(error: Error | RpcError | string): void;
};

export type CodexAppServerClientOptions = {
  requestTimeoutMs?: number;
  onProtocolError?: (error: Error) => void;
  unhandledServerRequestError?: (request: { id: RpcId; method: string; params?: unknown }) => RpcError;
};

type AnyServerRequestHandler = (
  request: ServerRequest,
  responder: UntypedCodexServerRequestResponder,
) => boolean | void | Promise<boolean | void>;

const defaultUnhandledRequestError = (request: { method: string }): RpcError => ({
  code: -32601,
  message: `Codex app-server request is not implemented: ${request.method}`,
});

export class CodexAppServerClient {
  private nextId = 1;
  private started = false;
  private initializePromise: Promise<InitializeResponse> | null = null;
  private readonly pending = new Map<RpcId, PendingRequest>();
  private readonly notificationListeners = new Set<(notification: ServerNotification) => void>();
  private readonly notificationListenersByMethod = new Map<string, Set<(notification: ServerNotification) => void>>();
  private readonly serverRequestHandlers = new Map<string, Set<AnyServerRequestHandler>>();
  private readonly anyServerRequestHandlers = new Set<AnyServerRequestHandler>();
  private readonly disconnectListeners = new Set<(error: Error) => void>();
  private unsubscribeMessage?: () => void;
  private unsubscribeError?: () => void;

  constructor(
    private readonly transport: RpcTransport,
    private readonly options: CodexAppServerClientOptions = {},
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.unsubscribeMessage = this.transport.onMessage((message) => this.handleMessage(message));
    this.unsubscribeError = this.transport.onError((error) => this.handleTransportError(error));

    try {
      await this.transport.start();
      this.started = true;
    } catch (error) {
      this.unsubscribeTransport();
      throw error;
    }
  }

  initialize(params: InitializeParams): Promise<InitializeResponse> {
    if (!this.initializePromise) {
      this.initializePromise = this.request('initialize', params)
        .then((result) => {
          this.notify('initialized');
          return result;
        })
        .catch((error: unknown) => {
          this.initializePromise = null;
          throw error;
        });
    }

    return this.initializePromise;
  }

  request<Method extends MethodName>(
    method: Method,
    ...[params]: MethodArguments<MethodParams<Method>>
  ): Promise<MethodResult<Method>> {
    this.assertStarted();
    const id = this.nextId++;
    const message: RpcMessage = params === undefined
      ? { id, method }
      : { id, method, params };

    const result = new Promise<MethodResult<Method>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.options.requestTimeoutMs ?? requestTimeoutByMethod[method] ?? DEFAULT_REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as MethodResult<Method>),
        reject,
        timeout,
      });
    });

    try {
      this.transport.send(message);
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.reject(toError(error));
      }
    }

    return result;
  }

  notify<Method extends ClientNotificationMethod>(
    method: Method,
    ...[params]: MethodArguments<ClientNotificationParams<Method>>
  ): void {
    this.assertStarted();
    this.transport.send(params === undefined ? { method } : { method, params });
  }

  onNotification(listener: (notification: ServerNotification) => void): () => void;
  onNotification<Method extends ServerNotificationMethod>(
    method: Method,
    listener: (notification: ServerNotificationFor<Method>) => void,
  ): () => void;
  onNotification<Method extends ServerNotificationMethod>(
    methodOrListener: Method | ((notification: ServerNotification) => void),
    methodListener?: (notification: ServerNotificationFor<Method>) => void,
  ): () => void {
    if (typeof methodOrListener === 'function') {
      this.notificationListeners.add(methodOrListener);
      return () => this.notificationListeners.delete(methodOrListener);
    }

    const listeners = this.notificationListenersByMethod.get(methodOrListener) ?? new Set();
    const listener = methodListener as (notification: ServerNotification) => void;
    listeners.add(listener);
    this.notificationListenersByMethod.set(methodOrListener, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.notificationListenersByMethod.delete(methodOrListener);
      }
    };
  }

  onServerRequest<Method extends ServerRequestMethod>(
    method: Method,
    handler: (
      request: ServerRequestFor<Method>,
      responder: CodexServerRequestResponder<Method>,
    ) => boolean | void | Promise<boolean | void>,
  ): () => void {
    const handlers = this.serverRequestHandlers.get(method) ?? new Set();
    const untypedHandler = handler as AnyServerRequestHandler;
    handlers.add(untypedHandler);
    this.serverRequestHandlers.set(method, handlers);
    return () => {
      handlers.delete(untypedHandler);
      if (handlers.size === 0) {
        this.serverRequestHandlers.delete(method);
      }
    };
  }

  onAnyServerRequest(handler: AnyServerRequestHandler): () => void {
    this.anyServerRequestHandlers.add(handler);
    return () => this.anyServerRequestHandlers.delete(handler);
  }

  onDisconnect(listener: (error: Error) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async close(): Promise<void> {
    this.unsubscribeTransport();
    this.started = false;
    this.initializePromise = null;
    this.rejectAll(new Error('Codex app-server connection closed'));
    await this.transport.close();
  }

  private assertStarted(): void {
    if (!this.started) {
      throw new Error('Codex app-server client is not started');
    }
  }

  private unsubscribeTransport(): void {
    this.unsubscribeMessage?.();
    this.unsubscribeError?.();
    this.unsubscribeMessage = undefined;
    this.unsubscribeError = undefined;
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message)) {
      this.reportProtocolError(new Error('Codex app-server sent a non-object message'));
      return;
    }

    const id = isRpcId(message.id) ? message.id : undefined;
    if (id !== undefined && ('result' in message || 'error' in message) && typeof message.method !== 'string') {
      this.handleResponse(id, message);
      return;
    }

    if (typeof message.method === 'string' && id !== undefined) {
      void this.handleServerRequest({
        id,
        method: message.method,
        ...('params' in message ? { params: message.params } : {}),
      });
      return;
    }

    if (typeof message.method === 'string') {
      this.handleNotification(message as ServerNotification);
      return;
    }

    this.reportProtocolError(new Error('Codex app-server sent an invalid RPC message'));
  }

  private handleResponse(id: RpcId, message: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(id);
    if ('error' in message) {
      if (isRpcError(message.error)) {
        pending.reject(new RpcRemoteError(message.error));
      } else {
        pending.reject(new Error(`Codex app-server returned a malformed error for ${pending.method}`));
      }
      return;
    }

    pending.resolve(message.result);
  }

  private handleNotification(notification: ServerNotification): void {
    for (const listener of this.notificationListeners) {
      listener(notification);
    }
    for (const listener of this.notificationListenersByMethod.get(notification.method) ?? []) {
      listener(notification);
    }
  }

  private async handleServerRequest(request: { id: RpcId; method: string; params?: unknown }): Promise<void> {
    const responder = this.createResponder(request.id);
    const handlers = [
      ...(this.serverRequestHandlers.get(request.method) ?? []),
      ...this.anyServerRequestHandlers,
    ];

    for (const handler of handlers) {
      try {
        const claimed = await handler(request as ServerRequest, responder);
        if (claimed === true || responder.responded) {
          return;
        }
      } catch (error) {
        responder.reject({
          code: -32603,
          message: toError(error).message,
        });
        return;
      }
    }

    responder.reject((this.options.unhandledServerRequestError ?? defaultUnhandledRequestError)(request));
  }

  private createResponder(id: RpcId): UntypedCodexServerRequestResponder {
    let responded = false;
    return {
      get responded() {
        return responded;
      },
      resolve: (result) => {
        if (responded) {
          return;
        }
        responded = true;
        this.transport.send({ id, result });
      },
      reject: (error) => {
        if (responded) {
          return;
        }
        responded = true;
        this.transport.send({ id, error: normalizeRpcError(error) });
      },
    };
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleTransportError(error: Error): void {
    if (error instanceof RpcTransportProtocolError) {
      this.reportProtocolError(error);
      if (error.requestId !== undefined) {
        const pending = this.pending.get(error.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(error.requestId);
          pending.reject(error);
        }
      } else {
        this.rejectAll(error);
      }
      return;
    }
    this.started = false;
    this.initializePromise = null;
    this.unsubscribeTransport();
    this.rejectAll(error);
    for (const listener of this.disconnectListeners) listener(error);
  }

  private reportProtocolError(error: Error): void {
    this.options.onProtocolError?.(error);
  }
}

function normalizeRpcError(error: Error | RpcError | string): RpcError {
  if (typeof error === 'string') {
    return { code: -32603, message: error };
  }
  if (error instanceof Error) {
    return { code: -32603, message: error.message };
  }
  return error;
}

function isRpcId(value: unknown): value is RpcId {
  return typeof value === 'number' || typeof value === 'string';
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
