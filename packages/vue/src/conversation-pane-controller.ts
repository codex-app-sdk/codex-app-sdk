import type {
  CodexConversationLink,
  CodexContextUsage,
  CodexFileSearchItem,
  CodexModelOption,
  CodexSkillSummary,
  ApprovalPreset,
  CodexCapabilities,
  CodexCommandSummary,
  ClientRequestResponse,
  ReasoningEffort,
  ThreadGoal,
  TurnGitDiff,
} from './chat/contracts';
import type { CodexComposerMenuItem, CodexComposerMenuSelectableItem } from './composer-menu';
import type { Message } from './chat/types';
import type { CodexMessageImageOpenHandler } from './chat/message-image';
import type { CodexConversationVisualization } from './chat/visualization';
import type { CodexComposerState } from './composer-state';
import type { QueuedChatPrompt } from './chat/queued-prompts';
import type { CodexComposerMentionGroup, CodexComposerMentionItem } from './chat/composer-mentions-custom';
import type { CodexHostAttachment } from '@codex-app-sdk/core/native';
import type {
  CodexSurfaceApproval,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfacePlugin,
  CodexSurfaceTurn,
  CodexRendererSendMessageOptions,
  SurfaceMessage,
  UpdateCodexConversationSettings,
} from '@codex-app-sdk/core/surface';

export type CodexConversationPaneIdentityState = {
  conversationKey?: string | number | null;
  activeTurnId?: string | null;
  turns?: readonly CodexSurfaceTurn[];
  messages: readonly (Message | SurfaceMessage)[];
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
};

export type CodexConversationPaneHistoryState = {
  hasOlder?: boolean;
  loading?: boolean;
  loadingOlder?: boolean;
};

export type CodexConversationPaneThreadState = {
  approvals?: readonly CodexSurfaceApproval[];
  answeredClientRequestIds?: ReadonlySet<string>;
  goal?: ThreadGoal | null;
  queuedPrompts?: readonly QueuedChatPrompt[];
  turnGitDiff?: TurnGitDiff | null;
  contextUsage?: CodexContextUsage | null;
};

export type CodexConversationPaneComposerState = {
  state?: CodexComposerState;
  attachments?: readonly CodexHostAttachment[];
  /** Chronological user prompts available to Up/Down recall. */
  promptHistory?: readonly string[];
  placeholder?: string;
  /** Host actions rendered after Approval and before Plan mode. */
  leadingMenuItems?: readonly CodexComposerMenuItem[];
  menuItems?: readonly CodexComposerMenuItem[];
  approvalPreset?: ApprovalPreset | null;
  planMode?: boolean;
  selectedModelId?: string | null;
  selectedReasoningEffort?: ReasoningEffort | null;
  selectedServiceTier?: string | null;
};

export type CodexConversationPaneCatalogState = {
  files?: readonly CodexFileSearchItem[];
  models?: readonly CodexModelOption[];
  commands?: readonly CodexCommandSummary[];
  skills?: readonly CodexSkillSummary[];
  plugins?: readonly CodexSurfacePlugin[];
  mentionGroups?: readonly CodexComposerMentionGroup[];
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  skillCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
};

export type CodexConversationPanePolicy = {
  actionsDisabled?: boolean;
  attachEnabled?: boolean;
  canDeleteTurn?: boolean;
  canEditTurn?: boolean;
  canForkTurn?: boolean;
  canRetryTurn?: boolean;
  followUpsDisabled?: boolean;
};

export type CodexConversationPaneState = {
  identity: CodexConversationPaneIdentityState;
  history?: CodexConversationPaneHistoryState;
  thread?: CodexConversationPaneThreadState;
  composer?: CodexConversationPaneComposerState;
  catalogs?: CodexConversationPaneCatalogState;
  capabilities?: CodexCapabilities;
  policy?: CodexConversationPanePolicy;
};

/**
 * A Vue-version-independent reactive value source. Ref-like values are
 * intentionally structural so applications with a separately-resolved Vue
 * package can pass `computed`/`ref` values without nominal type conflicts.
 */
export type CodexConversationPaneValueSource<T> =
  | T
  | { readonly value: T }
  | (() => T);

export function resolveCodexConversationPaneValue<T>(
  source: CodexConversationPaneValueSource<T>,
): T {
  if (typeof source === 'function') return (source as () => T)();
  if (source !== null && typeof source === 'object' && 'value' in source) {
    return (source as { readonly value: T }).value;
  }
  return source as T;
}

type PaneAction<Args extends unknown[] = []> = (...args: Args) => void | Promise<void>;

export type CodexConversationPaneActions<Payload = unknown> = {
  attach?: PaneAction;
  cancel?: PaneAction;
  clientResponse?: PaneAction<[response: ClientRequestResponse]>;
  clearGoal?: PaneAction;
  /** Called after the SDK has copied a message to the clipboard. */
  onMessageCopied?: PaneAction<[index: number]>;
  deleteTurn?: PaneAction<[turnId: string]>;
  deleteQueuedPrompt?: PaneAction<[promptId: string]>;
  updateQueuedPrompt?: PaneAction<[promptId: string, prompt: string]>;
  editGoal?: PaneAction;
  editTurn?: PaneAction<[payload: { content: string; turnId: string }]>;
  forkTurn?: PaneAction<[turnId: string]>;
  interrupt?: PaneAction;
  loadOlderHistory?: PaneAction;
  menuSelect?: PaneAction<[item: CodexComposerMenuSelectableItem<Payload>]>;
  mentionSelect?: PaneAction<[item: CodexComposerMentionItem<Payload>, group: CodexComposerMentionGroup<Payload>]>;
  openImage?: CodexMessageImageOpenHandler;
  openLink?: PaneAction<[link: CodexConversationLink]>;
  openVisualization?: PaneAction<[visualization: CodexConversationVisualization]>;
  quoteMessage?: PaneAction<[index: number]>;
  /** Loads bounded user-only prompt history for the active conversation. */
  readPromptHistory?: () => readonly string[] | Promise<readonly string[]>;
  resolveApproval?: PaneAction<[
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope: CodexSurfaceApprovalScope,
  ]>;
  retryTurn?: PaneAction<[turnId: string]>;
  selectApprovalPreset?: PaneAction<[preset: ApprovalPreset]>;
  sendFollowUp?: PaneAction<[prompt: string]>;
  steer?: PaneAction<[prompt: string, options?: CodexRendererSendMessageOptions]>;
  steerQueuedPrompt?: PaneAction<[promptId: string, prompt?: string]>;
  submit?: PaneAction<[prompt: string, options?: CodexRendererSendMessageOptions]>;
  updateAttachments?: PaneAction<[attachments: readonly CodexHostAttachment[]]>;
  updateComposerState?: PaneAction<[state: CodexComposerState]>;
  updateSettings?: PaneAction<[settings: UpdateCodexConversationSettings]>;
};

export type CodexConversationPaneController<Payload = unknown> = {
  state: CodexConversationPaneValueSource<CodexConversationPaneState>;
  actions: CodexConversationPaneValueSource<CodexConversationPaneActions<Payload>>;
};

export type CodexConversationPaneControllerSource<Payload = unknown> = CodexConversationPaneValueSource<
  CodexConversationPaneController<Payload>
>;

export type CodexConversationPaneControllerOptions<Payload = unknown> = {
  state: CodexConversationPaneValueSource<CodexConversationPaneState>;
  actions: CodexConversationPaneValueSource<CodexConversationPaneActions<Payload>>;
};

/**
 * Creates a stable controlled-view adapter for CodexConversationPane.
 *
 * The adapter only normalizes reactive state and actions. It does not load a
 * conversation, clone messages, or own a backend. Keep the returned object
 * stable and update the supplied state leaves in place when possible.
 */
export function createCodexConversationPaneController<Payload = unknown>(
  options: CodexConversationPaneControllerOptions<Payload>,
): CodexConversationPaneController<Payload> {
  return {
    // Preserve the host source instead of wrapping it in this Vue runtime's
    // computed(). A ref/computed from another Vue package must retain its own
    // dependency graph; the pane resolves the source at render time.
    state: options.state,
    actions: options.actions,
  };
}
