import type { CodexSurface } from '../node/codex-surface';
import type {
  CodexSurfaceApi,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceSnapshot,
  CreateCodexConversationOptions,
  SendCodexMessageOptions,
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
  connect: 'codex-surface:connect',
  createConversation: 'codex-surface:create-conversation',
  getSnapshot: 'codex-surface:get-snapshot',
  interrupt: 'codex-surface:interrupt',
  refreshConversations: 'codex-surface:refresh-conversations',
  resolveApproval: 'codex-surface:resolve-approval',
  selectConversation: 'codex-surface:select-conversation',
  sendMessage: 'codex-surface:send-message',
  stateChanged: 'codex-surface:state-changed',
} as const;

type SurfaceRequests = {
  [channels.connect]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.createConversation]: IpcRequest<[options?: CreateCodexConversationOptions], CodexSurfaceSnapshot>;
  [channels.getSnapshot]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.interrupt]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.refreshConversations]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.resolveApproval]: IpcRequest<[
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope?: CodexSurfaceApprovalScope,
  ], CodexSurfaceSnapshot>;
  [channels.selectConversation]: IpcRequest<[conversationId: string], CodexSurfaceSnapshot>;
  [channels.sendMessage]: IpcRequest<[prompt: string, options?: SendCodexMessageOptions], CodexSurfaceSnapshot>;
};

type SurfaceEvents = {
  [channels.stateChanged]: CodexSurfaceSnapshot;
};

export type CodexSurfaceRendererApi = CodexSurfaceApi;

export function registerCodexSurfaceIpc(
  port: IpcMainPort,
  sender: IpcEventSender,
  surface: Pick<CodexSurface,
    | 'connect'
    | 'createConversation'
    | 'getSnapshot'
    | 'interrupt'
    | 'onStateChange'
    | 'refreshConversations'
    | 'resolveApproval'
    | 'selectConversation'
    | 'sendMessage'>,
): () => void {
  const unregisterHandlers = registerIpcMainHandlers<SurfaceRequests>(port, {
    [channels.connect]: () => surface.connect(),
    [channels.createConversation]: (_event, options) => surface.createConversation(options),
    [channels.getSnapshot]: () => surface.getSnapshot(),
    [channels.interrupt]: () => surface.interrupt(),
    [channels.refreshConversations]: () => surface.refreshConversations(),
    [channels.resolveApproval]: (_event, approvalId, decision, scope) => surface.resolveApproval(approvalId, decision, scope),
    [channels.selectConversation]: (_event, conversationId) => surface.selectConversation(conversationId),
    [channels.sendMessage]: (_event, prompt, options) => surface.sendMessage(prompt, options),
  });
  const unsubscribeState = surface.onStateChange((snapshot) => sender.send(channels.stateChanged, snapshot));
  return () => {
    unsubscribeState();
    unregisterHandlers();
  };
}

export function createCodexSurfaceRendererApi(port: IpcRendererPort): CodexSurfaceRendererApi {
  const renderer = new TypedIpcRenderer<SurfaceRequests, SurfaceEvents>(port);
  return {
    connect: () => renderer.invoke(channels.connect),
    createConversation: (options) => renderer.invoke(channels.createConversation, options),
    getSnapshot: () => renderer.invoke(channels.getSnapshot),
    interrupt: () => renderer.invoke(channels.interrupt),
    onStateChange: (listener) => renderer.on(channels.stateChanged, listener),
    refreshConversations: () => renderer.invoke(channels.refreshConversations),
    resolveApproval: (approvalId, decision, scope) => renderer.invoke(channels.resolveApproval, approvalId, decision, scope),
    selectConversation: (conversationId) => renderer.invoke(channels.selectConversation, conversationId),
    sendMessage: (prompt, options) => renderer.invoke(channels.sendMessage, prompt, options),
  };
}
