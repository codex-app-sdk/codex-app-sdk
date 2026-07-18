export type RpcId = number | string;

export type RpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type RpcRequest = {
  id: RpcId;
  method: string;
  params?: unknown;
};

export type RpcNotification = {
  method: string;
  params?: unknown;
};

export type RpcSuccessResponse = {
  id: RpcId;
  result: unknown;
};

export type RpcErrorResponse = {
  id: RpcId;
  error: RpcError;
};

export type RpcMessage =
  | RpcRequest
  | RpcNotification
  | RpcSuccessResponse
  | RpcErrorResponse;

export interface RpcTransport {
  start(): Promise<void>;
  send(message: RpcMessage): void;
  close(): Promise<void>;
  onMessage(listener: (message: unknown) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
}

/** A malformed transport frame that does not imply the connection was lost. */
export class RpcTransportProtocolError extends Error {
  readonly requestId?: RpcId;

  constructor(message: string, options?: ErrorOptions & { requestId?: RpcId }) {
    super(message, options);
    this.name = 'RpcTransportProtocolError';
    this.requestId = options?.requestId;
  }
}

export class RpcRemoteError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(error: RpcError) {
    super(error.message);
    this.name = 'RpcRemoteError';
    this.code = error.code;
    this.data = error.data;
  }
}

export function isRpcError(value: unknown): value is RpcError {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.code === 'number' && typeof value.message === 'string';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
