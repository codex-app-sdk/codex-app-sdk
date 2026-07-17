import { getCurrentScope, onScopeDispose, reactive, readonly } from 'vue';
import type {
  CodexSurfaceApi,
  CodexSurfaceSnapshot,
  CreateCodexConversationOptions,
  SendCodexMessageOptions,
} from '../surface';

const initialState: CodexSurfaceSnapshot = {
  status: 'idle',
  conversations: [],
  activeConversationId: null,
  messages: [],
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
    selectConversation: (conversationId: string) => run(() => api.selectConversation(conversationId)),
    sendMessage: (prompt: string, options?: SendCodexMessageOptions) => run(() => api.sendMessage(prompt, options)),
  };
}
