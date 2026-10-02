import {
  invokeCodexSurfaceBridgeOperation,
  type CodexSurfaceBridgeOperation,
  type CodexSurfaceBridgeTarget,
} from '@codex-app-sdk/core/surface-bridge';
import type {
  CodexConversationHistory,
  CodexConversationPromptHistory,
  CodexConversationSummary,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceChatGptDeviceCodeLogin,
  CodexSurfaceChatGptLogin,
  CodexSurfaceClientRequestResponse,
  CodexSurfaceEvent,
  CodexSurfaceModel,
  CodexSurfaceRendererApi,
  CodexSurfaceSnapshot,
  CreateCodexRendererConversationOptions,
  ListCodexConversationsOptions,
  ListCodexModelsOptions,
  CodexRendererSendMessageOptions,
  StartCodexReviewOptions,
  StartCodexLiveChatOptions,
  UpdateCodexConversationSettings,
} from '@codex-app-sdk/core/surface';
import {
  registerIpcMainHandlers,
  TypedIpcRenderer,
  type IpcEventSender,
  type IpcMainPort,
  type IpcRendererPort,
  type IpcRequest,
} from './typed-ipc';

export type CodexSurfaceIpcOptions = {
  resolveAttachment?: import('@codex-app-sdk/core/surface-bridge').CodexSurfaceBridgeAttachmentResolver;
};

const channels = {
  archiveConversation: 'codex-surface:archive-conversation',
  cancelLogin: 'codex-surface:cancel-login',
  clearGoal: 'codex-surface:clear-goal',
  compactConversation: 'codex-surface:compact-conversation',
  connect: 'codex-surface:connect',
  continueInterruptedTurn: 'codex-surface:continue-interrupted-turn',
  createConversation: 'codex-surface:create-conversation',
  deleteConversation: 'codex-surface:delete-conversation',
  deleteTurn: 'codex-surface:delete-turn',
  deleteQueuedPrompt: 'codex-surface:delete-queued-prompt',
  editTurn: 'codex-surface:edit-turn',
  forkTurn: 'codex-surface:fork-turn',
  getSnapshot: 'codex-surface:get-snapshot',
  interrupt: 'codex-surface:interrupt',
  listConversations: 'codex-surface:list-conversations',
  listModels: 'codex-surface:list-models',
  logout: 'codex-surface:logout',
  readConversationHistory: 'codex-surface:read-conversation-history',
  readConversationPromptHistory: 'codex-surface:read-conversation-prompt-history',
  loadOlderConversationHistory: 'codex-surface:load-older-conversation-history',
  refreshAccount: 'codex-surface:refresh-account',
  refreshConversations: 'codex-surface:refresh-conversations',
  renameConversation: 'codex-surface:rename-conversation',
  respondToClientRequest: 'codex-surface:respond-to-client-request',
  resolveApproval: 'codex-surface:resolve-approval',
  retryTurn: 'codex-surface:retry-turn',
  setGoal: 'codex-surface:set-goal',
  selectConversation: 'codex-surface:select-conversation',
  sendMessage: 'codex-surface:send-message',
  startReview: 'codex-surface:start-review',
  startLiveChat: 'codex-surface:start-live-chat',
  stopLiveChat: 'codex-surface:stop-live-chat',
  startChatGptDeviceCodeLogin: 'codex-surface:start-chatgpt-device-code-login',
  startChatGptLogin: 'codex-surface:start-chatgpt-login',
  steerMessage: 'codex-surface:steer-message',
  steerQueuedPrompt: 'codex-surface:steer-queued-prompt',
  unarchiveConversation: 'codex-surface:unarchive-conversation',
  updateConversationSettings: 'codex-surface:update-conversation-settings',
  updateQueuedPrompt: 'codex-surface:update-queued-prompt',
  stateChanged: 'codex-surface:state-changed',
  event: 'codex-surface:event',
} as const;

type SurfaceRequests = {
  [channels.archiveConversation]: IpcRequest<[conversationId: string], CodexSurfaceSnapshot>;
  [channels.cancelLogin]: IpcRequest<[loginId?: string], CodexSurfaceSnapshot>;
  [channels.clearGoal]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.compactConversation]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.connect]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.continueInterruptedTurn]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.createConversation]: IpcRequest<[options?: CreateCodexRendererConversationOptions], CodexSurfaceSnapshot>;
  [channels.deleteConversation]: IpcRequest<[conversationId: string], CodexSurfaceSnapshot>;
  [channels.deleteTurn]: IpcRequest<[turnId: string], CodexSurfaceSnapshot>;
  [channels.deleteQueuedPrompt]: IpcRequest<[promptId: string], CodexSurfaceSnapshot>;
  [channels.editTurn]: IpcRequest<[turnId: string, content: string], CodexSurfaceSnapshot>;
  [channels.forkTurn]: IpcRequest<[turnId: string], CodexSurfaceSnapshot>;
  [channels.getSnapshot]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.interrupt]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.listConversations]: IpcRequest<[
    options?: ListCodexConversationsOptions,
  ], CodexConversationSummary[]>;
  [channels.listModels]: IpcRequest<[options?: ListCodexModelsOptions], CodexSurfaceModel[]>;
  [channels.logout]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.readConversationHistory]: IpcRequest<[conversationId?: string], CodexConversationHistory>;
  [channels.readConversationPromptHistory]: IpcRequest<[
    conversationId?: string,
  ], CodexConversationPromptHistory>;
  [channels.loadOlderConversationHistory]: IpcRequest<[conversationId?: string], import('@codex-app-sdk/core/surface').CodexConversationHistoryPage>;
  [channels.refreshAccount]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.refreshConversations]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.renameConversation]: IpcRequest<[title: string], CodexSurfaceSnapshot>;
  [channels.respondToClientRequest]: IpcRequest<[response: CodexSurfaceClientRequestResponse], CodexSurfaceSnapshot>;
  [channels.resolveApproval]: IpcRequest<[
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope?: CodexSurfaceApprovalScope,
  ], CodexSurfaceSnapshot>;
  [channels.retryTurn]: IpcRequest<[turnId: string], CodexSurfaceSnapshot>;
  [channels.setGoal]: IpcRequest<[objective: string, tokenBudget?: number | null], CodexSurfaceSnapshot>;
  [channels.selectConversation]: IpcRequest<[conversationId: string], CodexSurfaceSnapshot>;
  [channels.sendMessage]: IpcRequest<[prompt: string, options?: CodexRendererSendMessageOptions], CodexSurfaceSnapshot>;
  [channels.startReview]: IpcRequest<[options?: StartCodexReviewOptions], CodexSurfaceSnapshot>;
  [channels.startLiveChat]: IpcRequest<[conversationId: string, options: StartCodexLiveChatOptions], { sdp: string }>;
  [channels.stopLiveChat]: IpcRequest<[conversationId: string], void>;
  [channels.startChatGptDeviceCodeLogin]: IpcRequest<[], CodexSurfaceChatGptDeviceCodeLogin>;
  [channels.startChatGptLogin]: IpcRequest<[], CodexSurfaceChatGptLogin>;
  [channels.steerMessage]: IpcRequest<[
    prompt: string,
    options?: CodexRendererSendMessageOptions,
  ], CodexSurfaceSnapshot>;
  [channels.steerQueuedPrompt]: IpcRequest<[promptId: string, prompt?: string], CodexSurfaceSnapshot>;
  [channels.unarchiveConversation]: IpcRequest<[conversationId: string], CodexSurfaceSnapshot>;
  [channels.updateConversationSettings]: IpcRequest<[settings: UpdateCodexConversationSettings], CodexSurfaceSnapshot>;
  [channels.updateQueuedPrompt]: IpcRequest<[promptId: string, prompt: string], CodexSurfaceSnapshot>;
};

type SurfaceEvents = {
  [channels.stateChanged]: CodexSurfaceSnapshot;
  [channels.event]: CodexSurfaceEvent;
};

export type { CodexSurfaceRendererApi } from '@codex-app-sdk/core/surface';

type OptionalSurfaceOperation = 'loadOlderConversationHistory' | 'startLiveChat' | 'stopLiveChat';

export function registerCodexSurfaceIpc(
  port: IpcMainPort,
  sender: IpcEventSender,
  surface: Omit<CodexSurfaceBridgeTarget, OptionalSurfaceOperation>
    & Partial<Pick<CodexSurfaceBridgeTarget, OptionalSurfaceOperation>>,
  options: CodexSurfaceIpcOptions = {},
): () => void {
  const invoke = <Name extends CodexSurfaceBridgeOperation>(name: Name, args: readonly unknown[]) => {
    if (name === 'loadOlderConversationHistory' && !surface.loadOlderConversationHistory) {
      return Promise.reject(new Error('Conversation history paging is not available.'));
    }
    if ((name === 'startLiveChat' || name === 'stopLiveChat') && !surface[name]) {
      return Promise.reject(new Error('Live chat is not available.'));
    }
    return invokeCodexSurfaceBridgeOperation(
      surface as CodexSurfaceBridgeTarget,
      name,
      args,
      {
        operationLabel: channels[name],
        ...(options.resolveAttachment === undefined
          ? {}
          : { resolveAttachment: options.resolveAttachment }),
      },
    );
  };
  const unregisterHandlers = registerIpcMainHandlers<SurfaceRequests>(port, {
    [channels.archiveConversation]: (_event, ...args) => invoke('archiveConversation', args),
    [channels.cancelLogin]: (_event, ...args) => invoke('cancelLogin', args),
    [channels.clearGoal]: (_event, ...args) => invoke('clearGoal', args),
    [channels.compactConversation]: (_event, ...args) => invoke('compactConversation', args),
    [channels.connect]: (_event, ...args) => invoke('connect', args),
    [channels.continueInterruptedTurn]: (_event, ...args) => invoke('continueInterruptedTurn', args),
    [channels.createConversation]: (_event, ...args) => invoke('createConversation', args),
    [channels.deleteConversation]: (_event, ...args) => invoke('deleteConversation', args),
    [channels.deleteTurn]: (_event, ...args) => invoke('deleteTurn', args),
    [channels.deleteQueuedPrompt]: (_event, ...args) => invoke('deleteQueuedPrompt', args),
    [channels.editTurn]: (_event, ...args) => invoke('editTurn', args),
    [channels.forkTurn]: (_event, ...args) => invoke('forkTurn', args),
    [channels.getSnapshot]: (_event, ...args) => invoke('getSnapshot', args),
    [channels.interrupt]: (_event, ...args) => invoke('interrupt', args),
    [channels.listConversations]: (_event, ...args) => invoke('listConversations', args),
    [channels.listModels]: (_event, ...args) => invoke('listModels', args),
    [channels.logout]: (_event, ...args) => invoke('logout', args),
    [channels.readConversationHistory]: (_event, ...args) => invoke('readConversationHistory', args),
    [channels.readConversationPromptHistory]: (_event, ...args) => invoke('readConversationPromptHistory', args),
    [channels.loadOlderConversationHistory]: (_event, ...args) => invoke('loadOlderConversationHistory', args),
    [channels.refreshAccount]: (_event, ...args) => invoke('refreshAccount', args),
    [channels.refreshConversations]: (_event, ...args) => invoke('refreshConversations', args),
    [channels.renameConversation]: (_event, ...args) => invoke('renameConversation', args),
    [channels.respondToClientRequest]: (_event, ...args) => invoke('respondToClientRequest', args),
    [channels.resolveApproval]: (_event, ...args) => invoke('resolveApproval', args),
    [channels.retryTurn]: (_event, ...args) => invoke('retryTurn', args),
    [channels.setGoal]: (_event, ...args) => invoke('setGoal', args),
    [channels.selectConversation]: (_event, ...args) => invoke('selectConversation', args),
    [channels.sendMessage]: (_event, ...args) => invoke('sendMessage', args),
    [channels.startReview]: (_event, ...args) => invoke('startReview', args),
    [channels.startLiveChat]: (_event, ...args) => invoke('startLiveChat', args),
    [channels.stopLiveChat]: (_event, ...args) => invoke('stopLiveChat', args),
    [channels.startChatGptDeviceCodeLogin]: (_event, ...args) => invoke('startChatGptDeviceCodeLogin', args),
    [channels.startChatGptLogin]: (_event, ...args) => invoke('startChatGptLogin', args),
    [channels.steerMessage]: (_event, ...args) => invoke('steerMessage', args),
    [channels.steerQueuedPrompt]: (_event, ...args) => invoke('steerQueuedPrompt', args),
    [channels.unarchiveConversation]: (_event, ...args) => invoke('unarchiveConversation', args),
    [channels.updateConversationSettings]: (_event, ...args) => invoke('updateConversationSettings', args),
    [channels.updateQueuedPrompt]: (_event, ...args) => invoke('updateQueuedPrompt', args),
  });
  const unsubscribeState = surface.onStateChange((snapshot) => sender.send(channels.stateChanged, snapshot));
  const unsubscribeEvents = surface.onEvent((event) => sender.send(channels.event, event));
  return () => {
    unsubscribeEvents();
    unsubscribeState();
    unregisterHandlers();
  };
}

export function createCodexSurfaceRendererApi(port: IpcRendererPort): CodexSurfaceRendererApi {
  const renderer = new TypedIpcRenderer<SurfaceRequests, SurfaceEvents>(port);
  return {
    archiveConversation: (conversationId) => renderer.invoke(channels.archiveConversation, conversationId),
    cancelLogin: (loginId) => renderer.invoke(channels.cancelLogin, loginId),
    clearGoal: () => renderer.invoke(channels.clearGoal),
    compactConversation: () => renderer.invoke(channels.compactConversation),
    connect: () => renderer.invoke(channels.connect),
    continueInterruptedTurn: () => renderer.invoke(channels.continueInterruptedTurn),
    createConversation: (options) => renderer.invoke(channels.createConversation, options),
    deleteConversation: (conversationId) => renderer.invoke(channels.deleteConversation, conversationId),
    deleteTurn: (turnId) => renderer.invoke(channels.deleteTurn, turnId),
    deleteQueuedPrompt: (promptId) => renderer.invoke(channels.deleteQueuedPrompt, promptId),
    editTurn: (turnId, content) => renderer.invoke(channels.editTurn, turnId, content),
    forkTurn: (turnId) => renderer.invoke(channels.forkTurn, turnId),
    getSnapshot: () => renderer.invoke(channels.getSnapshot),
    interrupt: () => renderer.invoke(channels.interrupt),
    listConversations: (options) => renderer.invoke(channels.listConversations, options),
    listModels: (options) => renderer.invoke(channels.listModels, options),
    logout: () => renderer.invoke(channels.logout),
    onEvent: (listener) => renderer.on(channels.event, listener),
    onStateChange: (listener) => renderer.on(channels.stateChanged, listener),
    readConversationHistory: (conversationId) => renderer.invoke(channels.readConversationHistory, conversationId),
    readConversationPromptHistory: (conversationId) => (
      renderer.invoke(channels.readConversationPromptHistory, conversationId)
    ),
    loadOlderConversationHistory: (conversationId) => renderer.invoke(channels.loadOlderConversationHistory, conversationId),
    refreshAccount: () => renderer.invoke(channels.refreshAccount),
    refreshConversations: () => renderer.invoke(channels.refreshConversations),
    renameConversation: (title) => renderer.invoke(channels.renameConversation, title),
    respondToClientRequest: (response) => renderer.invoke(channels.respondToClientRequest, response),
    resolveApproval: (approvalId, decision, scope) => renderer.invoke(channels.resolveApproval, approvalId, decision, scope),
    retryTurn: (turnId) => renderer.invoke(channels.retryTurn, turnId),
    setGoal: (objective, tokenBudget) => renderer.invoke(channels.setGoal, objective, tokenBudget),
    selectConversation: (conversationId) => renderer.invoke(channels.selectConversation, conversationId),
    sendMessage: (prompt, options) => renderer.invoke(channels.sendMessage, prompt, options),
    startReview: (options) => renderer.invoke(channels.startReview, options),
    startLiveChat: (conversationId, options) => renderer.invoke(channels.startLiveChat, conversationId, options),
    stopLiveChat: (conversationId) => renderer.invoke(channels.stopLiveChat, conversationId),
    startChatGptDeviceCodeLogin: () => renderer.invoke(channels.startChatGptDeviceCodeLogin),
    startChatGptLogin: () => renderer.invoke(channels.startChatGptLogin),
    steerMessage: (prompt, options) => renderer.invoke(channels.steerMessage, prompt, options),
    steerQueuedPrompt: (promptId, prompt) => renderer.invoke(channels.steerQueuedPrompt, promptId, prompt),
    unarchiveConversation: (conversationId) => renderer.invoke(channels.unarchiveConversation, conversationId),
    updateConversationSettings: (settings) => renderer.invoke(channels.updateConversationSettings, settings),
    updateQueuedPrompt: (promptId, prompt) => renderer.invoke(channels.updateQueuedPrompt, promptId, prompt),
  };
}
