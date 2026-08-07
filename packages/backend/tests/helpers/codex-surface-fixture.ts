import { vi } from 'vitest';
import type { RpcMessage, RpcTransport } from '../../src/codex';
import { CodexAppServerClient } from '../../src/codex';
import { CodexSurface } from '../../src/node';

export const generatedPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export class FakeTransport implements RpcTransport {
  readonly sent: RpcMessage[] = [];
  readonly close = vi.fn(async () => undefined);
  readonly start = vi.fn(async () => undefined);
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  constructor(private readonly responses: Record<string, (params: unknown) => unknown> = {}) {}

  send(message: RpcMessage): void {
    this.sent.push(message);
    if (!('id' in message) || !('method' in message)) return;
    const params = 'params' in message ? message.params : undefined;
    try {
      const response = this.responses[message.method]?.(params) ?? responseFor(message.method, params);
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

export function createSurface(): { surface: CodexSurface; transport: FakeTransport } {
  const transport = new FakeTransport();
  return {
    transport,
    surface: new CodexSurface({
      client: new CodexAppServerClient(transport),
      cwd: '/tmp/project',
    }),
  };
}

export function responseFor(method: string, params: unknown): unknown {
  switch (method) {
    case 'initialize': return { userAgent: 'test' };
    case 'account/read': return {
      account: { type: 'chatgpt', email: 'test@example.test', planType: 'pro' },
      requiresOpenaiAuth: true,
    };
    case 'model/list': return {
      data: [
        {
          id: 'gpt-5', model: 'gpt-5', upgrade: null, upgradeInfo: null, availabilityNux: null,
          displayName: 'GPT-5', description: 'Test model', hidden: false,
          supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
          defaultReasoningEffort: 'medium', inputModalities: ['text'], supportsPersonality: true,
          additionalSpeedTiers: [], serviceTiers: [{ id: 'priority', name: 'Priority', description: 'Fast mode' }], defaultServiceTier: null, isDefault: true,
        },
        {
          id: 'gpt-mini', model: 'gpt-mini-runtime', upgrade: null, upgradeInfo: null, availabilityNux: null,
          displayName: 'GPT Mini', description: 'Fast model', hidden: false,
          supportedReasoningEfforts: [
            { reasoningEffort: 'medium', description: 'Balanced' },
            { reasoningEffort: 'high', description: 'Deep' },
          ],
          defaultReasoningEffort: 'medium', inputModalities: ['text'], supportsPersonality: true,
          additionalSpeedTiers: [], serviceTiers: [{ id: 'priority', name: 'Priority', description: 'Fast mode' }], defaultServiceTier: null, isDefault: false,
        },
      ],
      nextCursor: null,
    };
    case 'skills/list': return { data: [{ cwd: '/tmp/project', skills: [], errors: [] }] };
    case 'plugin/installed': return { marketplaces: [], marketplaceLoadErrors: [] };
    case 'permissionProfile/list': return {
      data: [
        { id: ':read-only', description: null, allowed: true },
        { id: ':workspace', description: null, allowed: true },
        { id: ':danger-full-access', description: null, allowed: true },
      ],
      nextCursor: null,
    };
    case 'configRequirements/read': return { requirements: null };
    case 'thread/list': return { data: [thread('thread-existing', false)], nextCursor: null };
    case 'thread/turns/list': {
      const threadId = String((params as { threadId: string }).threadId);
      return {
        data: (thread(threadId, true).turns as unknown[]),
        nextCursor: null,
        backwardsCursor: null,
      };
    }
    case 'thread/resume': return resumeResponse(thread(String((params as { threadId: string }).threadId), true));
    case 'thread/start': return resumeResponse(thread('thread-new', false));
    case 'turn/start': return { turn: turn('turn-live', 'inProgress', []) };
    case 'turn/steer': return { turnId: 'turn-live' };
    case 'turn/interrupt': return {};
    case 'thread/compact/start': return {};
    case 'review/start': return { turn: turn('turn-review', 'inProgress', []), reviewThreadId: 'thread-existing' };
    case 'thread/rollback': return { thread: thread('thread-existing', false) };
    default: return {};
  }
}

export function thread(id: string, includeHistory: boolean): Record<string, unknown> {
  return {
    id,
    preview: id === 'thread-existing' ? 'Existing thread' : '',
    name: null,
    cwd: '/tmp/project',
    status: { type: 'idle' },
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_001,
    recencyAt: null,
    turns: includeHistory ? [turn('turn-history', 'completed', [
      { type: 'userMessage', id: 'user-history', clientId: null, content: [{ type: 'text', text: 'Hello', text_elements: [] }] },
      { type: 'agentMessage', id: 'agent-history', text: 'Hi there', phase: null, memoryCitation: null },
    ])] : [],
  };
}

export function turn(id: string, status: string, items: unknown[]): Record<string, unknown> {
  return { id, status, items, startedAt: 1_700_000_000, completedAt: null, error: null };
}

export function resumeResponse(value: Record<string, unknown>): Record<string, unknown> {
  const turns = Array.isArray(value.turns) ? value.turns : [];
  return {
    thread: { ...value, turns: [] },
    initialTurnsPage: { data: [...turns].reverse(), nextCursor: null, backwardsCursor: null },
    model: 'gpt-5',
    cwd: '/tmp/project',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: {
      type: 'workspaceWrite', writableRoots: ['/tmp/project'], networkAccess: false,
      excludeTmpdirEnvVar: false, excludeSlashTmp: false,
    },
    activePermissionProfile: { id: ':workspace', extends: null },
    reasoningEffort: 'medium',
  };
}

export function testModel(id: string, model: string, isDefault: boolean): Record<string, unknown> {
  return {
    id,
    model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: id,
    description: 'Test model',
    hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
    defaultReasoningEffort: 'medium',
    inputModalities: ['text'],
    supportsPersonality: true,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault,
  };
}

export function pluginSummary(
  id: string,
  name: string,
  pluginInterface: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    name,
    installed: true,
    enabled: true,
    interface: pluginInterface,
  };
}

export function threadSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cwd: '/tmp/project',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxPolicy: {
      type: 'workspaceWrite', writableRoots: ['/tmp/project'], networkAccess: false,
      excludeTmpdirEnvVar: false, excludeSlashTmp: false,
    },
    activePermissionProfile: { id: ':workspace', extends: null },
    model: 'gpt-5',
    modelProvider: 'openai',
    serviceTier: null,
    effort: 'medium',
    summary: null,
    collaborationMode: {
      mode: 'default',
      settings: { model: 'gpt-5', reasoning_effort: 'medium', developer_instructions: null },
    },
    multiAgentMode: 'explicitRequestOnly',
    personality: null,
    ...overrides,
  };
}

export function lastRequest(transport: FakeTransport, method: string): RpcMessage | undefined {
  for (let index = transport.sent.length - 1; index >= 0; index -= 1) {
    const message = transport.sent[index];
    if (message && 'method' in message && message.method === method) return message;
  }
  return undefined;
}

export function requestsFor(transport: FakeTransport, method: string): RpcMessage[] {
  return transport.sent.filter((message) => 'method' in message && message.method === method);
}

export function lastResponse(transport: FakeTransport, id: string | number): RpcMessage | undefined {
  for (let index = transport.sent.length - 1; index >= 0; index -= 1) {
    const message = transport.sent[index];
    if (message && 'id' in message && message.id === id && !('method' in message)) return message;
  }
  return undefined;
}

export function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
