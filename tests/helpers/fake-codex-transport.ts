import { vi } from 'vitest';
import type { RpcMessage, RpcTransport } from '../../packages/backend/src/codex';

export class FakeCodexTransport implements RpcTransport {
  readonly sent: RpcMessage[] = [];
  readonly close = vi.fn(async () => undefined);
  readonly start = vi.fn(async () => undefined);
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  constructor(
    private readonly responses: Record<string, (params: unknown) => unknown> = {},
    private readonly fallback: (method: string, params: unknown) => unknown = basicSurfaceResponse,
  ) {}

  send(message: RpcMessage): void {
    this.sent.push(message);
    if (!('id' in message) || !('method' in message)) return;
    const params = 'params' in message ? message.params : undefined;
    try {
      const response = this.responses[message.method]?.(params) ?? this.fallback(message.method, params);
      void Promise.resolve(response).then(
        (result) => this.emit({ id: message.id, result }),
        (error: unknown) => this.emit({
          id: message.id,
          error: { code: -1, message: error instanceof Error ? error.message : String(error) },
        }),
      );
    } catch (error) {
      queueMicrotask(() => this.emit({
        id: message.id,
        error: { code: -1, message: error instanceof Error ? error.message : String(error) },
      }));
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

  emit(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  fail(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

export function lastRequest(transport: FakeCodexTransport, method: string): RpcMessage | undefined {
  for (let index = transport.sent.length - 1; index >= 0; index -= 1) {
    const message = transport.sent[index];
    if (message && 'method' in message && message.method === method) return message;
  }
  return undefined;
}

function basicSurfaceResponse(method: string): unknown {
  switch (method) {
    case 'initialize': return { userAgent: 'test' };
    case 'account/read': return {
      account: { type: 'chatgpt', email: 'test@example.test', planType: 'pro' },
      requiresOpenaiAuth: true,
    };
    case 'model/list': return { data: [], nextCursor: null };
    case 'skills/list': return { data: [{ cwd: '/tmp/project', skills: [], errors: [] }] };
    case 'plugin/installed': return { marketplaces: [], marketplaceLoadErrors: [] };
    case 'permissionProfile/list': return { data: [], nextCursor: null };
    case 'configRequirements/read': return { requirements: null };
    case 'thread/list': return { data: [], nextCursor: null };
    default: return {};
  }
}
