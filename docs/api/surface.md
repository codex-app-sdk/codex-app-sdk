# Surface contracts

`@codex-app-sdk/core/surface` contains framework-neutral serializable contracts
shared by the Node backend, Electron IPC, web transport, and renderers.

## `CodexSurfaceSnapshot`

```ts
type CodexSurfaceSnapshot = {
  status: 'idle' | 'connecting' | 'ready' | 'error';
  authentication: CodexSurfaceAuthentication;
  conversations: CodexConversationSummary[];
  activeConversationId: string | null;
  activeTurnId: string | null;
  turns: CodexSurfaceTurn[];
  messages: SurfaceMessage[];
  clientRequests: CodexSurfaceClientRequest[];
  answeredClientRequestIds: string[];
  approvals: CodexSurfaceApproval[];
  models: CodexSurfaceModel[];
  modelCatalogStatus: CodexSurfaceCatalogStatus;
  skills: CodexSurfaceSkill[];
  skillCatalogStatus: CodexSurfaceCatalogStatus;
  plugins: CodexSurfacePlugin[];
  pluginCatalogStatus: CodexSurfaceCatalogStatus;
  permissionProfiles: CodexSurfacePermissionProfile[];
  approvalPresets: CodexSurfaceApprovalPreset[];
  approvalPreset: CodexSurfaceApprovalPreset | null;
  selectedModelId: string | null;
  selectedReasoningEffort: string | null;
  selectedServiceTier?: string | null;
  planMode: boolean;
  contextUsage: CodexSurfaceContextUsage | null;
  goal: CodexSurfaceGoal | null;
  turnGitDiff: CodexSurfaceTurnGitDiff | null;
  threadStatus: CodexSurfaceThreadStatus | null;
  rateLimits: CodexSurfaceRateLimits | null;
  queuedPrompts: CodexSurfaceQueuedPrompt[];
  busy: boolean;
  historyLoading: boolean;
  historyState?: CodexConversationHistoryState;
  error: string | null;
};
```

`turns` is the authoritative lifecycle projection for every materialized turn.
Each entry carries its stable ID, `inProgress` or terminal status, structured
error, retry intent, timestamps, and duration. `activeTurnId` identifies the
single currently running turn without requiring renderers to infer lifecycle
from message streaming flags.

`CodexConversationSnapshot` narrows the conversation ID to non-null and adds
`turnIds`, the chronological IDs of all turns known to that conversation
runtime. The `turns` array follows that same chronological order.

Conversation summaries include optional `sessionId`, `parentConversationId`,
`agentNickname`, and `agentRole` fields for hosts that present app-server
sub-agent trees. Root conversations omit the parent and agent-specific fields.

Models may advertise service tiers through `serviceTiers` and
`defaultServiceTier`. The selected tier is exposed as `selectedServiceTier`;
`serviceTier: null` clears it. The app-server's reserved `default` tier remains
valid even when it is not repeated in `serviceTiers`. The standard Vue selector
presents the `priority`/`fast` tier as a Fast mode toggle.

```ts
type CodexSurfaceServiceTier = {
  id: string;
  name: string;
  description: string;
};
```

## Skills

`CodexSurfaceSkill.defaultPrompt` is exposed only when the app-server provides
an actual string. Provider values with any other runtime type are omitted;
valid strings are preserved exactly.

## Messages

```ts
type SurfaceMessage = {
  id: string;
  kind?: 'compaction' | 'steer';
  role: 'user' | 'assistant' | 'system';
  status: 'complete' | 'streaming' | 'error';
  parts: readonly SurfaceMessagePart[];
  createdAt?: string;
  turnId?: string;
  metadata?: Record<string, unknown>;
};
```

`SurfaceMessagePart` is a discriminated union of:

- text, with an optional `commentary` or `final_answer` phase;
- completed reasoning summaries;
- attachments;
- generated and attached media;
- streaming/status information;
- tool calls and tool groups.

This is the stable renderer model for both restored and live conversations.
When a message is terminal (`complete` or `error`), SDK adapters settle any
stale `running` tool parts rather than exposing a nested streaming state.

Tool `input`, `output`, and derived body projections are best-effort display
data. Each projection is limited to 32 KiB before it enters a surface snapshot
or event; oversized or cyclic provider payloads are omitted while tool identity,
title, and status remain available. This limit does not remove attachment or
media parts, so generated images continue to render through their dedicated
media representation.

```ts
type SurfaceMessageTextPart = {
  type: 'text';
  text: string;
  itemId?: string;
  phase?: 'commentary' | 'final_answer';
};

type SurfaceMessageReasoningPart = {
  type: 'reasoning';
  summary: string;
  itemId: string;
  summaryIndex: number;
};
```

Reasoning parts contain only completed app-server summaries. Raw reasoning
content and reasoning deltas are not exposed through the surface contract.

## History state

```ts
type CodexConversationHistoryState = {
  loadingStrategy: 'eager' | 'lazy';
  hasOlder: boolean;
  loadingOlder: boolean;
  fullyLoaded: boolean;
};
```

`CodexConversationHistoryPage` contains `conversationId`, newly materialized
`messages`, and `hasOlder`. Loading state and Vue rendering strategy are
independent; see [History and performance](/guide/history).

## Input contracts

### `CreateCodexConversationOptions`

Trusted Node creation options include model, reasoning, service tier, raw permission/approval
modes, preset, cwd, base/developer instructions, config, and `threadSource`.
`threadSource` is passed unchanged to app-server's `thread/start` request, for
example `{ threadSource: 'user' }`.

### `CreateCodexRendererConversationOptions`

Renderer-safe subset: model, reasoning effort, service tier, and advertised approval preset.

### `SendCodexMessageOptions`

```ts
type SendCodexMessageOptions = {
  attachments?: readonly CodexSurfaceAttachment[];
  inputMethod?: 'typed' | 'dictated';
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string | null;
  planMode?: boolean;
  skills?: readonly CodexSurfaceSkillInput[];
  outputSchema?: CodexSurfaceJsonValue;
};
```

This trusted-host form carries resolved filesystem `path` values. Renderer
boundaries instead use opaque references:

```ts
type CodexRendererAttachment =
  | { type: 'image'; reference: string; detail?: 'auto' | 'low' | 'high' | 'original' }
  | { type: 'file'; reference: string };

type CodexRendererSendMessageOptions =
  Omit<SendCodexMessageOptions, 'attachments'> & {
    attachments?: readonly CodexRendererAttachment[];
  };
```

Electron resolves references through its integration-scoped attachment
registry. A web lease may provide `resolveAttachment`; the website owns upload
authorization and reference lifetime.

The stock Vue composer sets `inputMethod: 'dictated'` when voice transcription
contributed to the submitted prompt. Hosts can use this renderer-safe metadata
for product policy such as spoken-response gating; it is not sent to Codex as
user-visible prompt text.

## `CodexSurfaceApi`

Framework-neutral async interface exposed through Electron IPC or the web
client. It includes lifecycle, authentication, catalog, conversation, message,
review, goal, approval, client-request, and event operations.

`CodexSurfaceRendererApi` narrows trusted conversation-creation input and uses
`CodexRendererSendMessageOptions` for send/steer attachments.

## Conversation-targeted bridge

Multi-agent hosts must not route conversation work through global operations
such as `sendMessage()`, `interrupt()`, or `deleteTurn()`, because those methods
follow `activeConversationId`. The core bridge exports a selection-independent
interface over the Node surface's existing conversation handles:

```ts
import {
  invokeCodexConversationBridgeOperation,
  subscribeCodexConversationBridge,
  subscribeCodexConversationReplicaBridge,
} from '@codex-app-sdk/core/surface-bridge';
import { createCodexConversationReplica } from '@codex-app-sdk/core/conversation-replica';

const snapshot = await invokeCodexConversationBridgeOperation(
  surface,
  conversationId,
  'sendMessage',
  ['Run the checks'],
);

const unsubscribe = subscribeCodexConversationBridge(
  surface,
  conversationId,
  (notification) => {
    if (notification.type === 'snapshot') project(notification.snapshot);
    else applyEvent(notification.event);
  },
);
```

`subscribeCodexConversationBridge()` emits tagged `snapshot` and `event`
notifications only for future changes to that conversation. Read history or
invoke `getSnapshot` separately when an initial projection is needed. The
returned function removes both subscriptions.

For a process or network boundary, do not forward those full state-change
snapshots on every streaming delta. Bootstrap one renderer-local replica and
then carry only semantic events:

```ts
let replica: ReturnType<typeof createCodexConversationReplica> | undefined;

const unsubscribe = subscribeCodexConversationReplicaBridge(
  surface,
  conversationId,
  (notification) => {
    if (notification.type === 'snapshot') {
      replica = createCodexConversationReplica(notification.snapshot);
      render(replica.getSnapshot());
      return;
    }
    render(replica!.apply(notification.event));
  },
);
```

`subscribeCodexConversationReplicaBridge()` emits exactly one initial targeted
snapshot, then only `CodexConversationEvent` deltas. It buffers events raised
during bootstrap so the snapshot always arrives first. The replica applies
streaming, message, tool, turn, settings, queue, approval, and client-request
events with structural sharing. Rare history replacement/prepend events carry
the canonical message batch plus the small turn and paging state needed for
edit, retry, delete, resume, and lazy-history correctness.

`codexConversationBridgeOperations` and
`isCodexConversationBridgeOperation()` expose the supported transport-safe
operation vocabulary. It includes conversation-local history, settings,
message, turn, queue, goal, approval, and client-request operations. It does
not include global lifecycle, authentication, catalogs, archive/delete, or
selection. `forkTurn` returns the new conversation's serializable snapshot and
does not change global selection.

The existing `invokeCodexSurfaceBridgeOperation()` contract is unchanged for
single-active-conversation consumers.

Remote-control pairing and device management intentionally remain Node-only
`CodexSurface` methods because their app-server results contain trusted policy
and `bigint` timestamps. See [Remote control](/guide/remote-control).

## Review targets

```ts
type CodexSurfaceReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title?: string | null }
  | { type: 'custom'; instructions: string };
```

`StartCodexReviewOptions` accepts an optional `target`; omitted targets default
to uncommitted changes.

## Other contract families

- authentication/login/account state;
- conversation summaries and history;
- models, reasoning efforts, skills, plugins, permission profiles;
- command/file/permission approvals;
- MCP confirmations and app-server questions;
- goals and plan steps;
- context usage and rate-limit windows;
- turn status/error and git diff;
- semantic event unions.
