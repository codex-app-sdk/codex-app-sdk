import { describe, expect, it, vi } from 'vitest';
import {
  createCodexSurfaceRendererApi,
  registerCodexSurfaceIpc,
  type IpcMainPort,
  type IpcRendererPort,
} from '../src/electron';
import type { CodexSurfaceSnapshot } from '../src/surface';

const snapshot: CodexSurfaceSnapshot = {
  status: 'ready',
  conversations: [],
  activeConversationId: null,
  messages: [],
  approvals: [],
  busy: false,
  error: null,
};

describe('Codex surface Electron bridge', () => {
  it('registers the complete main-process surface and forwards state changes', async () => {
    const main = new FakeMainPort();
    const sender = { send: vi.fn() };
    let stateListener: ((value: CodexSurfaceSnapshot) => void) | undefined;
    const unsubscribeState = vi.fn();
    const surface = {
      connect: vi.fn(async () => snapshot),
      createConversation: vi.fn(async () => snapshot),
      getSnapshot: vi.fn(() => snapshot),
      interrupt: vi.fn(async () => snapshot),
      refreshConversations: vi.fn(async () => snapshot),
      resolveApproval: vi.fn(async () => snapshot),
      selectConversation: vi.fn(async () => snapshot),
      sendMessage: vi.fn(async () => snapshot),
      onStateChange: vi.fn((listener: (value: CodexSurfaceSnapshot) => void) => {
        stateListener = listener;
        return unsubscribeState;
      }),
    };

    const dispose = registerCodexSurfaceIpc(main, sender, surface);
    expect([...main.handlers.keys()].sort()).toStrictEqual([
      'codex-surface:connect',
      'codex-surface:create-conversation',
      'codex-surface:get-snapshot',
      'codex-surface:interrupt',
      'codex-surface:refresh-conversations',
      'codex-surface:resolve-approval',
      'codex-surface:select-conversation',
      'codex-surface:send-message',
    ]);
    await expect(main.call('codex-surface:connect')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:create-conversation', {
      approvalMode: 'ask',
      permissionMode: 'workspace-write',
    })).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:get-snapshot')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:interrupt')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:refresh-conversations')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:resolve-approval', 'approval-1', 'approve', 'session')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:select-conversation', 'thread-1')).resolves.toBe(snapshot);
    await expect(main.call('codex-surface:send-message', 'Hello', { model: 'gpt-5' })).resolves.toBe(snapshot);
    stateListener?.(snapshot);
    expect(surface.connect).toHaveBeenCalledOnce();
    expect(surface.createConversation).toHaveBeenCalledWith({
      approvalMode: 'ask',
      permissionMode: 'workspace-write',
    });
    expect(surface.getSnapshot).toHaveBeenCalledOnce();
    expect(surface.interrupt).toHaveBeenCalledOnce();
    expect(surface.refreshConversations).toHaveBeenCalledOnce();
    expect(surface.resolveApproval).toHaveBeenCalledWith('approval-1', 'approve', 'session');
    expect(surface.selectConversation).toHaveBeenCalledWith('thread-1');
    expect(surface.sendMessage).toHaveBeenCalledWith('Hello', { model: 'gpt-5' });
    expect(sender.send).toHaveBeenCalledWith('codex-surface:state-changed', snapshot);
    dispose();
    expect(unsubscribeState).toHaveBeenCalledOnce();
    expect(main.handlers.size).toBe(0);
  });

  it('provides a renderer API with no raw channel or protocol knowledge', async () => {
    const renderer = new FakeRendererPort();
    const api = createCodexSurfaceRendererApi(renderer);
    const listener = vi.fn();
    const unsubscribe = api.onStateChange(listener);

    await api.connect();
    await api.createConversation({ permissionMode: 'workspace-write' });
    await api.refreshConversations();
    await api.resolveApproval('approval-1', 'approve', 'once');
    await api.selectConversation('thread-2');
    await api.sendMessage('Build it', { model: 'gpt-5' });
    await api.interrupt();
    await api.getSnapshot();
    renderer.emit('codex-surface:state-changed', snapshot);
    unsubscribe();
    renderer.emit('codex-surface:state-changed', { ...snapshot, busy: true });

    expect(renderer.invoke.mock.calls).toStrictEqual([
      ['codex-surface:connect'],
      ['codex-surface:create-conversation', { permissionMode: 'workspace-write' }],
      ['codex-surface:refresh-conversations'],
      ['codex-surface:resolve-approval', 'approval-1', 'approve', 'once'],
      ['codex-surface:select-conversation', 'thread-2'],
      ['codex-surface:send-message', 'Build it', { model: 'gpt-5' }],
      ['codex-surface:interrupt'],
      ['codex-surface:get-snapshot'],
    ]);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(snapshot);
  });
});

class FakeMainPort implements IpcMainPort {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, handler);
  }
  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }
  async call(channel: string, ...args: unknown[]): Promise<unknown> {
    return this.handlers.get(channel)?.({}, ...args);
  }
}

class FakeRendererPort implements IpcRendererPort {
  readonly invoke = vi.fn(async (_channel: string, ..._args: unknown[]) => snapshot);
  private readonly listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>();
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void {
    const listeners = this.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void {
    this.listeners.get(channel)?.delete(listener);
  }
  emit(channel: string, value: unknown): void {
    for (const listener of this.listeners.get(channel) ?? []) listener({}, value);
  }
}
