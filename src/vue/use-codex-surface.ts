import { getCurrentScope, onScopeDispose, reactive, readonly } from 'vue';
import type {
  CodexSurfaceApi,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceSnapshot,
  CreateCodexConversationOptions,
  SendCodexMessageOptions,
} from '../surface/types';

const initialState: CodexSurfaceSnapshot = {
  status: 'idle',
  conversations: [],
  activeConversationId: null,
  messages: [],
  approvals: [],
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
    connect: () => run(() => api.connect()),
    createConversation: (options?: CreateCodexConversationOptions) => run(() => api.createConversation(options)),
    interrupt: () => run(() => api.interrupt()),
    refreshConversations: () => run(() => api.refreshConversations()),
    resolveApproval: (
      approvalId: string,
      decision: CodexSurfaceApprovalDecision,
      scope?: CodexSurfaceApprovalScope,
    ) => run(() => api.resolveApproval(approvalId, decision, scope)),
    selectConversation: (conversationId: string) => run(() => api.selectConversation(conversationId)),
    sendMessage: (prompt: string, options?: SendCodexMessageOptions) => run(() => api.sendMessage(prompt, options)),
  };
}
