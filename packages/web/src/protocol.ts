import type {
  CodexSurfaceBridgeOperation,
  CodexSurfaceBridgeOperationResult,
} from '@codex-app-sdk/core/surface-bridge';
import type {
  CodexSurfaceEvent,
  CodexSurfaceSnapshot,
} from '@codex-app-sdk/core/surface';

export const codexWebSocketProtocolVersion = 1 as const;

export type CodexWebSocketRequest = {
  version: typeof codexWebSocketProtocolVersion;
  type: 'request';
  id: string;
  operation: CodexSurfaceBridgeOperation;
  args: unknown[];
};

export type CodexWebSocketReady = {
  version: typeof codexWebSocketProtocolVersion;
  type: 'ready';
  snapshot: CodexSurfaceSnapshot;
};

export type CodexWebSocketSuccess<Name extends CodexSurfaceBridgeOperation = CodexSurfaceBridgeOperation> = {
  version: typeof codexWebSocketProtocolVersion;
  type: 'response';
  id: string;
  ok: true;
  result: CodexSurfaceBridgeOperationResult<Name>;
};

export type CodexWebSocketErrorPayload = {
  code: 'invalid_request' | 'operation_failed' | 'request_timeout' | 'transport_closed';
  message: string;
};

export type CodexWebSocketFailure = {
  version: typeof codexWebSocketProtocolVersion;
  type: 'response';
  id: string;
  ok: false;
  error: CodexWebSocketErrorPayload;
};

export type CodexWebSocketSnapshot = {
  version: typeof codexWebSocketProtocolVersion;
  type: 'snapshot';
  snapshot: CodexSurfaceSnapshot;
};

export type CodexWebSocketEvent = {
  version: typeof codexWebSocketProtocolVersion;
  type: 'event';
  event: CodexSurfaceEvent;
};

export type CodexWebSocketClientMessage = CodexWebSocketRequest;
export type CodexWebSocketServerMessage =
  | CodexWebSocketReady
  | CodexWebSocketSuccess
  | CodexWebSocketFailure
  | CodexWebSocketSnapshot
  | CodexWebSocketEvent;

export function encodeCodexWebSocketMessage(
  message: CodexWebSocketClientMessage | CodexWebSocketServerMessage,
): string {
  return JSON.stringify(message);
}
