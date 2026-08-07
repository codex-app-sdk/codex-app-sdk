import type { CodexAppServerClient, v2 } from '../codex/index';
import type {
  CodexConversationSummary,
  CodexSurfaceSnapshot,
  SendCodexMessageOptions,
} from '@codex-app-sdk/core/surface';
import { codexThreadToSurfaceMessages } from './codex-conversation-history';
import { CodexSurfaceCatalogController } from './codex-surface-catalog-controller';
import { CodexSurfaceExtensionsController } from './codex-surface-extensions-controller';
import { activeTurnId, ensureAssistantTurnMessage } from './codex-surface-message-state';
import { normalizeMcpServers } from './codex-surface-mcp';
import {
  approvalPresetStartParams,
  collaborationMode,
  requireCatalogModel,
  selectedModel,
  sessionSelection,
  validateReasoningEffort,
  validateServiceTier,
} from './codex-surface-settings';
import {
  messageAt,
  messageTurnId,
  messageTurnIdOrNull,
  surfaceMessageAttachments,
  surfaceMessageText,
  surfaceThreadStatus,
  threadToSummary,
  upsertConversation,
} from './codex-surface-data';
import type {
  CodexConversationLoadOptions,
  ForkCodexConversationOptions,
} from './codex-surface-contracts';
import type { ThreadRuntimePatch, ThreadRuntimeState } from './codex-surface-runtime';

const FORK_HISTORY_PAGE_SIZE = 5;

export type CodexSurfaceForkHost = {
  createRuntime(threadId: string, patch?: ThreadRuntimePatch): ThreadRuntimeState;
  emitConversationActivity(threadId: string): void;
  emitConversationPermissions(threadId: string): void;
  emitConversationSettings(threadId: string): void;
  emitConversationSkills(threadId: string): void;
  emitHistoryReplaced(threadId: string): void;
  emitSummaryUpserted(summary: CodexConversationSummary): void;
  ensureConnected(): Promise<void>;
  getState(): CodexSurfaceSnapshot;
  hydrateCompleteHistory(threadId: string, cursor: string): Promise<void>;
  patch(patch: Partial<CodexSurfaceSnapshot>): void;
  rememberHostOptions(threadId: string, options: CodexConversationLoadOptions): void;
  requireRuntime(threadId: string): ThreadRuntimeState;
  sendMessageToThread(threadId: string, prompt: string, options?: SendCodexMessageOptions): Promise<void>;
  snapshotForRuntime(runtime: ThreadRuntimeState): CodexSurfaceSnapshot;
};

type CodexForkBoundary = {
  beforeTurnId?: string;
  lastTurnId?: string;
};

export class CodexSurfaceForkController {
  constructor(
    private readonly client: CodexAppServerClient,
    private readonly loadingStrategy: 'eager' | 'lazy' | undefined,
    private readonly catalog: CodexSurfaceCatalogController,
    private readonly extensions: CodexSurfaceExtensionsController,
    private readonly host: CodexSurfaceForkHost,
  ) {}

  async fork(
    sourceThreadId: string,
    options: ForkCodexConversationOptions = {},
    hostOptions: CodexConversationLoadOptions = {},
    boundary: CodexForkBoundary = {},
  ): Promise<string> {
    await this.host.ensureConnected();
    const sourceRuntime = this.host.requireRuntime(sourceThreadId);
    if (
      (sourceRuntime.busy || sourceRuntime.activeTurnId)
      && !boundary.beforeTurnId
      && (!boundary.lastTurnId || boundary.lastTurnId === sourceRuntime.activeTurnId)
    ) {
      throw new Error('Cannot fork a conversation while its current turn is still active');
    }

    const cwd = options.cwd ?? sourceRuntime.cwd ?? hostOptions.cwd;
    const catalogs = await this.catalog.loadConversationCatalogs(cwd ?? undefined);
    const state = this.host.getState();
    const requestedModel = options.model
      ? requireCatalogModel(state.models, options.model)
      : selectedModel(state.models, sourceRuntime.selectedModelId);
    validateReasoningEffort(requestedModel, options.reasoningEffort);
    validateServiceTier(requestedModel, options.serviceTier);

    const mcpServers = hostOptions.mcpServers === undefined
      ? this.extensions.defaultMcpServers
      : normalizeMcpServers(hostOptions.mcpServers);
    const extension = await this.extensions.conversationExtension({
      operation: 'start',
      conversationId: null,
      cwd: cwd ?? undefined,
      createOptions: options,
      extensionContext: hostOptions.extensionContext,
    }, options, mcpServers);
    const response = await this.client.request('thread/fork', {
      threadId: sourceThreadId,
      ...(boundary.beforeTurnId ? { beforeTurnId: boundary.beforeTurnId } : {}),
      ...(boundary.lastTurnId ? { lastTurnId: boundary.lastTurnId } : {}),
      excludeTurns: true,
      deferGoalContinuation: true,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.model && requestedModel ? { model: requestedModel.model } : {}),
      ...(options.serviceTier === undefined ? {} : { serviceTier: options.serviceTier }),
      ...(extension.baseInstructions === undefined ? {} : { baseInstructions: extension.baseInstructions }),
      ...(extension.developerInstructions === undefined
        ? {}
        : { developerInstructions: extension.developerInstructions }),
      ...(extension.config === undefined ? {} : { config: extension.config as v2.ThreadForkParams['config'] }),
      ...forkApprovalSettings(options, catalogs.approvalPresets),
    });
    if (!response.thread.id || response.thread.id === sourceThreadId) {
      throw new Error(`Codex thread/fork returned an invalid new thread id '${response.thread.id}'`);
    }
    if (options.reasoningEffort) {
      await this.client.request('thread/settings/update', {
        threadId: response.thread.id,
        effort: options.reasoningEffort,
        ...(requestedModel ? {
          collaborationMode: collaborationMode(
            sourceRuntime.planMode,
            requestedModel.model,
            options.reasoningEffort,
          ),
        } : {}),
      });
    }

    const [initialPage, goal] = await Promise.all([
      this.client.request('thread/turns/list', {
        threadId: response.thread.id,
        cursor: null,
        limit: FORK_HISTORY_PAGE_SIZE,
        sortDirection: 'desc',
        itemsView: 'full',
      }),
      this.client.request('thread/goal/get', { threadId: response.thread.id })
        .then((result) => result.goal)
        .catch(() => null),
    ]);
    const turns = [...initialPage.data].reverse();
    const runningTurnId = activeTurnId(turns);
    const historyMessages = codexThreadToSurfaceMessages({ ...response.thread, turns });
    const messages = runningTurnId
      ? ensureAssistantTurnMessage(historyMessages, response.thread.id, runningTurnId)
      : historyMessages;
    const effectiveLoadingStrategy = hostOptions.loadingStrategy ?? this.loadingStrategy ?? 'lazy';
    const runtime = this.host.createRuntime(response.thread.id, {
      hydrated: true,
      loadingStrategy: effectiveLoadingStrategy,
      historyCursor: initialPage.nextCursor,
      historyHasOlder: initialPage.nextCursor !== null,
      historyLoadingOlder: false,
      fullHistoryHydrated: initialPage.nextCursor === null,
      cwd: response.cwd ?? response.thread.cwd ?? cwd ?? null,
      activeTurnId: runningTurnId,
      turnIds: turns.map((turn) => turn.id),
      messages,
      busy: Boolean(runningTurnId),
      goal: goal ? { ...goal } : null,
      threadStatus: surfaceThreadStatus(response.thread.status),
      ...catalogs,
      ...sessionSelection(response, state.models, this.host.snapshotForRuntime(sourceRuntime)),
    });
    if (options.reasoningEffort) runtime.selectedReasoningEffort = options.reasoningEffort;
    if (options.serviceTier !== undefined) runtime.selectedServiceTier = options.serviceTier;
    if (options.model && requestedModel) runtime.selectedModelId = requestedModel.id;

    this.host.rememberHostOptions(response.thread.id, {
      ...hostOptions,
      ...(runtime.cwd ? { cwd: runtime.cwd } : {}),
      loadingStrategy: effectiveLoadingStrategy,
      mcpServers,
    });
    const summary = { ...threadToSummary(response.thread), turnCount: turns.length };
    this.host.patch({
      conversations: upsertConversation(this.host.getState().conversations, summary),
    });
    this.host.emitSummaryUpserted(summary);
    this.host.emitHistoryReplaced(response.thread.id);
    this.host.emitConversationActivity(response.thread.id);
    this.host.emitConversationSettings(response.thread.id);
    this.host.emitConversationSkills(response.thread.id);
    this.host.emitConversationPermissions(response.thread.id);
    if (effectiveLoadingStrategy === 'eager' && initialPage.nextCursor !== null) {
      void this.host.hydrateCompleteHistory(response.thread.id, initialPage.nextCursor).catch(() => undefined);
    }
    return response.thread.id;
  }

  async forkMessage(
    sourceThreadId: string,
    index: number,
    options: ForkCodexConversationOptions = {},
    hostOptions: CodexConversationLoadOptions = {},
  ): Promise<string> {
    const runtime = this.host.requireRuntime(sourceThreadId);
    const message = messageAt(runtime.messages, index);
    if (message.role === 'assistant') {
      return this.fork(sourceThreadId, options, hostOptions, {
        lastTurnId: messageTurnId(message),
      });
    }
    if (message.role !== 'user') throw new Error('Only user and assistant messages can be forked');

    const currentTurnId = messageTurnId(message);
    const previousAssistant = [...runtime.messages.slice(0, index)].reverse().find((candidate) => (
      candidate.role === 'assistant' && messageTurnIdOrNull(candidate) !== null
    ));
    const boundary: CodexForkBoundary = previousAssistant
      ? { lastTurnId: messageTurnId(previousAssistant) }
      : { beforeTurnId: currentTurnId };
    const attachments = surfaceMessageAttachments(message);
    const prompt = surfaceMessageText(message).trim()
      || (attachments.length > 0 ? '(no user instructions)' : '');
    if (!prompt) throw new Error('Cannot fork an empty user message');
    const conversationId = await this.fork(sourceThreadId, options, hostOptions, boundary);
    await this.host.sendMessageToThread(
      conversationId,
      prompt,
      attachments.length > 0 ? { attachments } : {},
    );
    return conversationId;
  }
}

function forkApprovalSettings(
  options: ForkCodexConversationOptions,
  approvalPresets: readonly string[],
): Pick<v2.ThreadForkParams, 'approvalPolicy' | 'approvalsReviewer' | 'permissions' | 'sandbox'> {
  if (options.approvalPreset) {
    if (!approvalPresets.includes(options.approvalPreset)) {
      throw new Error(`Approval preset '${options.approvalPreset}' is not available`);
    }
    return approvalPresetStartParams(options.approvalPreset);
  }
  return {
    ...(options.approvalMode === undefined
      ? {}
      : { approvalPolicy: options.approvalMode === 'ask' ? 'on-request' as const : 'never' as const }),
    ...(options.permissionMode === undefined
      ? {}
      : { sandbox: options.permissionMode === 'full-access' ? 'danger-full-access' as const : options.permissionMode }),
  };
}
