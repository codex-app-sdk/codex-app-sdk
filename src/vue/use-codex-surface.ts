import { getCurrentScope, onScopeDispose, reactive, readonly } from 'vue';
import type {
  CodexSurfaceApi,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceClientRequestResponse,
  CodexSurfaceSnapshot,
  CreateCodexConversationOptions,
  SendCodexMessageOptions,
  UpdateCodexConversationSettings,
} from '../surface/types';

const initialState: CodexSurfaceSnapshot = {
  status: 'idle',
  conversations: [],
  activeConversationId: null,
  messages: [],
  approvals: [],
  models: [],
  modelCatalogStatus: 'notLoaded',
  skills: [],
  skillCatalogStatus: 'notLoaded',
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

export function useCodexSurface(api: CodexSurfaceApi) {
  const state = reactive<CodexSurfaceSnapshot>(structuredClone(initialState));
  const apply = (snapshot: CodexSurfaceSnapshot) => Object.assign(state, snapshot);
  const unsubscribe = api.onStateChange(apply);
  if (getCurrentScope()) onScopeDispose(unsubscribe);

  async function run(action: () => Promise<CodexSurfaceSnapshot>): Promise<CodexSurfaceSnapshot> {
    const snapshot = await action();
    apply(snapshot);
    return snapshot;
  }

  return {
    state: readonly(state),
    clearGoal: () => run(() => api.clearGoal()),
    connect: () => run(() => api.connect()),
    createConversation: (options?: CreateCodexConversationOptions) => run(() => api.createConversation(options)),
    deleteMessage: (index: number) => run(() => api.deleteMessage(index)),
    deleteQueuedPrompt: (promptId: string) => run(() => api.deleteQueuedPrompt(promptId)),
    editMessage: (index: number, content: string) => run(() => api.editMessage(index, content)),
    interrupt: () => run(() => api.interrupt()),
    refreshConversations: () => run(() => api.refreshConversations()),
    respondToClientRequest: (response: CodexSurfaceClientRequestResponse) => (
      run(() => api.respondToClientRequest(response))
    ),
    resolveApproval: (
      approvalId: string,
      decision: CodexSurfaceApprovalDecision,
      scope?: CodexSurfaceApprovalScope,
    ) => run(() => api.resolveApproval(approvalId, decision, scope)),
    retryMessage: (index: number) => run(() => api.retryMessage(index)),
    setGoal: (objective: string, tokenBudget?: number | null) => run(() => api.setGoal(objective, tokenBudget)),
    selectConversation: (conversationId: string) => run(() => api.selectConversation(conversationId)),
    sendMessage: (prompt: string, options?: SendCodexMessageOptions) => run(() => api.sendMessage(prompt, options)),
    steerMessage: (prompt: string) => run(() => api.steerMessage(prompt)),
    steerQueuedPrompt: (promptId: string) => run(() => api.steerQueuedPrompt(promptId)),
    updateConversationSettings: (settings: UpdateCodexConversationSettings) => (
      run(() => api.updateConversationSettings(settings))
    ),
  };
}
