import type { CodexSurface } from '../node/codex-surface';
import type {
  CodexConversationHistory,
  CodexConversationSummary,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceAskUserAnswers,
  CodexSurfaceClientRequestResponse,
  CodexSurfaceEvent,
  CodexSurfaceJsonValue,
  CodexSurfaceModel,
  CodexSurfaceRendererApi,
  CodexSurfaceSnapshot,
  CreateCodexRendererConversationOptions,
  ListCodexConversationsOptions,
  ListCodexModelsOptions,
  SendCodexMessageOptions,
  StartCodexReviewOptions,
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
  archiveConversation: 'codex-surface:archive-conversation',
  clearGoal: 'codex-surface:clear-goal',
  compactConversation: 'codex-surface:compact-conversation',
  connect: 'codex-surface:connect',
  createConversation: 'codex-surface:create-conversation',
  deleteConversation: 'codex-surface:delete-conversation',
  deleteMessage: 'codex-surface:delete-message',
  deleteQueuedPrompt: 'codex-surface:delete-queued-prompt',
  editMessage: 'codex-surface:edit-message',
  getSnapshot: 'codex-surface:get-snapshot',
  interrupt: 'codex-surface:interrupt',
  listConversations: 'codex-surface:list-conversations',
  listModels: 'codex-surface:list-models',
  readConversationHistory: 'codex-surface:read-conversation-history',
  refreshConversations: 'codex-surface:refresh-conversations',
  renameConversation: 'codex-surface:rename-conversation',
  respondToClientRequest: 'codex-surface:respond-to-client-request',
  resolveApproval: 'codex-surface:resolve-approval',
  retryMessage: 'codex-surface:retry-message',
  setGoal: 'codex-surface:set-goal',
  selectConversation: 'codex-surface:select-conversation',
  sendMessage: 'codex-surface:send-message',
  startReview: 'codex-surface:start-review',
  steerMessage: 'codex-surface:steer-message',
  steerQueuedPrompt: 'codex-surface:steer-queued-prompt',
  unarchiveConversation: 'codex-surface:unarchive-conversation',
  updateConversationSettings: 'codex-surface:update-conversation-settings',
  stateChanged: 'codex-surface:state-changed',
  event: 'codex-surface:event',
} as const;

type SurfaceRequests = {
  [channels.archiveConversation]: IpcRequest<[conversationId: string], CodexSurfaceSnapshot>;
  [channels.clearGoal]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.compactConversation]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.connect]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.createConversation]: IpcRequest<[options?: CreateCodexRendererConversationOptions], CodexSurfaceSnapshot>;
  [channels.deleteConversation]: IpcRequest<[conversationId: string], CodexSurfaceSnapshot>;
  [channels.deleteMessage]: IpcRequest<[index: number], CodexSurfaceSnapshot>;
  [channels.deleteQueuedPrompt]: IpcRequest<[promptId: string], CodexSurfaceSnapshot>;
  [channels.editMessage]: IpcRequest<[index: number, content: string], CodexSurfaceSnapshot>;
  [channels.getSnapshot]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.interrupt]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.listConversations]: IpcRequest<[
    options?: ListCodexConversationsOptions,
  ], CodexConversationSummary[]>;
  [channels.listModels]: IpcRequest<[options?: ListCodexModelsOptions], CodexSurfaceModel[]>;
  [channels.readConversationHistory]: IpcRequest<[conversationId?: string], CodexConversationHistory>;
  [channels.refreshConversations]: IpcRequest<[], CodexSurfaceSnapshot>;
  [channels.renameConversation]: IpcRequest<[title: string], CodexSurfaceSnapshot>;
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
  [channels.startReview]: IpcRequest<[options?: StartCodexReviewOptions], CodexSurfaceSnapshot>;
  [channels.steerMessage]: IpcRequest<[prompt: string], CodexSurfaceSnapshot>;
  [channels.steerQueuedPrompt]: IpcRequest<[promptId: string], CodexSurfaceSnapshot>;
  [channels.unarchiveConversation]: IpcRequest<[conversationId: string], CodexSurfaceSnapshot>;
  [channels.updateConversationSettings]: IpcRequest<[settings: UpdateCodexConversationSettings], CodexSurfaceSnapshot>;
};

type SurfaceEvents = {
  [channels.stateChanged]: CodexSurfaceSnapshot;
  [channels.event]: CodexSurfaceEvent;
};

export type { CodexSurfaceRendererApi } from '../surface/types';

export function registerCodexSurfaceIpc(
  port: IpcMainPort,
  sender: IpcEventSender,
  surface: Pick<CodexSurface,
    | 'archiveConversation'
    | 'clearGoal'
    | 'compactConversation'
    | 'connect'
    | 'createConversation'
    | 'deleteConversation'
    | 'deleteMessage'
    | 'deleteQueuedPrompt'
    | 'editMessage'
    | 'getSnapshot'
    | 'interrupt'
    | 'listConversations'
    | 'listModels'
    | 'onEvent'
    | 'onStateChange'
    | 'readConversationHistory'
    | 'refreshConversations'
    | 'renameConversation'
    | 'respondToClientRequest'
    | 'resolveApproval'
    | 'retryMessage'
    | 'setGoal'
    | 'selectConversation'
    | 'sendMessage'
    | 'startReview'
    | 'steerMessage'
    | 'steerQueuedPrompt'
    | 'unarchiveConversation'
    | 'updateConversationSettings'>,
): () => void {
  const unregisterHandlers = registerIpcMainHandlers<SurfaceRequests>(strictArityPort(port), {
    [channels.archiveConversation]: (_event, conversationId) => (
      surface.archiveConversation(nonEmptyString(conversationId, 'Conversation id'))
    ),
    [channels.clearGoal]: () => surface.clearGoal(),
    [channels.compactConversation]: () => surface.compactConversation(),
    [channels.connect]: () => surface.connect(),
    [channels.createConversation]: (_event, options) => surface.createConversation(rendererConversationOptions(options)),
    [channels.deleteConversation]: (_event, conversationId) => (
      surface.deleteConversation(nonEmptyString(conversationId, 'Conversation id'))
    ),
    [channels.deleteMessage]: (_event, index) => surface.deleteMessage(messageIndex(index)),
    [channels.deleteQueuedPrompt]: (_event, promptId) => surface.deleteQueuedPrompt(nonEmptyString(promptId, 'Queued prompt id')),
    [channels.editMessage]: (_event, index, content) => surface.editMessage(
      messageIndex(index),
      nonEmptyString(content, 'Message content'),
    ),
    [channels.getSnapshot]: () => surface.getSnapshot(),
    [channels.interrupt]: () => surface.interrupt(),
    [channels.listConversations]: (_event, options) => surface.listConversations(
      rendererListConversationsOptions(options),
    ),
    [channels.listModels]: (_event, options) => surface.listModels(rendererListModelsOptions(options)),
    [channels.readConversationHistory]: (_event, conversationId) => (
      surface.readConversationHistory(optionalNonEmptyString(conversationId, 'Conversation id'))
    ),
    [channels.refreshConversations]: () => surface.refreshConversations(),
    [channels.renameConversation]: (_event, title) => surface.renameConversation(nonEmptyString(title, 'Conversation title')),
    [channels.respondToClientRequest]: (_event, response) => surface.respondToClientRequest(clientRequestResponse(response)),
    [channels.resolveApproval]: (_event, approvalId, decision, scope) => surface.resolveApproval(
      nonEmptyString(approvalId, 'Approval id'),
      approvalDecision(decision),
      approvalScope(scope),
    ),
    [channels.retryMessage]: (_event, index) => surface.retryMessage(messageIndex(index)),
    [channels.setGoal]: (_event, objective, tokenBudget) => (
      surface.setGoal(nonEmptyString(objective, 'Goal objective'), optionalTokenBudget(tokenBudget))
    ),
    [channels.selectConversation]: (_event, conversationId) => (
      surface.selectConversation(nonEmptyString(conversationId, 'Conversation id'))
    ),
    [channels.sendMessage]: (_event, prompt, options) => surface.sendMessage(
      nonEmptyString(prompt, 'Message prompt'),
      rendererSendOptions(options),
    ),
    [channels.startReview]: (_event, options) => surface.startReview(rendererReviewOptions(options)),
    [channels.steerMessage]: (_event, prompt) => surface.steerMessage(nonEmptyString(prompt, 'Steer prompt')),
    [channels.steerQueuedPrompt]: (_event, promptId) => surface.steerQueuedPrompt(nonEmptyString(promptId, 'Queued prompt id')),
    [channels.unarchiveConversation]: (_event, conversationId) => (
      surface.unarchiveConversation(nonEmptyString(conversationId, 'Conversation id'))
    ),
    [channels.updateConversationSettings]: (_event, settings) => (
      surface.updateConversationSettings(rendererSettings(settings))
    ),
  });
  const unsubscribeState = surface.onStateChange((snapshot) => sender.send(channels.stateChanged, snapshot));
  const unsubscribeEvents = surface.onEvent((event) => sender.send(channels.event, event));
  return () => {
    unsubscribeEvents();
    unsubscribeState();
    unregisterHandlers();
  };
}

function rendererConversationOptions(value: unknown): CreateCodexRendererConversationOptions | undefined {
  if (value === undefined) return undefined;
  const record = objectRecord(value, 'Conversation options');
  assertOnlyKeys(record, ['model', 'reasoningEffort', 'approvalPreset'], 'Conversation options');
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

function rendererListConversationsOptions(value: unknown): ListCodexConversationsOptions | undefined {
  if (value === undefined) return undefined;
  const record = objectRecord(value, 'Conversation list options');
  assertOnlyKeys(record, ['archived', 'cwd', 'limit', 'searchTerm'], 'Conversation list options');
  if (record.archived !== undefined && typeof record.archived !== 'boolean') {
    throw new TypeError('Conversation list archived flag must be a boolean');
  }
  if (
    record.limit !== undefined
    && (typeof record.limit !== 'number' || !Number.isInteger(record.limit) || record.limit < 0)
  ) {
    throw new TypeError('Conversation list limit must be a non-negative integer');
  }
  let cwd: string | string[] | undefined;
  if (record.cwd !== undefined) {
    cwd = Array.isArray(record.cwd)
      ? record.cwd.map((entry) => nonEmptyString(entry, 'Conversation list cwd'))
      : nonEmptyString(record.cwd, 'Conversation list cwd');
  }
  return {
    ...(record.archived === undefined ? {} : { archived: record.archived }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(record.limit === undefined ? {} : { limit: record.limit }),
    ...(record.searchTerm === undefined
      ? {}
      : { searchTerm: nonEmptyString(record.searchTerm, 'Conversation list search term') }),
  };
}

function rendererListModelsOptions(value: unknown): ListCodexModelsOptions | undefined {
  if (value === undefined) return undefined;
  const record = objectRecord(value, 'Model list options');
  assertOnlyKeys(record, ['includeHidden', 'forceReload'], 'Model list options');
  return {
    ...(record.includeHidden === undefined
      ? {}
      : { includeHidden: booleanValue(record.includeHidden, 'Model list includeHidden') }),
    ...(record.forceReload === undefined
      ? {}
      : { forceReload: booleanValue(record.forceReload, 'Model list forceReload') }),
  };
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
  return value;
}

function rendererSettings(value: unknown): UpdateCodexConversationSettings {
  const record = objectRecord(value, 'Conversation settings');
  assertOnlyKeys(record, ['modelId', 'reasoningEffort', 'approvalPreset', 'planMode'], 'Conversation settings');
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

function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, label);
}

function approvalDecision(value: unknown): CodexSurfaceApprovalDecision {
  if (value !== 'approve' && value !== 'deny') {
    throw new TypeError('Approval decision is invalid');
  }
  return value;
}

function approvalScope(value: unknown): CodexSurfaceApprovalScope | undefined {
  if (value === undefined) return undefined;
  if (value !== 'once' && value !== 'session') {
    throw new TypeError('Approval scope is invalid');
  }
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
  const record = objectRecord(value, 'Client request response');
  assertOnlyKeys(record, ['id', 'payload'], 'Client request response');
  const id = nonEmptyString(record.id, 'Client request id');
  if (record.payload === undefined) return { id };
  const payload = objectRecord(record.payload, 'Client request response payload');
  assertOnlyKeys(payload, ['answers', 'cancelled', 'decision'], 'Client request response payload');
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
  const answers = payload.answers === undefined ? undefined : askUserAnswers(payload.answers);
  return {
    id,
    payload: {
      ...(answers === undefined ? {} : { answers: answers as CodexSurfaceAskUserAnswers }),
      ...(payload.cancelled === undefined ? {} : { cancelled: payload.cancelled }),
      ...(decision === undefined ? {} : { decision: decision as NonNullable<CodexSurfaceClientRequestResponse['payload']>['decision'] }),
    },
  };
}

function askUserAnswers(value: unknown): CodexSurfaceAskUserAnswers {
  const record = objectRecord(value, 'Client request answers');
  const answers: CodexSurfaceAskUserAnswers = {};
  for (const [questionId, rawAnswer] of Object.entries(record)) {
    if (!questionId.trim()) throw new TypeError('Client request question id must be non-empty');
    const answer = objectRecord(rawAnswer, 'Client request answer');
    assertOnlyKeys(answer, ['answers'], 'Client request answer');
    if (!Array.isArray(answer.answers) || !answer.answers.every((item) => typeof item === 'string')) {
      throw new TypeError('Client request answer values must be an array of strings');
    }
    Object.defineProperty(answers, questionId, {
      configurable: true,
      enumerable: true,
      value: { answers: [...answer.answers] },
      writable: true,
    });
  }
  return answers;
}

function rendererSendOptions(value: unknown): SendCodexMessageOptions | undefined {
  if (value === undefined) return undefined;
  const record = objectRecord(value, 'Message options');
  assertOnlyKeys(record, ['attachments', 'model', 'reasoningEffort', 'planMode', 'skills', 'outputSchema'], 'Message options');
  if (record.planMode !== undefined && typeof record.planMode !== 'boolean') {
    throw new TypeError('Message plan mode must be a boolean');
  }
  const skills = record.skills === undefined ? undefined : skillInputs(record.skills);
  const attachments = record.attachments === undefined ? undefined : attachmentInputs(record.attachments);
  const outputSchema = record.outputSchema;
  if (outputSchema !== undefined && !isJsonValue(outputSchema)) {
    throw new TypeError('Message output schema must be JSON-serializable');
  }
  return {
    ...(attachments === undefined ? {} : { attachments }),
    ...(record.model === undefined ? {} : { model: nonEmptyString(record.model, 'Message model') }),
    ...(record.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: nonEmptyString(record.reasoningEffort, 'Message reasoning effort') }),
    ...(record.planMode === undefined ? {} : { planMode: record.planMode }),
    ...(skills === undefined ? {} : { skills }),
    ...(outputSchema === undefined ? {} : { outputSchema }),
  };
}

function attachmentInputs(value: unknown): NonNullable<SendCodexMessageOptions['attachments']> {
  if (!Array.isArray(value)) throw new TypeError('Message attachments must be an array');
  return value.map((rawAttachment) => {
    const attachment = objectRecord(rawAttachment, 'Message attachment');
    if (attachment.type === 'image') {
      assertOnlyKeys(attachment, ['type', 'path', 'detail', 'name', 'mimeType', 'previewUrl'], 'Message attachment');
      if (
        attachment.detail !== undefined
        && attachment.detail !== 'auto'
        && attachment.detail !== 'low'
        && attachment.detail !== 'high'
        && attachment.detail !== 'original'
      ) throw new TypeError('Message image detail is invalid');
      return {
        type: 'image' as const,
        path: nonEmptyString(attachment.path, 'Message attachment path'),
        ...(attachment.detail === undefined ? {} : { detail: attachment.detail }),
        ...(attachment.name === undefined ? {} : { name: displayString(attachment.name, 'Message attachment name') }),
        ...(attachment.mimeType === undefined
          ? {}
          : { mimeType: displayString(attachment.mimeType, 'Message attachment MIME type') }),
        ...(attachment.previewUrl === undefined
          ? {}
          : { previewUrl: imagePreviewUrl(attachment.previewUrl) }),
      };
    }
    if (attachment.type === 'file') {
      assertOnlyKeys(attachment, ['type', 'path', 'name', 'mimeType'], 'Message attachment');
      return {
        type: 'file' as const,
        path: nonEmptyString(attachment.path, 'Message attachment path'),
        ...(attachment.name === undefined
          ? {}
          : { name: displayString(attachment.name, 'Message attachment name') }),
        ...(attachment.mimeType === undefined
          ? {}
          : { mimeType: displayString(attachment.mimeType, 'Message attachment MIME type') }),
      };
    }
    throw new TypeError('Message attachment type is invalid');
  });
}

function displayString(value: unknown, label: string): string {
  const result = nonEmptyString(value, label);
  if (result.length > 1_024) throw new RangeError(`${label} is too long`);
  return result;
}

function imagePreviewUrl(value: unknown): string {
  const previewUrl = nonEmptyString(value, 'Message attachment preview URL');
  if (previewUrl.length > 16 * 1024 * 1024) {
    throw new RangeError('Message attachment preview URL is too large');
  }
  if (!/^data:image\/(?:avif|bmp|gif|heic|heif|jpe?g|png|webp);base64,[a-z\d+/=]+$/i.test(previewUrl)) {
    throw new TypeError('Message attachment preview URL must be a base64 image data URL');
  }
  return previewUrl;
}

function skillInputs(value: unknown): NonNullable<SendCodexMessageOptions['skills']> {
  if (!Array.isArray(value)) throw new TypeError('Message skills must be an array');
  return value.map((rawSkill) => {
    const skill = objectRecord(rawSkill, 'Message skill');
    assertOnlyKeys(skill, ['name', 'path'], 'Message skill');
    return {
      name: nonEmptyString(skill.name, 'Message skill name'),
      path: nonEmptyString(skill.path, 'Message skill path'),
    };
  });
}

function rendererReviewOptions(value: unknown): StartCodexReviewOptions | undefined {
  if (value === undefined) return undefined;
  const record = objectRecord(value, 'Review options');
  assertOnlyKeys(record, ['target'], 'Review options');
  if (record.target === undefined) return {};
  const target = objectRecord(record.target, 'Review target');
  if (target.type === 'uncommittedChanges') {
    assertOnlyKeys(target, ['type'], 'Review target');
    return { target: { type: 'uncommittedChanges' } };
  }
  if (target.type === 'baseBranch') {
    assertOnlyKeys(target, ['type', 'branch'], 'Review target');
    return { target: { type: 'baseBranch', branch: nonEmptyString(target.branch, 'Review branch') } };
  }
  if (target.type === 'commit') {
    assertOnlyKeys(target, ['type', 'sha', 'title'], 'Review target');
    if (target.title !== undefined && target.title !== null && typeof target.title !== 'string') {
      throw new TypeError('Review commit title must be a string or null');
    }
    return {
      target: {
        type: 'commit',
        sha: nonEmptyString(target.sha, 'Review commit SHA'),
        ...(target.title === undefined ? {} : { title: target.title }),
      },
    };
  }
  if (target.type === 'custom') {
    assertOnlyKeys(target, ['type', 'instructions'], 'Review target');
    return { target: { type: 'custom', instructions: nonEmptyString(target.instructions, 'Review instructions') } };
  }
  throw new TypeError('Review target type is invalid');
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) {
    throw new TypeError(`${label} must not contain symbol properties`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  const unknownKey = Object.getOwnPropertyNames(record).find((key) => !allowed.has(key));
  if (unknownKey) throw new TypeError(`${label} contains unsupported property "${unknownKey}"`);
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is CodexSurfaceJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  const symbolKeys = Reflect.ownKeys(value).filter((key) => typeof key === 'symbol');
  if (symbolKeys.length > 0) return false;
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (
      keys.length !== value.length
      || keys.some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      || Object.getOwnPropertyNames(value).length !== value.length + 1
    ) return false;
  } else {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (Object.keys(value).length !== Object.getOwnPropertyNames(value).length) return false;
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

const channelArities: Record<keyof SurfaceRequests, readonly [minimum: number, maximum: number]> = {
  [channels.archiveConversation]: [1, 1],
  [channels.clearGoal]: [0, 0],
  [channels.compactConversation]: [0, 0],
  [channels.connect]: [0, 0],
  [channels.createConversation]: [0, 1],
  [channels.deleteConversation]: [1, 1],
  [channels.deleteMessage]: [1, 1],
  [channels.deleteQueuedPrompt]: [1, 1],
  [channels.editMessage]: [2, 2],
  [channels.getSnapshot]: [0, 0],
  [channels.interrupt]: [0, 0],
  [channels.listConversations]: [0, 1],
  [channels.listModels]: [0, 1],
  [channels.readConversationHistory]: [0, 1],
  [channels.refreshConversations]: [0, 0],
  [channels.renameConversation]: [1, 1],
  [channels.respondToClientRequest]: [1, 1],
  [channels.resolveApproval]: [2, 3],
  [channels.retryMessage]: [1, 1],
  [channels.setGoal]: [1, 2],
  [channels.selectConversation]: [1, 1],
  [channels.sendMessage]: [1, 2],
  [channels.startReview]: [0, 1],
  [channels.steerMessage]: [1, 1],
  [channels.steerQueuedPrompt]: [1, 1],
  [channels.unarchiveConversation]: [1, 1],
  [channels.updateConversationSettings]: [1, 1],
};

function strictArityPort(port: IpcMainPort): IpcMainPort {
  return {
    handle(channel, handler) {
      port.handle(channel, (event, ...args) => {
        const [minimum, maximum] = channelArities[channel as keyof SurfaceRequests]!;
        if (args.length < minimum || args.length > maximum) {
          throw new TypeError(`${channel} received an invalid number of arguments`);
        }
        return handler(event, ...args);
      });
    },
    removeHandler: (channel) => port.removeHandler(channel),
  };
}

export function createCodexSurfaceRendererApi(port: IpcRendererPort): CodexSurfaceRendererApi {
  const renderer = new TypedIpcRenderer<SurfaceRequests, SurfaceEvents>(port);
  return {
    archiveConversation: (conversationId) => renderer.invoke(channels.archiveConversation, conversationId),
    clearGoal: () => renderer.invoke(channels.clearGoal),
    compactConversation: () => renderer.invoke(channels.compactConversation),
    connect: () => renderer.invoke(channels.connect),
    createConversation: (options) => renderer.invoke(channels.createConversation, options),
    deleteConversation: (conversationId) => renderer.invoke(channels.deleteConversation, conversationId),
    deleteMessage: (index) => renderer.invoke(channels.deleteMessage, index),
    deleteQueuedPrompt: (promptId) => renderer.invoke(channels.deleteQueuedPrompt, promptId),
    editMessage: (index, content) => renderer.invoke(channels.editMessage, index, content),
    getSnapshot: () => renderer.invoke(channels.getSnapshot),
    interrupt: () => renderer.invoke(channels.interrupt),
    listConversations: (options) => renderer.invoke(channels.listConversations, options),
    listModels: (options) => renderer.invoke(channels.listModels, options),
    onEvent: (listener) => renderer.on(channels.event, listener),
    onStateChange: (listener) => renderer.on(channels.stateChanged, listener),
    readConversationHistory: (conversationId) => renderer.invoke(channels.readConversationHistory, conversationId),
    refreshConversations: () => renderer.invoke(channels.refreshConversations),
    renameConversation: (title) => renderer.invoke(channels.renameConversation, title),
    respondToClientRequest: (response) => renderer.invoke(channels.respondToClientRequest, response),
    resolveApproval: (approvalId, decision, scope) => renderer.invoke(channels.resolveApproval, approvalId, decision, scope),
    retryMessage: (index) => renderer.invoke(channels.retryMessage, index),
    setGoal: (objective, tokenBudget) => renderer.invoke(channels.setGoal, objective, tokenBudget),
    selectConversation: (conversationId) => renderer.invoke(channels.selectConversation, conversationId),
    sendMessage: (prompt, options) => renderer.invoke(channels.sendMessage, prompt, options),
    startReview: (options) => renderer.invoke(channels.startReview, options),
    steerMessage: (prompt) => renderer.invoke(channels.steerMessage, prompt),
    steerQueuedPrompt: (promptId) => renderer.invoke(channels.steerQueuedPrompt, promptId),
    unarchiveConversation: (conversationId) => renderer.invoke(channels.unarchiveConversation, conversationId),
    updateConversationSettings: (settings) => renderer.invoke(channels.updateConversationSettings, settings),
  };
}
