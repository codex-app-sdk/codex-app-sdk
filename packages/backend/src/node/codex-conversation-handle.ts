import type {
  CodexConversationEvent,
  CodexConversationHistory,
  CodexConversationHistoryPage,
  CodexConversationPromptHistory,
  CodexConversationSnapshot,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceClientRequestResponse,
  SendCodexMessageOptions,
  StartCodexRealtimeOptions,
  StartCodexReviewOptions,
  UpdateCodexConversationSettings,
} from '@codex-app-sdk/core/surface';
import type {
  CodexConversation,
  CodexConversationForkResult,
  CodexConversationHostOptions,
  CodexConversationLoadOptions,
  CodexRealtimeSession,
  ForkCodexConversationOptions,
} from './codex-surface-contracts';

export type CodexConversationHandleOperations = {
  clearGoal(): Promise<void>;
  compact(): Promise<void>;
  continueInterruptedTurn(): Promise<void>;
  deleteTurn(turnId: string): Promise<void>;
  deleteQueuedPrompt(promptId: string): Promise<void>;
  updateQueuedPrompt(promptId: string, prompt: string): Promise<void>;
  editTurn(turnId: string, content: string): Promise<void>;
  fork(
    options?: ForkCodexConversationOptions,
    hostOptions?: CodexConversationHostOptions,
  ): Promise<CodexConversationForkResult>;
  forkTurn(
    turnId: string,
    options?: ForkCodexConversationOptions,
    hostOptions?: CodexConversationHostOptions,
  ): Promise<CodexConversationForkResult>;
  getSnapshot(): CodexConversationSnapshot;
  interrupt(): Promise<void>;
  load(options?: CodexConversationLoadOptions): Promise<void>;
  onEvent(listener: (event: CodexConversationEvent) => void): () => void;
  onStateChange(listener: (snapshot: CodexConversationSnapshot) => void): () => void;
  readHistory(): Promise<CodexConversationHistory>;
  readPromptHistory(): Promise<CodexConversationPromptHistory>;
  loadOlderHistory?: () => Promise<CodexConversationHistoryPage>;
  rename(title: string): Promise<void>;
  resolveApproval(
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope?: CodexSurfaceApprovalScope,
  ): Promise<void>;
  respondToClientRequest(response: CodexSurfaceClientRequestResponse): Promise<void>;
  retryTurn(turnId: string): Promise<void>;
  select(): Promise<void>;
  sendMessage(prompt: string, options?: SendCodexMessageOptions): Promise<void>;
  setGoal(objective: string, tokenBudget?: number | null): Promise<void>;
  startRealtime(options: StartCodexRealtimeOptions): Promise<CodexRealtimeSession>;
  startReview(options?: StartCodexReviewOptions): Promise<void>;
  steerMessage(prompt: string, options?: SendCodexMessageOptions): Promise<void>;
  steerQueuedPrompt(promptId: string, prompt?: string): Promise<void>;
  updateSettings(settings: UpdateCodexConversationSettings): Promise<void>;
};

export function createCodexConversationHandle(
  id: string,
  operations: CodexConversationHandleOperations,
): CodexConversation {
  const snapshotAfter = async (operation: () => Promise<void>): Promise<CodexConversationSnapshot> => {
    await operation();
    return operations.getSnapshot();
  };
  return {
    id,
    fork: operations.fork,
    forkTurn: operations.forkTurn,
    load: (options) => snapshotAfter(() => operations.load(options)),
    select: () => snapshotAfter(operations.select),
    readHistory: operations.readHistory,
    readPromptHistory: operations.readPromptHistory,
    loadOlderHistory: operations.loadOlderHistory ?? (
      async () => ({ conversationId: id, messages: [], hasOlder: false })
    ),
    rename: (title) => snapshotAfter(() => operations.rename(title)),
    updateSettings: (settings) => snapshotAfter(() => operations.updateSettings(settings)),
    sendMessage: (prompt, options) => snapshotAfter(() => operations.sendMessage(prompt, options)),
    startRealtime: operations.startRealtime,
    compact: () => snapshotAfter(operations.compact),
    continueInterruptedTurn: () => snapshotAfter(operations.continueInterruptedTurn),
    startReview: (options) => snapshotAfter(() => operations.startReview(options)),
    steerMessage: (prompt, options) => snapshotAfter(() => operations.steerMessage(prompt, options)),
    interrupt: () => snapshotAfter(operations.interrupt),
    deleteTurn: (turnId) => snapshotAfter(() => operations.deleteTurn(turnId)),
    editTurn: (turnId, content) => snapshotAfter(() => operations.editTurn(turnId, content)),
    retryTurn: (turnId) => snapshotAfter(() => operations.retryTurn(turnId)),
    deleteQueuedPrompt: (promptId) => snapshotAfter(() => operations.deleteQueuedPrompt(promptId)),
    updateQueuedPrompt: (promptId, prompt) => snapshotAfter(() => operations.updateQueuedPrompt(promptId, prompt)),
    steerQueuedPrompt: (promptId, prompt) => snapshotAfter(() => operations.steerQueuedPrompt(promptId, prompt)),
    respondToClientRequest: (response) => snapshotAfter(() => operations.respondToClientRequest(response)),
    resolveApproval: (approvalId, decision, scope) => snapshotAfter(
      () => operations.resolveApproval(approvalId, decision, scope),
    ),
    setGoal: (objective, tokenBudget) => snapshotAfter(() => operations.setGoal(objective, tokenBudget)),
    clearGoal: () => snapshotAfter(operations.clearGoal),
    getSnapshot: operations.getSnapshot,
    onStateChange: operations.onStateChange,
    onEvent: operations.onEvent,
  };
}
