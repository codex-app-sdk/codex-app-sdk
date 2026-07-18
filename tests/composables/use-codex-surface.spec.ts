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

    const conversationOptions = {
      approvalMode: 'ask' as const,
      cwd: '/tmp/sdk-project',
      model: 'gpt-5',
      permissionMode: 'workspace-write' as const,
    };
    await surface.createConversation(conversationOptions);
    await surface.deleteMessage(2);
    await surface.deleteQueuedPrompt('queued-1');
    await surface.editMessage(1, 'Replacement');
    await surface.selectConversation('thread-1');
    await surface.sendMessage('Hello', { model: 'gpt-5-mini' });
    await surface.steerMessage('Keep going');
    await surface.updateConversationSettings({ modelId: 'gpt-5', planMode: true });
    await surface.interrupt();
    await surface.refreshConversations();
    await surface.respondToClientRequest({ id: 'question-1', payload: { answers: {} } });
    await surface.resolveApproval('approval-1', 'approve', 'session');
    await surface.retryMessage(3);
    await surface.steerQueuedPrompt('queued-2');

    expect(api.onStateChange).toHaveBeenCalledOnce();
    expect(api.createConversation).toHaveBeenCalledWith(conversationOptions);
    expect(api.deleteMessage).toHaveBeenCalledWith(2);
    expect(api.deleteQueuedPrompt).toHaveBeenCalledWith('queued-1');
    expect(api.editMessage).toHaveBeenCalledWith(1, 'Replacement');
    expect(api.selectConversation).toHaveBeenCalledWith('thread-1');
    expect(api.sendMessage).toHaveBeenCalledWith('Hello', { model: 'gpt-5-mini' });
    expect(api.steerMessage).toHaveBeenCalledWith('Keep going');
    expect(api.updateConversationSettings).toHaveBeenCalledWith({ modelId: 'gpt-5', planMode: true });
    expect(api.interrupt).toHaveBeenCalledWith();
    expect(api.refreshConversations).toHaveBeenCalledWith();
    expect(api.respondToClientRequest).toHaveBeenCalledWith({ id: 'question-1', payload: { answers: {} } });
    expect(api.resolveApproval).toHaveBeenCalledWith('approval-1', 'approve', 'session');
    expect(api.retryMessage).toHaveBeenCalledWith(3);
    expect(api.steerQueuedPrompt).toHaveBeenCalledWith('queued-2');
    scope.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

const readySnapshot: CodexSurfaceSnapshot = {
  status: 'ready',
  conversations: [],
  activeConversationId: null,
  messages: [],
  approvals: [],
  models: [],
  modelCatalogStatus: 'loaded',
  skills: [],
  skillCatalogStatus: 'loaded',
  permissionProfiles: [],
  approvalPresets: [],
  approvalPreset: null,
  selectedModelId: null,
  selectedReasoningEffort: null,
  planMode: false,
  contextUsage: null,
  goal: null,
  turnGitDiff: null,
  queuedPrompts: [],
  busy: false,
  error: null,
};

function fakeApi(
  subscribe: (listener: (snapshot: CodexSurfaceSnapshot) => void) => () => void,
): CodexSurfaceApi & { [key: string]: ReturnType<typeof vi.fn> | unknown } {
  return {
    clearGoal: vi.fn(async () => readySnapshot),
    connect: vi.fn(async () => readySnapshot),
    createConversation: vi.fn(async () => readySnapshot),
    deleteMessage: vi.fn(async () => readySnapshot),
    deleteQueuedPrompt: vi.fn(async () => readySnapshot),
    editMessage: vi.fn(async () => readySnapshot),
    getSnapshot: vi.fn(async () => readySnapshot),
    interrupt: vi.fn(async () => readySnapshot),
    onStateChange: vi.fn(subscribe),
    refreshConversations: vi.fn(async () => readySnapshot),
    respondToClientRequest: vi.fn(async () => readySnapshot),
    resolveApproval: vi.fn(async () => readySnapshot),
    retryMessage: vi.fn(async () => readySnapshot),
    setGoal: vi.fn(async () => readySnapshot),
    selectConversation: vi.fn(async () => readySnapshot),
    sendMessage: vi.fn(async () => readySnapshot),
    steerMessage: vi.fn(async () => readySnapshot),
    steerQueuedPrompt: vi.fn(async () => readySnapshot),
    updateConversationSettings: vi.fn(async () => readySnapshot),
  };
}
