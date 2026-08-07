import type {
  CodexSurfaceApi,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfaceAskUserAnswers,
  CodexSurfaceClientRequestResponse,
  CodexSurfaceJsonValue,
  CodexSurfaceRendererApi,
  CreateCodexRendererConversationOptions,
  ListCodexConversationsOptions,
  ListCodexModelsOptions,
  SendCodexMessageOptions,
  StartCodexReviewOptions,
  UpdateCodexConversationSettings,
} from './surface';

type RequiredRendererApi = Required<CodexSurfaceRendererApi>;
export type CodexSurfaceBridgeOperation = Exclude<keyof RequiredRendererApi, 'onEvent' | 'onStateChange'>;
type OperationFunction<Name extends CodexSurfaceBridgeOperation> = Extract<
  RequiredRendererApi[Name],
  (...args: never[]) => unknown
>;
export type CodexSurfaceBridgeOperationArguments<Name extends CodexSurfaceBridgeOperation> =
  Parameters<OperationFunction<Name>>;
export type CodexSurfaceBridgeOperationResult<Name extends CodexSurfaceBridgeOperation> =
  Awaited<ReturnType<OperationFunction<Name>>>;
type Awaitable<Value> = Value | Promise<Value>;
export type CodexSurfaceBridgeTarget = {
  [Name in CodexSurfaceBridgeOperation]: (
    ...args: CodexSurfaceBridgeOperationArguments<Name>
  ) => Awaitable<CodexSurfaceBridgeOperationResult<Name>>;
} & Pick<CodexSurfaceApi, 'onEvent' | 'onStateChange'>;

export const codexSurfaceBridgeOperations = [
  'archiveConversation', 'cancelLogin', 'clearGoal', 'compactConversation', 'connect',
  'createConversation', 'deleteConversation', 'deleteMessage', 'deleteQueuedPrompt',
  'editMessage', 'forkMessage', 'getSnapshot', 'interrupt', 'listConversations',
  'listModels', 'loadOlderConversationHistory', 'logout', 'readConversationHistory',
  'refreshAccount', 'refreshConversations', 'renameConversation', 'respondToClientRequest',
  'resolveApproval', 'retryMessage', 'selectConversation', 'sendMessage', 'setGoal',
  'startChatGptLogin', 'startReview', 'steerMessage', 'steerQueuedPrompt',
  'unarchiveConversation', 'updateConversationSettings',
] as const satisfies readonly CodexSurfaceBridgeOperation[];

const operationSet = new Set<string>(codexSurfaceBridgeOperations);
export const codexSurfaceBridgeArities: Readonly<
  Record<CodexSurfaceBridgeOperation, readonly [minimum: number, maximum: number]>
> = {
  archiveConversation: [1, 1], cancelLogin: [0, 1], clearGoal: [0, 0],
  compactConversation: [0, 0], connect: [0, 0], createConversation: [0, 1],
  deleteConversation: [1, 1], deleteMessage: [1, 1], deleteQueuedPrompt: [1, 1],
  editMessage: [2, 2], forkMessage: [1, 1], getSnapshot: [0, 0], interrupt: [0, 0],
  listConversations: [0, 1], listModels: [0, 1], loadOlderConversationHistory: [0, 1],
  logout: [0, 0], readConversationHistory: [0, 1], refreshAccount: [0, 0],
  refreshConversations: [0, 0], renameConversation: [1, 1], respondToClientRequest: [1, 1],
  resolveApproval: [2, 3], retryMessage: [1, 1], selectConversation: [1, 1],
  sendMessage: [1, 2], setGoal: [1, 2], startChatGptLogin: [0, 0], startReview: [0, 1],
  steerMessage: [1, 2], steerQueuedPrompt: [1, 1], unarchiveConversation: [1, 1],
  updateConversationSettings: [1, 1],
};

export function isCodexSurfaceBridgeOperation(value: unknown): value is CodexSurfaceBridgeOperation {
  return typeof value === 'string' && operationSet.has(value);
}

export async function invokeCodexSurfaceBridgeOperation<Name extends CodexSurfaceBridgeOperation>(
  target: CodexSurfaceBridgeTarget,
  operation: Name,
  args: readonly unknown[],
  operationLabel: string = operation,
): Promise<CodexSurfaceBridgeOperationResult<Name>> {
  const [minimum, maximum] = codexSurfaceBridgeArities[operation];
  if (args.length < minimum || args.length > maximum) {
    throw new TypeError(`${operationLabel} received an invalid number of arguments`);
  }
  const result = await invokeValidated(target, operation, args);
  return result as CodexSurfaceBridgeOperationResult<Name>;
}

async function invokeValidated(
  target: CodexSurfaceBridgeTarget,
  operation: CodexSurfaceBridgeOperation,
  args: readonly unknown[],
): Promise<unknown> {
  switch (operation) {
    case 'archiveConversation': return target.archiveConversation(nonEmptyString(args[0], 'Conversation id'));
    case 'cancelLogin': return target.cancelLogin(optionalString(args[0], 'Login id'));
    case 'clearGoal': return target.clearGoal();
    case 'compactConversation': return target.compactConversation();
    case 'connect': return target.connect();
    case 'createConversation': return target.createConversation(conversationOptions(args[0]));
    case 'deleteConversation': return target.deleteConversation(nonEmptyString(args[0], 'Conversation id'));
    case 'deleteMessage': return target.deleteMessage(messageIndex(args[0]));
    case 'deleteQueuedPrompt': return target.deleteQueuedPrompt(nonEmptyString(args[0], 'Queued prompt id'));
    case 'editMessage': return target.editMessage(messageIndex(args[0]), nonEmptyString(args[1], 'Message content'));
    case 'forkMessage': return target.forkMessage(messageIndex(args[0]));
    case 'getSnapshot': return target.getSnapshot();
    case 'interrupt': return target.interrupt();
    case 'listConversations': return target.listConversations(listConversationOptions(args[0]));
    case 'listModels': return target.listModels(listModelOptions(args[0]));
    case 'loadOlderConversationHistory': return target.loadOlderConversationHistory(optionalString(args[0], 'Conversation id'));
    case 'logout': return target.logout();
    case 'readConversationHistory': return target.readConversationHistory(optionalString(args[0], 'Conversation id'));
    case 'refreshAccount': return target.refreshAccount();
    case 'refreshConversations': return target.refreshConversations();
    case 'renameConversation': return target.renameConversation(nonEmptyString(args[0], 'Conversation title'));
    case 'respondToClientRequest': return target.respondToClientRequest(clientRequestResponse(args[0]));
    case 'resolveApproval': return target.resolveApproval(
      nonEmptyString(args[0], 'Approval id'), approvalDecision(args[1]), approvalScope(args[2]),
    );
    case 'retryMessage': return target.retryMessage(messageIndex(args[0]));
    case 'selectConversation': return target.selectConversation(nonEmptyString(args[0], 'Conversation id'));
    case 'sendMessage': return target.sendMessage(nonEmptyString(args[0], 'Message prompt'), sendOptions(args[1]));
    case 'setGoal': return target.setGoal(nonEmptyString(args[0], 'Goal objective'), tokenBudget(args[1]));
    case 'startChatGptLogin': return target.startChatGptLogin();
    case 'startReview': return target.startReview(reviewOptions(args[0]));
    case 'steerMessage': return target.steerMessage(nonEmptyString(args[0], 'Steer prompt'), sendOptions(args[1]));
    case 'steerQueuedPrompt': return target.steerQueuedPrompt(nonEmptyString(args[0], 'Queued prompt id'));
    case 'unarchiveConversation': return target.unarchiveConversation(nonEmptyString(args[0], 'Conversation id'));
    case 'updateConversationSettings': return target.updateConversationSettings(settings(args[0]));
  }
}

function conversationOptions(value: unknown): CreateCodexRendererConversationOptions | undefined {
  if (value === undefined) return undefined;
  const record = plainObject(value, 'Conversation options');
  onlyKeys(record, ['model', 'reasoningEffort', 'serviceTier', 'approvalPreset'], 'Conversation options');
  return {
    ...(record.model === undefined ? {} : { model: nonEmptyString(record.model, 'Conversation model') }),
    ...(record.reasoningEffort === undefined ? {} : { reasoningEffort: nonEmptyString(record.reasoningEffort, 'Conversation reasoning effort') }),
    ...(record.serviceTier === undefined ? {} : { serviceTier: nullableString(record.serviceTier, 'Conversation service tier') }),
    ...(record.approvalPreset === undefined ? {} : { approvalPreset: approvalPreset(record.approvalPreset) }),
  };
}

function listConversationOptions(value: unknown): ListCodexConversationsOptions | undefined {
  if (value === undefined) return undefined;
  const record = plainObject(value, 'Conversation list options');
  onlyKeys(record, ['archived', 'cwd', 'limit', 'searchTerm'], 'Conversation list options');
  if (record.archived !== undefined && typeof record.archived !== 'boolean') {
    throw new TypeError('Conversation list archived flag must be a boolean');
  }
  if (record.limit !== undefined && (!Number.isInteger(record.limit) || (record.limit as number) < 0)) {
    throw new TypeError('Conversation list limit must be a non-negative integer');
  }
  const cwd = record.cwd === undefined ? undefined : Array.isArray(record.cwd)
    ? record.cwd.map((entry) => nonEmptyString(entry, 'Conversation list cwd'))
    : nonEmptyString(record.cwd, 'Conversation list cwd');
  return {
    ...(record.archived === undefined ? {} : { archived: record.archived }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(record.limit === undefined ? {} : { limit: record.limit as number }),
    ...(record.searchTerm === undefined ? {} : { searchTerm: nonEmptyString(record.searchTerm, 'Conversation list search term') }),
  };
}

function listModelOptions(value: unknown): ListCodexModelsOptions | undefined {
  if (value === undefined) return undefined;
  const record = plainObject(value, 'Model list options');
  onlyKeys(record, ['includeHidden', 'forceReload'], 'Model list options');
  return {
    ...(record.includeHidden === undefined ? {} : { includeHidden: booleanValue(record.includeHidden, 'Model list includeHidden') }),
    ...(record.forceReload === undefined ? {} : { forceReload: booleanValue(record.forceReload, 'Model list forceReload') }),
  };
}

function settings(value: unknown): UpdateCodexConversationSettings {
  const record = plainObject(value, 'Conversation settings');
  onlyKeys(record, ['modelId', 'reasoningEffort', 'serviceTier', 'approvalPreset', 'planMode'], 'Conversation settings');
  return {
    ...(record.modelId === undefined ? {} : { modelId: nonEmptyString(record.modelId, 'Conversation model id') }),
    ...(record.reasoningEffort === undefined ? {} : { reasoningEffort: nonEmptyString(record.reasoningEffort, 'Conversation reasoning effort') }),
    ...(record.serviceTier === undefined ? {} : { serviceTier: nullableString(record.serviceTier, 'Conversation service tier') }),
    ...(record.approvalPreset === undefined ? {} : { approvalPreset: approvalPreset(record.approvalPreset) }),
    ...(record.planMode === undefined ? {} : { planMode: booleanValue(record.planMode, 'Conversation plan mode') }),
  };
}

function clientRequestResponse(value: unknown): CodexSurfaceClientRequestResponse {
  const record = plainObject(value, 'Client request response');
  onlyKeys(record, ['id', 'payload'], 'Client request response');
  const id = nonEmptyString(record.id, 'Client request id');
  if (record.payload === undefined) return { id };
  const payload = plainObject(record.payload, 'Client request response payload');
  onlyKeys(payload, ['answers', 'cancelled', 'decision'], 'Client request response payload');
  const decision = payload.decision;
  const validDecisions = [null, 'allow', 'allow_conversation', 'always_allow', 'deny'];
  if (decision !== undefined && !validDecisions.includes(decision as string | null)) {
    throw new TypeError('Client request decision is invalid');
  }
  const answers = payload.answers === undefined ? undefined : askUserAnswers(payload.answers);
  return {
    id,
    payload: {
      ...(answers === undefined ? {} : { answers }),
      ...(payload.cancelled === undefined ? {} : { cancelled: booleanValue(payload.cancelled, 'Client request cancelled flag') }),
      ...(decision === undefined ? {} : { decision: decision as NonNullable<CodexSurfaceClientRequestResponse['payload']>['decision'] }),
    },
  };
}

function askUserAnswers(value: unknown): CodexSurfaceAskUserAnswers {
  const record = plainObject(value, 'Client request answers');
  const answers: CodexSurfaceAskUserAnswers = {};
  for (const [questionId, rawAnswer] of Object.entries(record)) {
    if (!questionId.trim()) throw new TypeError('Client request question id must be non-empty');
    const answer = plainObject(rawAnswer, 'Client request answer');
    onlyKeys(answer, ['answers'], 'Client request answer');
    if (!Array.isArray(answer.answers) || !answer.answers.every((item) => typeof item === 'string')) {
      throw new TypeError('Client request answer values must be an array of strings');
    }
    answers[questionId] = { answers: [...answer.answers] };
  }
  return answers;
}

function sendOptions(value: unknown): SendCodexMessageOptions | undefined {
  if (value === undefined) return undefined;
  const record = plainObject(value, 'Message options');
  onlyKeys(record, ['attachments', 'model', 'reasoningEffort', 'serviceTier', 'planMode', 'skills', 'outputSchema'], 'Message options');
  const attachments = record.attachments === undefined ? undefined : attachmentInputs(record.attachments);
  const skills = record.skills === undefined ? undefined : skillInputs(record.skills);
  if (record.outputSchema !== undefined && !isJsonValue(record.outputSchema)) {
    throw new TypeError('Message output schema must be JSON-serializable');
  }
  return {
    ...(attachments === undefined ? {} : { attachments }),
    ...(record.model === undefined ? {} : { model: nonEmptyString(record.model, 'Message model') }),
    ...(record.reasoningEffort === undefined ? {} : { reasoningEffort: nonEmptyString(record.reasoningEffort, 'Message reasoning effort') }),
    ...(record.serviceTier === undefined ? {} : { serviceTier: nullableString(record.serviceTier, 'Message service tier') }),
    ...(record.planMode === undefined ? {} : { planMode: booleanValue(record.planMode, 'Message plan mode') }),
    ...(skills === undefined ? {} : { skills }),
    ...(record.outputSchema === undefined ? {} : { outputSchema: record.outputSchema }),
  };
}

function attachmentInputs(value: unknown): NonNullable<SendCodexMessageOptions['attachments']> {
  if (!Array.isArray(value)) throw new TypeError('Message attachments must be an array');
  return value.map((rawAttachment) => {
    const attachment = plainObject(rawAttachment, 'Message attachment');
    if (attachment.type !== 'image' && attachment.type !== 'file') {
      throw new TypeError('Message attachment type is invalid');
    }
    const image = attachment.type === 'image';
    onlyKeys(
      attachment,
      image ? ['type', 'path', 'detail', 'name', 'mimeType', 'previewUrl'] : ['type', 'path', 'name', 'mimeType'],
      'Message attachment',
    );
    if (image && attachment.detail !== undefined && !['auto', 'low', 'high', 'original'].includes(String(attachment.detail))) {
      throw new TypeError('Message image detail is invalid');
    }
    const common = {
      path: nonEmptyString(attachment.path, 'Message attachment path'),
      ...(attachment.name === undefined ? {} : { name: displayString(attachment.name, 'Message attachment name') }),
      ...(attachment.mimeType === undefined ? {} : { mimeType: displayString(attachment.mimeType, 'Message attachment MIME type') }),
    };
    return image ? {
      type: 'image' as const,
      ...common,
      ...(attachment.detail === undefined ? {} : { detail: attachment.detail as 'auto' | 'low' | 'high' | 'original' }),
      ...(attachment.previewUrl === undefined ? {} : { previewUrl: imagePreviewUrl(attachment.previewUrl) }),
    } : { type: 'file' as const, ...common };
  });
}

function skillInputs(value: unknown): NonNullable<SendCodexMessageOptions['skills']> {
  if (!Array.isArray(value)) throw new TypeError('Message skills must be an array');
  return value.map((rawSkill) => {
    const skill = plainObject(rawSkill, 'Message skill');
    onlyKeys(skill, ['name', 'path'], 'Message skill');
    return { name: nonEmptyString(skill.name, 'Message skill name'), path: nonEmptyString(skill.path, 'Message skill path') };
  });
}

function reviewOptions(value: unknown): StartCodexReviewOptions | undefined {
  if (value === undefined) return undefined;
  const record = plainObject(value, 'Review options');
  onlyKeys(record, ['target'], 'Review options');
  if (record.target === undefined) return {};
  const target = plainObject(record.target, 'Review target');
  if (target.type === 'uncommittedChanges') {
    onlyKeys(target, ['type'], 'Review target');
    return { target: { type: 'uncommittedChanges' } };
  }
  if (target.type === 'baseBranch') {
    onlyKeys(target, ['type', 'branch'], 'Review target');
    return { target: { type: 'baseBranch', branch: nonEmptyString(target.branch, 'Review branch') } };
  }
  if (target.type === 'commit') {
    onlyKeys(target, ['type', 'sha', 'title'], 'Review target');
    if (target.title !== undefined && target.title !== null && typeof target.title !== 'string') {
      throw new TypeError('Review commit title must be a string or null');
    }
    return { target: { type: 'commit', sha: nonEmptyString(target.sha, 'Review commit SHA'), ...(target.title === undefined ? {} : { title: target.title }) } };
  }
  if (target.type === 'custom') {
    onlyKeys(target, ['type', 'instructions'], 'Review target');
    return { target: { type: 'custom', instructions: nonEmptyString(target.instructions, 'Review instructions') } };
  }
  throw new TypeError('Review target type is invalid');
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`);
  if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) throw new TypeError(`${label} must not contain symbol properties`);
  return value as Record<string, unknown>;
}

function onlyKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  const unknownKey = Object.getOwnPropertyNames(record).find((key) => !allowed.has(key));
  if (unknownKey) throw new TypeError(`${label} contains unsupported property "${unknownKey}"`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}
function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, label);
}
function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonEmptyString(value, label);
}
function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
  return value;
}
function approvalDecision(value: unknown): CodexSurfaceApprovalDecision {
  if (value !== 'approve' && value !== 'deny') throw new TypeError('Approval decision is invalid');
  return value;
}
function approvalScope(value: unknown): CodexSurfaceApprovalScope | undefined {
  if (value === undefined) return undefined;
  if (value !== 'once' && value !== 'session') throw new TypeError('Approval scope is invalid');
  return value;
}
function approvalPreset(value: unknown): UpdateCodexConversationSettings['approvalPreset'] {
  if (!['ask-for-approval', 'approve-for-me', 'full-access'].includes(String(value))) {
    throw new TypeError('Conversation approval preset is invalid');
  }
  return value as UpdateCodexConversationSettings['approvalPreset'];
}
function tokenBudget(value: unknown): number | null | undefined {
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
function displayString(value: unknown, label: string): string {
  const result = nonEmptyString(value, label);
  if (result.length > 1_024) throw new RangeError(`${label} is too long`);
  return result;
}
function imagePreviewUrl(value: unknown): string {
  const result = nonEmptyString(value, 'Message attachment preview URL');
  if (result.length > 16 * 1024 * 1024) throw new RangeError('Message attachment preview URL is too large');
  if (!/^data:image\/(?:avif|bmp|gif|heic|heif|jpe?g|png|webp);base64,[a-z\d+/=]+$/i.test(result)) {
    throw new TypeError('Message attachment preview URL must be a base64 image data URL');
  }
  return result;
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is CodexSurfaceJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value) || Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) return false;
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return false;
  } else {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if ((prototype !== Object.prototype && prototype !== null) || Object.keys(value).length !== Object.getOwnPropertyNames(value).length) return false;
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value as Record<string, unknown>).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}
