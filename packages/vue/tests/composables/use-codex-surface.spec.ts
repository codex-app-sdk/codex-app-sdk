import { effectScope, nextTick } from 'vue';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type {
  CodexSurfaceEvent,
  CodexSurfaceRendererApi,
  CodexSurfaceSnapshot,
  CreateCodexRendererConversationOptions,
} from '@codex-app-sdk/core/surface';
import { useCodexSurface } from '../../src';

describe('useCodexSurface', () => {
  it('starts with the exact idle state without registering disposal outside a scope', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const surface = useCodexSurface(fakeApi(() => vi.fn()));

    expect(surface.state).toEqual(idleSnapshot);
    expect([...surface.answeredClientRequestIds]).toStrictEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps Vue state synchronized with actions and pushed snapshots', async () => {
    let listener: ((snapshot: CodexSurfaceSnapshot) => void) | undefined;
    const unsubscribe = vi.fn();
    const api = fakeApi((next) => { listener = next; return unsubscribe; });
    const scope = effectScope();
    const surface = scope.run(() => useCodexSurface(api))!;

    await surface.connect();
    expect(surface.state.status).toBe('ready');
    listener?.({ ...readySnapshot, answeredClientRequestIds: ['pushed-request'], busy: true });
    await nextTick();
    expect(surface.state.busy).toBe(true);
    expect(surface.answeredClientRequestIds.has('pushed-request')).toBe(true);

    const conversationOptions = {
      approvalPreset: 'ask-for-approval' as const,
      model: 'gpt-5',
      reasoningEffort: 'high',
    };
    expectTypeOf<Parameters<typeof surface.createConversation>[0]>()
      .toEqualTypeOf<CreateCodexRendererConversationOptions | undefined>();
    if (false) {
      // @ts-expect-error Renderer code cannot override app-server cwd or host policy.
      void surface.createConversation({ cwd: '/tmp/sdk-project' });
    }
    await surface.archiveConversation('thread-archive');
    await surface.cancelLogin('login-1');
    await surface.createConversation(conversationOptions);
    await surface.compactConversation();
    await surface.deleteConversation('thread-delete');
    await surface.deleteTurn('turn-2');
    await surface.deleteQueuedPrompt('queued-1');
    await surface.updateQueuedPrompt('queued-2', 'Edited queue');
    await surface.editTurn('turn-1', 'Replacement');
    await surface.forkTurn('turn-4');
    await expect(surface.readConversationHistory('thread-1')).resolves.toStrictEqual({
      conversationId: 'thread-1', messages: [], threadStatus: null,
    });
    await surface.renameConversation('Renamed');
    await surface.selectConversation('thread-1');
    await surface.sendMessage('Hello', { model: 'gpt-5-mini' });
    await surface.startReview({ target: { type: 'uncommittedChanges' } });
    await surface.steerMessage('Keep going', {
      attachments: [{ type: 'file', reference: 'attachment:notes' }],
    });
    await surface.unarchiveConversation('thread-unarchive');
    await surface.updateConversationSettings({ modelId: 'gpt-5', planMode: true });
    await surface.interrupt();
    await surface.logout();
    await surface.refreshAccount();
    await expect(surface.startChatGptDeviceCodeLogin()).resolves.toStrictEqual({
      loginId: 'device-login-1',
      verificationUrl: 'https://auth.example.test/device',
      userCode: 'ABCD-EFGH',
    });
    await expect(surface.startChatGptLogin()).resolves.toStrictEqual({
      loginId: 'login-1', authUrl: 'https://auth.example.test/login',
    });
    await surface.refreshConversations();
    await surface.respondToClientRequest({ id: 'question-1', payload: { answers: {} } });
    expect(surface.answeredClientRequestIds.has('question-1')).toBe(true);
    expectTypeOf(surface.answeredClientRequestIds).toEqualTypeOf<ReadonlySet<string>>();
    await surface.resolveApproval('approval-1', 'approve', 'session');
    await surface.retryTurn('turn-3');
    await surface.steerQueuedPrompt('queued-2', 'Edited steer');

    expect(api.onStateChange).toHaveBeenCalledOnce();
    expect(api.archiveConversation).toHaveBeenCalledWith('thread-archive');
    expect(api.cancelLogin).toHaveBeenCalledWith('login-1');
    expect(api.createConversation).toHaveBeenCalledWith(conversationOptions);
    expect(api.compactConversation).toHaveBeenCalledWith();
    expect(api.deleteConversation).toHaveBeenCalledWith('thread-delete');
    expect(api.deleteTurn).toHaveBeenCalledWith('turn-2');
    expect(api.deleteQueuedPrompt).toHaveBeenCalledWith('queued-1');
    expect(api.updateQueuedPrompt).toHaveBeenCalledWith('queued-2', 'Edited queue');
    expect(api.editTurn).toHaveBeenCalledWith('turn-1', 'Replacement');
    expect(api.forkTurn).toHaveBeenCalledWith('turn-4');
    expect(api.readConversationHistory).toHaveBeenCalledWith('thread-1');
    expect(api.renameConversation).toHaveBeenCalledWith('Renamed');
    expect(api.selectConversation).toHaveBeenCalledWith('thread-1');
    expect(api.sendMessage).toHaveBeenCalledWith('Hello', { model: 'gpt-5-mini' });
    expect(api.startReview).toHaveBeenCalledWith({ target: { type: 'uncommittedChanges' } });
    expect(api.steerMessage).toHaveBeenCalledWith(
      'Keep going',
      { attachments: [{ type: 'file', reference: 'attachment:notes' }] },
    );
    expect(api.unarchiveConversation).toHaveBeenCalledWith('thread-unarchive');
    expect(api.updateConversationSettings).toHaveBeenCalledWith({ modelId: 'gpt-5', planMode: true });
    expect(api.interrupt).toHaveBeenCalledWith();
    expect(api.logout).toHaveBeenCalledWith();
    expect(api.refreshAccount).toHaveBeenCalledWith();
    expect(api.startChatGptDeviceCodeLogin).toHaveBeenCalledWith();
    expect(api.startChatGptLogin).toHaveBeenCalledWith();
    expect(api.refreshConversations).toHaveBeenCalledWith();
    expect(api.respondToClientRequest).toHaveBeenCalledWith({ id: 'question-1', payload: { answers: {} } });
    expect(api.resolveApproval).toHaveBeenCalledWith('approval-1', 'approve', 'session');
    expect(api.retryTurn).toHaveBeenCalledWith('turn-3');
    expect(api.steerQueuedPrompt).toHaveBeenCalledWith('queued-2', 'Edited steer');
    scope.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('fans out events, supports listener removal, and releases every subscription with its scope', () => {
    let pushEvent: ((event: CodexSurfaceEvent) => void) | undefined;
    const unsubscribeState = vi.fn();
    const unsubscribeEvents = vi.fn();
    const api = fakeApi(
      () => unsubscribeState,
      (listener) => {
        pushEvent = listener;
        return unsubscribeEvents;
      },
    );
    const scope = effectScope();
    const surface = scope.run(() => useCodexSurface(api))!;
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const stopFirst = surface.onEvent(firstListener);
    surface.onEvent(secondListener);
    const readyEvent: CodexSurfaceEvent = {
      seq: 1,
      occurredAt: '2026-09-04T00:00:00.000Z',
      origin: 'notification',
      type: 'surface.statusChanged',
      payload: { status: 'ready', error: null },
    };

    pushEvent?.(readyEvent);
    expect(surface.lastEvent.value).toStrictEqual(readyEvent);
    expect(firstListener).toHaveBeenCalledExactlyOnceWith(readyEvent);
    expect(secondListener).toHaveBeenCalledExactlyOnceWith(readyEvent);

    stopFirst();
    const disconnectedEvent: CodexSurfaceEvent = {
      seq: 2,
      occurredAt: '2026-09-04T00:00:01.000Z',
      origin: 'notification',
      type: 'surface.statusChanged',
      payload: { status: 'error', error: 'socket closed' },
    };
    pushEvent?.(disconnectedEvent);
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(2);
    expect(surface.lastEvent.value).toStrictEqual(disconnectedEvent);

    scope.stop();
    expect(unsubscribeEvents).toHaveBeenCalledOnce();
    expect(unsubscribeState).toHaveBeenCalledOnce();
    pushEvent?.(readyEvent);
    expect(secondListener).toHaveBeenCalledTimes(2);
  });

  it('replaces pushed answered-request ids and clears them as soon as reconnect begins', async () => {
    let pushState: ((snapshot: CodexSurfaceSnapshot) => void) | undefined;
    let resolveConnect: ((snapshot: CodexSurfaceSnapshot) => void) | undefined;
    const api = fakeApi((listener) => {
      pushState = listener;
      return vi.fn();
    });
    vi.mocked(api.connect).mockImplementationOnce(() => new Promise((resolve) => {
      resolveConnect = resolve;
    }));
    const surface = useCodexSurface(api);

    pushState?.({ ...readySnapshot, answeredClientRequestIds: ['old-request'] });
    pushState?.({ ...readySnapshot, answeredClientRequestIds: ['current-request'] });
    expect([...surface.answeredClientRequestIds]).toStrictEqual(['current-request']);

    const reconnect = surface.connect();
    expect([...surface.answeredClientRequestIds]).toStrictEqual([]);
    resolveConnect?.(readySnapshot);
    await expect(reconnect).resolves.toBe(readySnapshot);
  });

  it('forwards goal, catalog, and prompt-history operations with their exact results', async () => {
    const api = fakeApi(() => vi.fn());
    const clearSnapshot = { ...readySnapshot, error: 'goal cleared' };
    const goalSnapshot = { ...readySnapshot, error: 'goal set' };
    vi.mocked(api.clearGoal).mockResolvedValueOnce(clearSnapshot);
    vi.mocked(api.setGoal).mockResolvedValueOnce(goalSnapshot);
    vi.mocked(api.listConversations).mockResolvedValueOnce([]);
    vi.mocked(api.listModels).mockResolvedValueOnce([]);
    const surface = useCodexSurface(api);

    await expect(surface.clearGoal()).resolves.toBe(clearSnapshot);
    expect(surface.state.error).toBe('goal cleared');
    await expect(surface.setGoal('Harden the SDK', 4_096)).resolves.toBe(goalSnapshot);
    expect(surface.state.error).toBe('goal set');
    await expect(surface.listConversations({ archived: true, limit: 7 })).resolves.toStrictEqual([]);
    await expect(surface.listModels({ includeHidden: true, forceReload: true })).resolves.toStrictEqual([]);
    await expect(surface.readConversationPromptHistory('thread-prompts')).resolves.toStrictEqual({
      conversationId: 'thread-prompts',
      prompts: [],
    });

    expect(api.clearGoal).toHaveBeenCalledWith();
    expect(api.setGoal).toHaveBeenCalledWith('Harden the SDK', 4_096);
    expect(api.listConversations).toHaveBeenCalledWith({ archived: true, limit: 7 });
    expect(api.listModels).toHaveBeenCalledWith({ includeHidden: true, forceReload: true });
    expect(api.readConversationPromptHistory).toHaveBeenCalledWith('thread-prompts');
  });

  it('delegates optional history paging and reports the exact unsupported error', async () => {
    const api = fakeApi(() => vi.fn());
    api.loadOlderConversationHistory = vi.fn(async (conversationId = 'thread-1') => ({
      conversationId,
      messages: [],
      hasOlder: false,
    }));
    const surface = useCodexSurface(api);

    await expect(surface.loadOlderConversationHistory('thread-page')).resolves.toStrictEqual({
      conversationId: 'thread-page',
      messages: [],
      hasOlder: false,
    });
    expect(api.loadOlderConversationHistory).toHaveBeenCalledWith('thread-page');

    const unsupported = useCodexSurface(fakeApi(() => vi.fn()));
    await expect(unsupported.loadOlderConversationHistory('thread-page'))
      .rejects.toThrow('Conversation history paging is not available.');
  });

  it('marks client requests before dispatch and clears the local guard on reconnect', async () => {
    const api = fakeApi(() => vi.fn());
    vi.mocked(api.respondToClientRequest).mockRejectedValueOnce(new Error('disconnected'));
    const surface = useCodexSurface(api);

    await expect(surface.respondToClientRequest({
      id: 'approval-before-dispatch',
      payload: { decision: 'deny' },
    })).rejects.toThrow('disconnected');
    expect(surface.answeredClientRequestIds.has('approval-before-dispatch')).toBe(true);

    await surface.connect();
    expect(surface.answeredClientRequestIds.size).toBe(0);
  });

  it('does not overwrite a newer pushed snapshot with an older action response', async () => {
    let listener: ((snapshot: CodexSurfaceSnapshot) => void) | undefined;
    let resolveAction: ((snapshot: CodexSurfaceSnapshot) => void) | undefined;
    const api = fakeApi((next) => {
      listener = next;
      return vi.fn();
    });
    vi.mocked(api.sendMessage).mockImplementationOnce(() => new Promise((resolve) => {
      resolveAction = resolve;
    }));
    const surface = useCodexSurface(api);

    const pendingAction = surface.sendMessage('Keep the pushed state');
    const pushedSnapshot = {
      ...readySnapshot,
      answeredClientRequestIds: ['newer-request'],
      busy: true,
      error: 'newer pushed state',
    };
    listener?.(pushedSnapshot);
    resolveAction?.({ ...readySnapshot, busy: false, error: null });

    await expect(pendingAction).resolves.toMatchObject({ busy: false, error: null });
    expect(surface.state.busy).toBe(true);
    expect(surface.state.error).toBe('newer pushed state');
    expect(surface.answeredClientRequestIds.has('newer-request')).toBe(true);
  });
});

const readySnapshot: CodexSurfaceSnapshot = {
  status: 'ready',
  authentication: {
    status: 'loaded',
    account: { type: 'chatgpt', email: 'test@example.test', planType: 'pro' },
    requiresOpenaiAuth: true,
    error: null,
    login: { status: 'idle', loginId: null, authUrl: null, error: null },
  },
  conversations: [],
  activeConversationId: null,
  activeTurnId: null,
  turns: [],
  messages: [],
  clientRequests: [],
  answeredClientRequestIds: [],
  approvals: [],
  models: [],
  modelCatalogStatus: 'loaded',
  skills: [],
  skillCatalogStatus: 'loaded',
  plugins: [],
  pluginCatalogStatus: 'loaded',
  permissionProfiles: [],
  approvalPresets: [],
  approvalPreset: null,
  selectedModelId: null,
  selectedReasoningEffort: null,
  planMode: false,
  contextUsage: null,
  goal: null,
  turnGitDiff: null,
  threadStatus: null,
  rateLimits: null,
  queuedPrompts: [],
  busy: false,
  historyLoading: false,
  error: null,
};

const idleSnapshot: CodexSurfaceSnapshot = {
  status: 'idle',
  authentication: {
    status: 'notLoaded',
    account: null,
    requiresOpenaiAuth: null,
    error: null,
    login: { status: 'idle', loginId: null, authUrl: null, error: null },
  },
  conversations: [],
  activeConversationId: null,
  activeTurnId: null,
  turns: [],
  messages: [],
  clientRequests: [],
  answeredClientRequestIds: [],
  approvals: [],
  models: [],
  modelCatalogStatus: 'notLoaded',
  skills: [],
  skillCatalogStatus: 'notLoaded',
  plugins: [],
  pluginCatalogStatus: 'notLoaded',
  permissionProfiles: [],
  approvalPresets: [],
  approvalPreset: null,
  selectedModelId: null,
  selectedReasoningEffort: null,
  selectedServiceTier: null,
  planMode: false,
  contextUsage: null,
  goal: null,
  turnGitDiff: null,
  threadStatus: null,
  rateLimits: null,
  queuedPrompts: [],
  busy: false,
  historyLoading: false,
  error: null,
};

function fakeApi(
  subscribe: (listener: (snapshot: CodexSurfaceSnapshot) => void) => () => void,
  subscribeEvents: (listener: (event: CodexSurfaceEvent) => void) => () => void = () => () => undefined,
): CodexSurfaceRendererApi & { [key: string]: ReturnType<typeof vi.fn> | unknown } {
  return {
    archiveConversation: vi.fn(async () => readySnapshot),
    cancelLogin: vi.fn(async () => readySnapshot),
    clearGoal: vi.fn(async () => readySnapshot),
    compactConversation: vi.fn(async () => readySnapshot),
    connect: vi.fn(async () => readySnapshot),
    createConversation: vi.fn(async () => readySnapshot),
    deleteConversation: vi.fn(async () => readySnapshot),
    deleteTurn: vi.fn(async () => readySnapshot),
    deleteQueuedPrompt: vi.fn(async () => readySnapshot),
    updateQueuedPrompt: vi.fn(async () => readySnapshot),
    editTurn: vi.fn(async () => readySnapshot),
    forkTurn: vi.fn(async () => readySnapshot),
    getSnapshot: vi.fn(async () => readySnapshot),
    interrupt: vi.fn(async () => readySnapshot),
    listConversations: vi.fn(async () => []),
    listModels: vi.fn(async () => []),
    logout: vi.fn(async () => readySnapshot),
    onEvent: vi.fn(subscribeEvents),
    onStateChange: vi.fn(subscribe),
    readConversationHistory: vi.fn(async (conversationId = 'thread-1') => ({
      conversationId,
      messages: [],
      threadStatus: null,
    })),
    readConversationPromptHistory: vi.fn(async (conversationId = 'thread-1') => ({
      conversationId,
      prompts: [],
    })),
    refreshAccount: vi.fn(async () => readySnapshot),
    refreshConversations: vi.fn(async () => readySnapshot),
    renameConversation: vi.fn(async () => readySnapshot),
    respondToClientRequest: vi.fn(async (response) => ({
      ...readySnapshot,
      answeredClientRequestIds: [response.id],
    })),
    resolveApproval: vi.fn(async () => readySnapshot),
    retryTurn: vi.fn(async () => readySnapshot),
    setGoal: vi.fn(async () => readySnapshot),
    selectConversation: vi.fn(async () => readySnapshot),
    sendMessage: vi.fn(async () => readySnapshot),
    startReview: vi.fn(async () => readySnapshot),
    startChatGptDeviceCodeLogin: vi.fn(async () => ({
      loginId: 'device-login-1',
      verificationUrl: 'https://auth.example.test/device',
      userCode: 'ABCD-EFGH',
    })),
    startChatGptLogin: vi.fn(async () => ({
      loginId: 'login-1', authUrl: 'https://auth.example.test/login',
    })),
    steerMessage: vi.fn(async () => readySnapshot),
    steerQueuedPrompt: vi.fn(async () => readySnapshot),
    unarchiveConversation: vi.fn(async () => readySnapshot),
    updateConversationSettings: vi.fn(async () => readySnapshot),
  };
}
