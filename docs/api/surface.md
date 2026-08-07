# Surface contracts

`@codex-app-sdk/core/surface` contains framework-neutral serializable contracts shared
by Node, Electron IPC, and renderers.

## `CodexSurfaceSnapshot`

```ts
type CodexSurfaceSnapshot = {
  status: 'idle' | 'connecting' | 'ready' | 'error';
  authentication: CodexSurfaceAuthentication;
  conversations: CodexConversationSummary[];
  activeConversationId: string | null;
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

`CodexConversationSnapshot` adds a non-null conversation ID, `activeTurnId`, and
all known turn IDs.

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

- text/user text;
- attachments;
- generated and attached media;
- streaming/status information;
- tool calls and tool groups.

This is the stable renderer model for both restored and live conversations.

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
modes, preset, cwd, base/developer instructions, and config.

### `CreateCodexRendererConversationOptions`

Renderer-safe subset: model, reasoning effort, service tier, and advertised approval preset.

### `SendCodexMessageOptions`

```ts
type SendCodexMessageOptions = {
  attachments?: readonly CodexSurfaceAttachment[];
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string | null;
  planMode?: boolean;
  skills?: readonly CodexSurfaceSkillInput[];
  outputSchema?: CodexSurfaceJsonValue;
};
```

## `CodexSurfaceApi`

Framework-neutral async interface exposed through Electron IPC. It includes
lifecycle, authentication, catalog, conversation, message, review, goal,
approval, client-request, and event operations.

`CodexSurfaceRendererApi` narrows only the trusted conversation-creation input.

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
