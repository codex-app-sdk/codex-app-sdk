import type { CodexSurface } from '../node/codex-surface';
import type {
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceAskUserAnswers,
  CodexSurfaceClientRequestResponse,
  CodexSurfaceRendererApi,
  CodexSurfaceSnapshot,
  CreateCodexRendererConversationOptions,
  SendCodexMessageOptions,
  UpdateCodexConversationSettings,
} from '../surface/types';
import {
  registerIpcMainHandlers,
  TypedIpcRenderer,
  type IpcEventSender,
  type IpcMainPort,
  type IpcRendererPort,
  type IpcRequest,
} from './typed-ipc';

const channels = {
  clearGoal: 'codex-surface:clear-goal',
  connect: 'codex-surface:connect',
  createConversation: 'codex-surface:create-conversation',
  deleteMessage: 'codex-surface:delete-message',
  deleteQueuedPrompt: 'codex-surface:delete-queued-prompt',
  editMessage: 'codex-surface:edit-message',
  getSnapshot: 'codex-surface:get-snapshot',
  interrupt: 'codex-surface:interrupt',
  refreshConversations: 'codex-surface:refresh-conversations',
  respondToClientRequest: 'codex-surface:respond-to-client-request',
  resolveApproval: 'codex-surface:resolve-approval',
  retryMessage: 'codex-surface:retry-message',
  setGoal: 'codex-surface:set-goal',
  selectConversation: 'codex-surface:select-conversation',
  sendMessage: 'codex-surface:send-message',
  steerMessage: 'codex-surface:steer-message',
  steerQueuedPrompt: 'codex-surface:steer-queued-prompt',
  updateConversationSettings: 'codex-surface:update-conversation-settings',
  stateChanged: 'codex-surface:state-changed',
} as const;

type SurfaceRequests = {
  [channels.clearGoal]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.connect]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.createConversation]: IpcRequest<[options?: CreateCodexRendererConversationOptions], CodexSurfaceSnapshot>;
  [channels.deleteMessage]: IpcRequest<[index: number], CodexSurfaceSnapshot>;
  [channels.deleteQueuedPrompt]: IpcRequest<[promptId: string], CodexSurfaceSnapshot>;
  [channels.editMessage]: IpcRequest<[index: number, content: string], CodexSurfaceSnapshot>;
  [channels.getSnapshot]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.interrupt]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.refreshConversations]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.respondToClientRequest]: IpcRequest<[response: CodexSurfaceClientRequestResponse], CodexSurfaceSnapshot>;
  [channels.resolveApproval]: IpcRequest<[
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope?: CodexSurfaceApprovalScope,
  ], CodexSurfaceSnapshot>;
  [channels.retryMessage]: IpcRequest<[index: number], CodexSurfaceSnapshot>;
  [channels.setGoal]: IpcRequest<[objective: string, tokenBudget?: number | null], CodexSurfaceSnapshot>;
  [channels.selectConversation]: IpcRequest<[conversationId: string], CodexSurfaceSnapshot>;
  [channels.sendMessage]: IpcRequest<[prompt: string, options?: SendCodexMessageOptions], CodexSurfaceSnapshot>;
  [channels.steerMessage]: IpcRequest<[prompt: string], CodexSurfaceSnapshot>;
  [channels.steerQueuedPrompt]: IpcRequest<[promptId: string], CodexSurfaceSnapshot>;
  [channels.updateConversationSettings]: IpcRequest<[settings: UpdateCodexConversationSettings], CodexSurfaceSnapshot>;
};

type SurfaceEvents = {
  [channels.stateChanged]: CodexSurfaceSnapshot;
};

export type { CodexSurfaceRendererApi } from '../surface/types';

export function registerCodexSurfaceIpc(
  port: IpcMainPort,
  sender: IpcEventSender,
  surface: Pick<CodexSurface,
    | 'clearGoal'
    | 'connect'
    | 'createConversation'
    | 'deleteMessage'
    | 'deleteQueuedPrompt'
    | 'editMessage'
    | 'getSnapshot'
    | 'interrupt'
    | 'onStateChange'
    | 'refreshConversations'
    | 'respondToClientRequest'
    | 'resolveApproval'
    | 'retryMessage'
    | 'setGoal'
    | 'selectConversation'
    | 'sendMessage'
    | 'steerMessage'
    | 'steerQueuedPrompt'
    | 'updateConversationSettings'>,
): () => void {
  const unregisterHandlers = registerIpcMainHandlers<SurfaceRequests>(port, {
    [channels.clearGoal]: () => surface.clearGoal(),
    [channels.connect]: () => surface.connect(),
    [channels.createConversation]: (_event, options) => surface.createConversation(rendererConversationOptions(options)),
    [channels.deleteMessage]: (_event, index) => surface.deleteMessage(messageIndex(index)),
    [channels.deleteQueuedPrompt]: (_event, promptId) => surface.deleteQueuedPrompt(nonEmptyString(promptId, 'Queued prompt id')),
    [channels.editMessage]: (_event, index, content) => surface.editMessage(
      messageIndex(index),
      nonEmptyString(content, 'Message content'),
    ),
    [channels.getSnapshot]: () => surface.getSnapshot(),
    [channels.interrupt]: () => surface.interrupt(),
    [channels.refreshConversations]: () => surface.refreshConversations(),
    [channels.respondToClientRequest]: (_event, response) => surface.respondToClientRequest(clientRequestResponse(response)),
    [channels.resolveApproval]: (_event, approvalId, decision, scope) => surface.resolveApproval(approvalId, decision, scope),
    [channels.retryMessage]: (_event, index) => surface.retryMessage(messageIndex(index)),
    [channels.setGoal]: (_event, objective, tokenBudget) => (
      surface.setGoal(nonEmptyString(objective, 'Goal objective'), optionalTokenBudget(tokenBudget))
    ),
    [channels.selectConversation]: (_event, conversationId) => surface.selectConversation(conversationId),
    [channels.sendMessage]: (_event, prompt, options) => surface.sendMessage(prompt, options),
    [channels.steerMessage]: (_event, prompt) => surface.steerMessage(prompt),
    [channels.steerQueuedPrompt]: (_event, promptId) => surface.steerQueuedPrompt(nonEmptyString(promptId, 'Queued prompt id')),
    [channels.updateConversationSettings]: (_event, settings) => (
      surface.updateConversationSettings(rendererSettings(settings))
    ),
  });
  const unsubscribeState = surface.onStateChange((snapshot) => sender.send(channels.stateChanged, snapshot));
  return () => {
    unsubscribeState();
    unregisterHandlers();
  };
}

function rendererConversationOptions(value: unknown): CreateCodexRendererConversationOptions | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Conversation options must be an object');
  }
  const record = value as Record<string, unknown>;
  return {
    ...(record.model === undefined ? {} : { model: nonEmptyString(record.model, 'Conversation model') }),
    ...(record.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: nonEmptyString(record.reasoningEffort, 'Conversation reasoning effort') }),
    ...(record.approvalPreset === undefined
      ? {}
      : { approvalPreset: approvalPreset(record.approvalPreset) }),
  };
}

function rendererSettings(value: unknown): UpdateCodexConversationSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Conversation settings must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.planMode !== undefined && typeof record.planMode !== 'boolean') {
    throw new TypeError('Conversation plan mode must be a boolean');
  }
  return {
    ...(record.modelId === undefined ? {} : { modelId: nonEmptyString(record.modelId, 'Conversation model id') }),
    ...(record.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: nonEmptyString(record.reasoningEffort, 'Conversation reasoning effort') }),
    ...(record.approvalPreset === undefined
      ? {}
      : { approvalPreset: approvalPreset(record.approvalPreset) }),
    ...(record.planMode === undefined ? {} : { planMode: record.planMode }),
  };
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function approvalPreset(value: unknown): UpdateCodexConversationSettings['approvalPreset'] {
  if (value !== 'ask-for-approval' && value !== 'approve-for-me' && value !== 'full-access') {
    throw new TypeError('Conversation approval preset is invalid');
  }
  return value;
}

function optionalTokenBudget(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError('Goal token budget must be a positive number or null');
  }
  return value;
}

function messageIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError('Message index must be a non-negative integer');
  }
  return value;
}

function clientRequestResponse(value: unknown): CodexSurfaceClientRequestResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Client request response must be an object');
  }
  const record = value as Record<string, unknown>;
  const id = nonEmptyString(record.id, 'Client request id');
  if (record.payload === undefined) return { id };
  if (typeof record.payload !== 'object' || record.payload === null || Array.isArray(record.payload)) {
    throw new TypeError('Client request response payload must be an object');
  }
  const payload = record.payload as Record<string, unknown>;
  const decision = payload.decision;
  if (
    decision !== undefined
    && decision !== null
    && decision !== 'allow'
    && decision !== 'allow_conversation'
    && decision !== 'always_allow'
    && decision !== 'deny'
  ) throw new TypeError('Client request decision is invalid');
  if (payload.cancelled !== undefined && typeof payload.cancelled !== 'boolean') {
    throw new TypeError('Client request cancelled flag must be a boolean');
  }
  const answers = payload.answers;
  if (answers !== undefined && (typeof answers !== 'object' || answers === null || Array.isArray(answers))) {
    throw new TypeError('Client request answers must be an object');
  }
  return {
    id,
    payload: {
      ...(answers === undefined ? {} : { answers: answers as CodexSurfaceAskUserAnswers }),
      ...(payload.cancelled === undefined ? {} : { cancelled: payload.cancelled }),
      ...(decision === undefined ? {} : { decision: decision as NonNullable<CodexSurfaceClientRequestResponse['payload']>['decision'] }),
    },
  };
}

export function createCodexSurfaceRendererApi(port: IpcRendererPort): CodexSurfaceRendererApi {
  const renderer = new TypedIpcRenderer<SurfaceRequests, SurfaceEvents>(port);
  return {
    clearGoal: () => renderer.invoke(channels.clearGoal),
    connect: () => renderer.invoke(channels.connect),
    createConversation: (options) => renderer.invoke(channels.createConversation, options),
    deleteMessage: (index) => renderer.invoke(channels.deleteMessage, index),
    deleteQueuedPrompt: (promptId) => renderer.invoke(channels.deleteQueuedPrompt, promptId),
    editMessage: (index, content) => renderer.invoke(channels.editMessage, index, content),
    getSnapshot: () => renderer.invoke(channels.getSnapshot),
    interrupt: () => renderer.invoke(channels.interrupt),
    onStateChange: (listener) => renderer.on(channels.stateChanged, listener),
    refreshConversations: () => renderer.invoke(channels.refreshConversations),
    respondToClientRequest: (response) => renderer.invoke(channels.respondToClientRequest, response),
    resolveApproval: (approvalId, decision, scope) => renderer.invoke(channels.resolveApproval, approvalId, decision, scope),
    retryMessage: (index) => renderer.invoke(channels.retryMessage, index),
    setGoal: (objective, tokenBudget) => renderer.invoke(channels.setGoal, objective, tokenBudget),
    selectConversation: (conversationId) => renderer.invoke(channels.selectConversation, conversationId),
    sendMessage: (prompt, options) => renderer.invoke(channels.sendMessage, prompt, options),
    steerMessage: (prompt) => renderer.invoke(channels.steerMessage, prompt),
    steerQueuedPrompt: (promptId) => renderer.invoke(channels.steerQueuedPrompt, promptId),
    updateConversationSettings: (settings) => renderer.invoke(channels.updateConversationSettings, settings),
  };
}
