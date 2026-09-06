import type {
  CodexSurfaceApproval,
  CodexSurfaceAuthentication,
  CodexSurfaceClientRequest,
  CodexSurfaceSnapshot,
  CodexConversationLoadingStrategy,
  CodexSurfaceSkill,
  CodexSurfaceThreadStatus,
  CodexSurfaceTurn,
  SurfaceMessage,
} from '@codex-app-sdk/core/surface';
import type { ThreadHistoryMode } from '../codex/generated/v2/ThreadHistoryMode';

export type ThreadRuntimeState = {
  threadId: string;
  cwd: string | null;
  hydrated: boolean;
  activeTurnId: string | null;
  turns: CodexSurfaceTurn[];
  turnIds: string[];
  messages: SurfaceMessage[];
  answeredClientRequestIds: string[];
  approvalPreset: CodexSurfaceSnapshot['approvalPreset'];
  approvalPresets: CodexSurfaceSnapshot['approvalPresets'];
  permissionProfiles: CodexSurfaceSnapshot['permissionProfiles'];
  skills: CodexSurfaceSkill[];
  skillCatalogStatus: CodexSurfaceSnapshot['skillCatalogStatus'];
  selectedModelId: string | null;
  selectedReasoningEffort: string | null;
  selectedServiceTier: string | null;
  planMode: boolean;
  contextUsage: CodexSurfaceSnapshot['contextUsage'];
  goal: CodexSurfaceSnapshot['goal'];
  turnGitDiff: CodexSurfaceSnapshot['turnGitDiff'];
  threadStatus: CodexSurfaceThreadStatus | null;
  queuedPrompts: CodexSurfaceSnapshot['queuedPrompts'];
  busy: boolean;
  turnStartPending: boolean;
  historyLoading: boolean;
  historyMode: ThreadHistoryMode;
  loadingStrategy: CodexConversationLoadingStrategy;
  historyCursor: string | null;
  historyHasOlder: boolean;
  historyLoadingOlder: boolean;
  fullHistoryHydrated: boolean;
  error: string | null;
  planMarkdownByTurn: Map<string, string>;
};

export type ThreadRuntimePatch = Partial<Omit<ThreadRuntimeState, 'threadId' | 'planMarkdownByTurn'>>;

export type ConversationCatalogs = Pick<
  ThreadRuntimeState,
  'approvalPresets' | 'permissionProfiles' | 'skillCatalogStatus' | 'skills'
>;

export function initialSurfaceSnapshot(authentication: CodexSurfaceAuthentication): CodexSurfaceSnapshot {
  return {
    status: 'idle',
    authentication,
    conversations: [],
    activeConversationId: null,
    activeTurnId: null,
    turns: [],
    messages: [],
    clientRequests: [],
    answeredClientRequestIds: [],
    approvals: [],
    models: [],
    modelCatalogStatus: 'notLoaded',
    skills: [],
    skillCatalogStatus: 'notLoaded',
    plugins: [],
    pluginCatalogStatus: 'notLoaded',
    permissionProfiles: [],
    approvalPresets: [],
    approvalPreset: null,
    selectedModelId: null,
    selectedReasoningEffort: null,
    selectedServiceTier: null,
    planMode: false,
    contextUsage: null,
    goal: null,
    turnGitDiff: null,
    threadStatus: null,
    rateLimits: null,
    queuedPrompts: [],
    busy: false,
    historyLoading: false,
    historyState: {
      loadingStrategy: 'lazy',
      hasOlder: false,
      loadingOlder: false,
      fullyLoaded: false,
    },
    error: null,
  };
}

export function createThreadRuntime(
  threadId: string,
  state: CodexSurfaceSnapshot,
  patch: ThreadRuntimePatch = {},
): ThreadRuntimeState {
  return {
    threadId,
    cwd: null,
    hydrated: false,
    activeTurnId: null,
    turns: [],
    turnIds: [],
    messages: [],
    answeredClientRequestIds: [],
    approvalPreset: state.approvalPreset,
    approvalPresets: [...state.approvalPresets],
    permissionProfiles: [...state.permissionProfiles],
    skills: [...state.skills],
    skillCatalogStatus: state.skillCatalogStatus,
    selectedModelId: state.selectedModelId,
    selectedReasoningEffort: state.selectedReasoningEffort,
    selectedServiceTier: state.selectedServiceTier ?? null,
    planMode: false,
    contextUsage: null,
    goal: null,
    turnGitDiff: null,
    threadStatus: null,
    queuedPrompts: [],
    busy: false,
    turnStartPending: false,
    historyLoading: false,
    historyMode: 'legacy',
    loadingStrategy: state.historyState?.loadingStrategy ?? 'lazy',
    historyCursor: null,
    historyHasOlder: false,
    historyLoadingOlder: false,
    fullHistoryHydrated: false,
    error: null,
    planMarkdownByTurn: new Map(),
    ...patch,
  };
}

export function runtimeProjection(
  runtime: ThreadRuntimeState,
  approvals: CodexSurfaceApproval[],
  clientRequests: CodexSurfaceClientRequest[],
): Pick<
  CodexSurfaceSnapshot,
  | 'approvalPreset'
  | 'approvalPresets'
  | 'answeredClientRequestIds'
  | 'approvals'
  | 'activeTurnId'
  | 'busy'
  | 'clientRequests'
  | 'contextUsage'
  | 'error'
  | 'goal'
  | 'historyLoading'
  | 'historyState'
  | 'messages'
  | 'permissionProfiles'
  | 'planMode'
  | 'queuedPrompts'
  | 'selectedModelId'
  | 'selectedReasoningEffort'
  | 'selectedServiceTier'
  | 'skillCatalogStatus'
  | 'skills'
  | 'threadStatus'
  | 'turnGitDiff'
  | 'turns'
> {
  return {
    activeTurnId: runtime.activeTurnId,
    approvalPreset: runtime.approvalPreset,
    approvalPresets: runtime.approvalPresets,
    answeredClientRequestIds: runtime.answeredClientRequestIds,
    approvals,
    busy: runtime.busy,
    clientRequests,
    contextUsage: runtime.contextUsage,
    error: runtime.error,
    goal: runtime.goal,
    historyLoading: runtime.historyLoading,
    historyState: {
      loadingStrategy: runtime.loadingStrategy,
      hasOlder: runtime.historyHasOlder,
      loadingOlder: runtime.historyLoadingOlder,
      fullyLoaded: runtime.fullHistoryHydrated,
    },
    messages: runtime.messages,
    permissionProfiles: runtime.permissionProfiles,
    planMode: runtime.planMode,
    queuedPrompts: runtime.queuedPrompts,
    selectedModelId: runtime.selectedModelId,
    selectedReasoningEffort: runtime.selectedReasoningEffort,
    selectedServiceTier: runtime.selectedServiceTier,
    skillCatalogStatus: runtime.skillCatalogStatus,
    skills: runtime.skills,
    threadStatus: runtime.threadStatus,
    turnGitDiff: runtime.turnGitDiff,
    turns: runtime.turns,
  };
}
