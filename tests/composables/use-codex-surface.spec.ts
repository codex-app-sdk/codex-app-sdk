import { effectScope, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { CodexSurfaceApi, CodexSurfaceSnapshot } from '../../src/surface';
import { useCodexSurface } from '../../src/vue';

describe('useCodexSurface', () => {
  it('keeps Vue state synchronized with actions and pushed snapshots', async () => {
    let listener: ((snapshot: CodexSurfaceSnapshot) => void) | undefined;
    const unsubscribe = vi.fn();
    const api = fakeApi((next) => { listener = next; return unsubscribe; });
    const scope = effectScope();
    const surface = scope.run(() => useCodexSurface(api))!;

    await surface.connect();
    expect(surface.state.status).toBe('ready');
    listener?.({ ...readySnapshot, busy: true });
    await nextTick();
    expect(surface.state.busy).toBe(true);

    await surface.createConversation({ permissionMode: 'workspace-write' });
    await surface.selectConversation('thread-1');
    await surface.sendMessage('Hello');
    await surface.interrupt();
    await surface.refreshConversations();
    expect(api.sendMessage).toHaveBeenCalledWith('Hello', undefined);
    scope.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

const readySnapshot: CodexSurfaceSnapshot = {
  status: 'ready',
  conversations: [],
  activeConversationId: null,
  messages: [],
  busy: false,
  error: null,
};

function fakeApi(
  subscribe: (listener: (snapshot: CodexSurfaceSnapshot) => void) => () => void,
): CodexSurfaceApi & { [key: string]: ReturnType<typeof vi.fn> | unknown } {
  return {
    connect: vi.fn(async () => readySnapshot),
    createConversation: vi.fn(async () => readySnapshot),
    getSnapshot: vi.fn(async () => readySnapshot),
    interrupt: vi.fn(async () => readySnapshot),
    onStateChange: vi.fn(subscribe),
    refreshConversations: vi.fn(async () => readySnapshot),
    selectConversation: vi.fn(async () => readySnapshot),
    sendMessage: vi.fn(async () => readySnapshot),
  };
}
