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
import type { CodexComposerState } from './composer-state';
import type { QueuedChatPrompt } from './chat/queued-prompts';
import type { CodexNativeAttachment } from '../native/types';
import type {
  CodexSurfaceApproval,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalScope,
  CodexSurfacePlugin,
  SendCodexMessageOptions,
  SurfaceMessage,
  UpdateCodexConversationSettings,
} from '../surface/types';

export type CodexConversationPaneIdentityState = {
  conversationKey?: string | number | null;
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
  attachments?: readonly CodexNativeAttachment[];
  placeholder?: string;
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
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  skillCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
};

export type CodexConversationPanePolicy = {
  actionsDisabled?: boolean;
  attachEnabled?: boolean;
  canDeleteMessage?: boolean;
  canEditMessage?: boolean;
  canRetryMessage?: boolean;
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
  deleteMessage?: PaneAction<[index: number]>;
  deleteQueuedPrompt?: PaneAction<[promptId: string]>;
  editGoal?: PaneAction;
  editMessage?: PaneAction<[payload: { content: string; index: number }]>;
  interrupt?: PaneAction;
  loadOlderHistory?: PaneAction;
  menuSelect?: PaneAction<[item: CodexComposerMenuSelectableItem<Payload>]>;
  openLink?: PaneAction<[link: CodexConversationLink]>;
  quoteMessage?: PaneAction<[index: number]>;
  resolveApproval?: PaneAction<[
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope: CodexSurfaceApprovalScope,
  ]>;
  retryMessage?: PaneAction<[index: number]>;
  selectApprovalPreset?: PaneAction<[preset: ApprovalPreset]>;
  sendFollowUp?: PaneAction<[prompt: string]>;
  steer?: PaneAction<[prompt: string, options?: SendCodexMessageOptions]>;
  steerQueuedPrompt?: PaneAction<[promptId: string]>;
  submit?: PaneAction<[prompt: string, options?: SendCodexMessageOptions]>;
  updateAttachments?: PaneAction<[attachments: readonly CodexNativeAttachment[]]>;
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
