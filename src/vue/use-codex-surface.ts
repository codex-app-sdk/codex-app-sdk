import { getCurrentScope, onScopeDispose, reactive, readonly, shallowRef } from 'vue';
import type {
  CodexConversationHistory,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceClientRequestResponse,
  CodexSurfaceEvent,
  CodexSurfaceRendererApi,
  CodexSurfaceSnapshot,
  CreateCodexRendererConversationOptions,
  ListCodexConversationsOptions,
  ListCodexModelsOptions,
  SendCodexMessageOptions,
  StartCodexReviewOptions,
  UpdateCodexConversationSettings,
} from '../surface/types';

const initialState: CodexSurfaceSnapshot = {
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

export function useCodexSurface(api: CodexSurfaceRendererApi) {
  const state = reactive<CodexSurfaceSnapshot>(structuredClone(initialState));
  const mutableAnsweredClientRequestIds = reactive(new Set<string>());
  const answeredClientRequestIds: ReadonlySet<string> = readonly(mutableAnsweredClientRequestIds);
  const lastEvent = shallowRef<CodexSurfaceEvent | null>(null);
  const eventListeners = new Set<(event: CodexSurfaceEvent) => void>();
  let pushedSnapshotVersion = 0;
  const apply = (snapshot: CodexSurfaceSnapshot) => {
    Object.assign(state, snapshot);
    mutableAnsweredClientRequestIds.clear();
    for (const requestId of snapshot.answeredClientRequestIds) {
      mutableAnsweredClientRequestIds.add(requestId);
    }
  };
  const unsubscribe = api.onStateChange((snapshot) => {
    pushedSnapshotVersion += 1;
    apply(snapshot);
  });
  const unsubscribeEvents = api.onEvent((event) => {
    lastEvent.value = event;
    for (const listener of eventListeners) listener(event);
  });
  if (getCurrentScope()) onScopeDispose(() => {
    unsubscribeEvents();
    unsubscribe();
    eventListeners.clear();
  });

  async function run(action: () => Promise<CodexSurfaceSnapshot>): Promise<CodexSurfaceSnapshot> {
    const versionBeforeAction = pushedSnapshotVersion;
    const snapshot = await action();
    if (pushedSnapshotVersion === versionBeforeAction) apply(snapshot);
    return snapshot;
  }

  return {
    state: readonly(state),
    lastEvent: readonly(lastEvent),
    answeredClientRequestIds,
    onEvent: (listener: (event: CodexSurfaceEvent) => void) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    archiveConversation: (conversationId: string) => run(() => api.archiveConversation(conversationId)),
    cancelLogin: (loginId?: string) => run(() => api.cancelLogin(loginId)),
    clearGoal: () => run(() => api.clearGoal()),
    compactConversation: () => run(() => api.compactConversation()),
    connect: () => {
      mutableAnsweredClientRequestIds.clear();
      return run(() => api.connect());
    },
    createConversation: (options?: CreateCodexRendererConversationOptions) => run(() => api.createConversation(options)),
    deleteConversation: (conversationId: string) => run(() => api.deleteConversation(conversationId)),
    deleteMessage: (index: number) => run(() => api.deleteMessage(index)),
    deleteQueuedPrompt: (promptId: string) => run(() => api.deleteQueuedPrompt(promptId)),
    editMessage: (index: number, content: string) => run(() => api.editMessage(index, content)),
    interrupt: () => run(() => api.interrupt()),
    listConversations: (options?: ListCodexConversationsOptions) => api.listConversations(options),
    listModels: (options?: ListCodexModelsOptions) => api.listModels(options),
    logout: () => run(() => api.logout()),
    readConversationHistory: (conversationId?: string): Promise<CodexConversationHistory> => (
      api.readConversationHistory(conversationId)
    ),
    refreshAccount: () => run(() => api.refreshAccount()),
    refreshConversations: () => run(() => api.refreshConversations()),
    renameConversation: (title: string) => run(() => api.renameConversation(title)),
    respondToClientRequest: (response: CodexSurfaceClientRequestResponse) => {
      mutableAnsweredClientRequestIds.add(response.id);
      return run(() => api.respondToClientRequest(response));
    },
    resolveApproval: (
      approvalId: string,
      decision: CodexSurfaceApprovalDecision,
      scope?: CodexSurfaceApprovalScope,
    ) => run(() => api.resolveApproval(approvalId, decision, scope)),
    retryMessage: (index: number) => run(() => api.retryMessage(index)),
    setGoal: (objective: string, tokenBudget?: number | null) => run(() => api.setGoal(objective, tokenBudget)),
    selectConversation: (conversationId: string) => run(() => api.selectConversation(conversationId)),
    sendMessage: (prompt: string, options?: SendCodexMessageOptions) => run(() => api.sendMessage(prompt, options)),
    startReview: (options?: StartCodexReviewOptions) => run(() => api.startReview(options)),
    startChatGptLogin: () => api.startChatGptLogin(),
    steerMessage: (prompt: string, options?: SendCodexMessageOptions) => run(() => api.steerMessage(prompt, options)),
    steerQueuedPrompt: (promptId: string) => run(() => api.steerQueuedPrompt(promptId)),
    unarchiveConversation: (conversationId: string) => run(() => api.unarchiveConversation(conversationId)),
    updateConversationSettings: (settings: UpdateCodexConversationSettings) => (
      run(() => api.updateConversationSettings(settings))
    ),
  };
}

export type CodexSurfaceController = ReturnType<typeof useCodexSurface>;
