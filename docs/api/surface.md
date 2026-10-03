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
  executionPlan?: CodexSurfaceExecutionPlan | null;
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

`executionPlan` is the latest structured plan reported by Codex's execution
planning tool. It carries the owning `turnId`, optional explanation, ordered
step statuses, rendered Markdown, and update timestamp. Conversation replicas
update it from `plan.updated`; hosts can render plan progress without parsing a
generic tool part. The field is optional only for compatibility with snapshots
created by older SDK versions.

```ts
type CodexSurfaceExecutionPlan = {
  turnId: string;
  explanation: string | null;
  steps: readonly CodexSurfacePlanStep[];
  markdown: string;
  updatedAt: string;
};
```

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
- asynchronous agent questions;
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

type SurfaceMessageQuestionPart = {
  type: 'question';
  historical?: boolean;
  request: Extract<CodexSurfaceClientRequest, { kind: 'ask_user' }>;
};
```

Reasoning parts contain only completed app-server summaries. Raw reasoning
content and reasoning deltas are not exposed through the surface contract.

## Questions and client requests

The surface exposes one `ask_user` contract for both app-server question paths:

- `payload.request.delivery === 'tool'` is the blocking
  `item/tool/requestUserInput` server request. `blocking` mirrors the
  app-server's `isBlocking` flag.
- `payload.request.delivery === 'async'` is a non-blocking question attached to
  an asynchronous agent message. It is also present as a `question` message
  part so renderers keep it beside the text that asked it.

Answer either form with the existing `respondToClientRequest()` operation. For
an asynchronous question, the SDK starts a new turn or steers the active turn,
encodes the provider reply envelope internally, and exposes only the human
answer in message history. Consumers must not call raw app-server RPC or build
the provider envelope themselves.

`clientRequest.requested` and `clientRequest.resolved` cover both deliveries,
so an incremental conversation replica never needs a full snapshot to discover
or settle a question. Restored question parts have `historical: true`: they
are read-only transcript content, not pending requests. Durable answers remain
visible when present in loaded history. A prior session's unanswered or skipped
question does not reopen on restart; only a newly issued provider request is
actionable. Historical questions fold with the turn's work details.

An optional question does not keep execution busy after a turn ends. Consumers
mapping client requests to a blocking status must respect `request.blocking`.
On resume, an idle provider status takes precedence over an old `inProgress`
history entry, and notifications received during hydration take precedence over
the older resume response.

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

Browser-capable hosts use `startChatGptLogin()`. Headless hosts use
`startChatGptDeviceCodeLogin()`, which returns a serializable
`{ loginId, verificationUrl, userCode }` result while app-server and the SDK
retain ownership of credentials and authentication lifecycle.

`CodexSurfaceRendererApi` narrows trusted conversation-creation input and uses
`CodexRendererSendMessageOptions` for send/steer attachments.

Optional `getVersionedSnapshot()` and `onStatePatch()` members expose an
incremental state stream; `getVersionedSnapshot()` resolves null when the other
side cannot stream patches. Consume it with
`subscribeCodexSurfaceState(api, listener)` from
`@codex-app-sdk/core/surface-bridge`. It keeps a local mirror whose unchanged
messages and list items stay identical between notifications, and falls back to
`onStateChange` when patches are unavailable. `useCodexSurface` uses it.

`continueInterruptedTurn()` resumes the latest interrupted turn in the active
conversation. It starts a new provider turn with empty input, does not append a
user message, and leaves the interrupted turn immutable in `turns`. The new
provider turn ID becomes `activeTurnId`. The operation rejects while another
turn is active or when the latest turn is not `interrupted`; eligibility is
therefore derivable from a restored snapshot after an app restart.

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
