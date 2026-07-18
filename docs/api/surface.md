# Surface contracts

`codex-app-sdk/surface` contains framework-neutral serializable contracts shared
by Node, Electron IPC, and renderers.

## `CodexSurfaceSnapshot`

```ts
type CodexSurfaceSnapshot = {
  status: 'idle' | 'connecting' | 'ready' | 'error' | 'closed';
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
  planMode: boolean;
  contextUsage: CodexSurfaceContextUsage | null;
  goal: CodexSurfaceGoal | null;
  turnGitDiff: CodexSurfaceTurnGitDiff | null;
  threadStatus: CodexSurfaceThreadStatus | null;
  rateLimits: CodexSurfaceRateLimits | null;
  queuedPrompts: CodexSurfaceQueuedPrompt[];
  busy: boolean;
  historyLoading: boolean;
  error: string | null;
};
```

`CodexConversationSnapshot` adds a non-null conversation ID, `activeTurnId`, and
all known turn IDs.

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

## Input contracts

### `CreateCodexConversationOptions`

Trusted Node creation options include model, reasoning, raw permission/approval
modes, preset, cwd, base/developer instructions, and config.

### `CreateCodexRendererConversationOptions`

Renderer-safe subset: model, reasoning effort, and advertised approval preset.

### `SendCodexMessageOptions`

```ts
type SendCodexMessageOptions = {
  attachments?: readonly CodexSurfaceAttachment[];
  model?: string;
  reasoningEffort?: string;
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
