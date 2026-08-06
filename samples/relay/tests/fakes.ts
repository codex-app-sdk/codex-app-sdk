import { vi } from 'vitest';
import type {
  CodexSurfaceEvent,
  CodexSurfaceRendererApi,
  CodexSurfaceSnapshot,
  SendCodexMessageOptions,
} from 'codex-app-sdk/surface';
import { relaySnapshot, createRelaySeedState } from '../src/shared/relay-contracts';

export function surfaceSnapshot(overrides: Partial<CodexSurfaceSnapshot> = {}): CodexSurfaceSnapshot {
  return {
    status: 'ready',
    authentication: {
      status: 'loaded',
      account: { type: 'chatgpt', email: 'dispatcher@example.com', planType: 'business' },
      requiresOpenaiAuth: true,
      error: null,
      login: { status: 'idle', loginId: null, authUrl: null, error: null },
    },
    conversations: [{
      id: 'thread-relay',
      title: 'Relay dispatch desk',
      preview: 'Investigating SHP-4827',
      cwd: '/tmp/relay-workspace',
      status: 'idle',
      turnCount: 1,
      createdAt: '2026-07-18T10:00:00.000Z',
      updatedAt: '2026-07-18T10:00:00.000Z',
    }],
    activeConversationId: 'thread-relay',
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
    ...overrides,
  };
}

export function relayOperationsSnapshot() {
  return relaySnapshot(createRelaySeedState());
}

export function fakeSurfaceApi(snapshot = surfaceSnapshot()) {
  let stateListener: ((nextSnapshot: CodexSurfaceSnapshot) => void) | undefined;
  let eventListener: ((event: CodexSurfaceEvent) => void) | undefined;
  const api = {
    archiveConversation: vi.fn(async () => snapshot),
    cancelLogin: vi.fn(async () => snapshot),
    clearGoal: vi.fn(async () => snapshot),
    compactConversation: vi.fn(async () => snapshot),
    connect: vi.fn(async () => snapshot),
    createConversation: vi.fn(async () => surfaceSnapshot()),
    deleteConversation: vi.fn(async () => snapshot),
    deleteMessage: vi.fn(async () => snapshot),
    deleteQueuedPrompt: vi.fn(async () => snapshot),
    editMessage: vi.fn(async () => snapshot),
    forkMessage: vi.fn(async () => snapshot),
    getSnapshot: vi.fn(async () => snapshot),
    interrupt: vi.fn(async () => snapshot),
    listConversations: vi.fn(async () => snapshot.conversations),
    listModels: vi.fn(async () => snapshot.models),
    logout: vi.fn(async () => snapshot),
    onEvent: vi.fn((listener: (event: CodexSurfaceEvent) => void) => {
      eventListener = listener;
      return vi.fn();
    }),
    onStateChange: vi.fn((listener: (nextSnapshot: CodexSurfaceSnapshot) => void) => {
      stateListener = listener;
      return vi.fn();
    }),
    readConversationHistory: vi.fn(async (conversationId = snapshot.activeConversationId ?? 'thread-relay') => ({
      conversationId,
      messages: [],
      threadStatus: null,
    })),
    refreshAccount: vi.fn(async () => snapshot),
    refreshConversations: vi.fn(async () => snapshot),
    renameConversation: vi.fn(async () => snapshot),
    respondToClientRequest: vi.fn(async () => snapshot),
    resolveApproval: vi.fn(async () => snapshot),
    retryMessage: vi.fn(async () => snapshot),
    setGoal: vi.fn(async () => snapshot),
    selectConversation: vi.fn(async () => snapshot),
    sendMessage: vi.fn(async (_prompt: string, _options?: SendCodexMessageOptions) => snapshot),
    startReview: vi.fn(async () => snapshot),
    startChatGptLogin: vi.fn(async () => ({
      loginId: 'login-relay',
      authUrl: 'https://auth.example.test/relay',
    })),
    steerMessage: vi.fn(async () => snapshot),
    steerQueuedPrompt: vi.fn(async () => snapshot),
    unarchiveConversation: vi.fn(async () => snapshot),
    updateConversationSettings: vi.fn(async () => snapshot),
  } satisfies CodexSurfaceRendererApi;
  return Object.assign(api, {
    pushEvent(event: CodexSurfaceEvent) {
      eventListener?.(event);
    },
    pushSnapshot(nextSnapshot: CodexSurfaceSnapshot) {
      stateListener?.(nextSnapshot);
    },
  });
}
