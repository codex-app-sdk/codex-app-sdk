import type {
  CodexConversationEvent,
  CodexConversationHistory,
  CodexConversationSnapshot,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceClientRequestResponse,
  SendCodexMessageOptions,
  StartCodexRealtimeOptions,
  StartCodexReviewOptions,
  UpdateCodexConversationSettings,
} from '../surface/types';
import type {
  CodexConversation,
  CodexConversationLoadOptions,
  CodexRealtimeSession,
} from './codex-surface-contracts';

export type CodexConversationHandleOperations = {
  clearGoal(): Promise<void>;
  compact(): Promise<void>;
  deleteMessage(index: number): Promise<void>;
  deleteQueuedPrompt(promptId: string): Promise<void>;
  editMessage(index: number, content: string): Promise<void>;
  getSnapshot(): CodexConversationSnapshot;
  interrupt(): Promise<void>;
  load(options?: CodexConversationLoadOptions): Promise<void>;
  onEvent(listener: (event: CodexConversationEvent) => void): () => void;
  onStateChange(listener: (snapshot: CodexConversationSnapshot) => void): () => void;
  readHistory(): Promise<CodexConversationHistory>;
  rename(title: string): Promise<void>;
  resolveApproval(
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope?: CodexSurfaceApprovalScope,
  ): Promise<void>;
  respondToClientRequest(response: CodexSurfaceClientRequestResponse): Promise<void>;
  retryMessage(index: number): Promise<void>;
  rollbackToTurn(turnId: string): Promise<void>;
  select(): Promise<void>;
  sendMessage(prompt: string, options?: SendCodexMessageOptions): Promise<void>;
  setGoal(objective: string, tokenBudget?: number | null): Promise<void>;
  startRealtime(options: StartCodexRealtimeOptions): Promise<CodexRealtimeSession>;
  startReview(options?: StartCodexReviewOptions): Promise<void>;
  steerMessage(prompt: string): Promise<void>;
  steerQueuedPrompt(promptId: string): Promise<void>;
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
    load: (options) => snapshotAfter(() => operations.load(options)),
    select: () => snapshotAfter(operations.select),
    readHistory: operations.readHistory,
    rename: (title) => snapshotAfter(() => operations.rename(title)),
    updateSettings: (settings) => snapshotAfter(() => operations.updateSettings(settings)),
    sendMessage: (prompt, options) => snapshotAfter(() => operations.sendMessage(prompt, options)),
    startRealtime: operations.startRealtime,
    compact: () => snapshotAfter(operations.compact),
    startReview: (options) => snapshotAfter(() => operations.startReview(options)),
    steerMessage: (prompt) => snapshotAfter(() => operations.steerMessage(prompt)),
    interrupt: () => snapshotAfter(operations.interrupt),
    deleteMessage: (index) => snapshotAfter(() => operations.deleteMessage(index)),
    editMessage: (index, content) => snapshotAfter(() => operations.editMessage(index, content)),
    retryMessage: (index) => snapshotAfter(() => operations.retryMessage(index)),
    rollbackToTurn: (turnId) => snapshotAfter(() => operations.rollbackToTurn(turnId)),
    deleteQueuedPrompt: (promptId) => snapshotAfter(() => operations.deleteQueuedPrompt(promptId)),
    steerQueuedPrompt: (promptId) => snapshotAfter(() => operations.steerQueuedPrompt(promptId)),
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
