# Node runtime API

```ts
import {
  CodexAppBackend,
  CodexAppBackendTtlCache,
  CodexSurface,
  createCodexAppBackend,
  createCodexSurface,
} from '@codex-app-sdk/backend';
```

## `createCodexSurface(options?)`

Creates a high-level surface and its default app-server client/stdio transport.

### `CodexSurfaceOptions`

```ts
type CodexSurfaceOptions = {
  approvalPreset?: CodexSurfaceApprovalPreset;
  approvalMode?: 'ask' | 'never';
  clientInfo?: { name: string; title?: string; version: string };
  conversationDefaults?: {
    model?: string;
    reasoningEffort?: string;
    serviceTier?: string | null;
  };
  conversationLimit?: number;
  /** `lazy` keeps older pages behind loadOlderHistory; `eager` hydrates all pages progressively. */
  loadingStrategy?: 'eager' | 'lazy';
  codexHome?: string;
  cwd?: string;
  autoSelectFirstConversation?: boolean;
  extensions?: readonly CodexSurfaceExtension[];
  mcpServers?: readonly CodexMcpServerDefinition[];
  onUnknownNotification?: (notification: { method: string; params?: unknown }) => void;
  permissionMode?: 'read-only' | 'workspace-write' | 'full-access';
  transport?: CodexAppServerTransportOptions;
  client?: CodexAppServerClient;
};
```

`client` is a test/advanced embedding seam. Most applications should let the SDK
construct the client.

### Reuse an existing app-server

To send turns through a desktop-owned, Unix-socket app-server instead of
spawning another child, opt in explicitly:

```ts
const surface = createCodexSurface({
  transport: {
    type: 'unixSocket',
    socketPath: '/Users/me/.codex/app-server-control/app-server-control.sock',
  },
});
```

When `socketPath` is omitted, the SDK derives it from `codexHome` (or
`CODEX_HOME`, then `~/.codex`). This transport never starts, stops, or restarts
the server it connects to.

## `createCodexAppBackend(options?)`

Creates an optional in-process application composition root around one shared
`CodexSurface`. It is intended for trusted Node or Electron main code that
needs to compose product services with the Codex runtime.

```ts
type CodexAppBackendModuleContext = {
  surface: CodexSurface;
  closeBackend(): Promise<void>;
  createTtlCache<Value>(
    options: CodexAppBackendTtlCacheOptions<Value>,
  ): CodexAppBackendTtlCache<Value>;
};

type CodexAppBackendModule<Service = unknown> = {
  id: string;
  create(context: CodexAppBackendModuleContext): Service;
};

type CodexAppBackendOptions = {
  modules?: readonly CodexAppBackendModule[];
  surface?: CodexSurface;
  surfaceOptions?: CodexSurfaceOptions;
};
```

Pass either an existing `surface` or `surfaceOptions`, not both. Module IDs
must be unique and non-empty after trimming.

```ts
const backend = createCodexAppBackend({
  surfaceOptions: { permissionMode: 'read-only' },
  modules: [{
    id: 'agents',
    create({ surface }) {
      return createAgentService(surface);
    },
  }],
});

await backend.surface.connect();
const agents = backend.module<AgentService>('agents');
await backend.close();
```

`CodexAppBackend` exposes `surface`, `module<Service>(id)`,
`createTtlCache(options)`, and an idempotent `close()`. It does not own product
services or add a process/transport layer;
the embedding host still decides where the backend runs and how the surface is
bridged to a renderer. See [Add a backend service](/guide/backend) for
composition and lifecycle guidance.

### `CodexAppBackendTtlCache<Value>`

Create an optional cache from `backend.createTtlCache(options)` or from a
module's `createTtlCache` context helper:

```ts
type CodexAppBackendTtlCacheEvictionContext = {
  readonly id: string;
  readonly lastActivityAt: number;
  readonly now: number;
  readonly idleForMs: number;
};

type CodexAppBackendTtlCacheOptions<Value> = {
  ttlMs: number;
  sweepIntervalMs?: number | null;
  identity: (value: Value) => string;
  canEvict: (
    value: Value,
    context: CodexAppBackendTtlCacheEvictionContext,
  ) => boolean | Promise<boolean>;
  onEvict: (
    value: Value,
    context: CodexAppBackendTtlCacheEvictionContext,
  ) => void | Promise<void>;
  now?: () => number;
  scheduler?: CodexAppBackendTtlCacheScheduler;
  onEvictionError?: (
    error: unknown,
    value: Value,
    context: CodexAppBackendTtlCacheEvictionContext,
  ) => void | Promise<void>;
};

type CodexAppBackendTtlTimer = {
  unref?: () => void;
};

type CodexAppBackendTtlCacheScheduler = {
  set(callback: () => void, delayMs: number): CodexAppBackendTtlTimer;
  clear(timer: CodexAppBackendTtlTimer): void;
};
```

The cache exposes:

- `set(value, activityAt?)` to add or replace a value;
- `get(id)` and `getRecord(id)` to read the value and activity timestamp;
- `touch(id, activityAt?)` to record selection or generation activity;
- `delete(id)` and `size` for explicit host cleanup;
- `sweep()` to run an eviction pass manually;
- `close()` to stop its optional timer and await an in-flight pass.

Activity timestamps are monotonic per identity: a later `set()` or `touch()`
cannot be replaced by an older event timestamp. A periodic scheduler is never
created unless `sweepIntervalMs` is supplied. The default timer and injected
schedulers are unref'd when supported and are always cleared during close.

## `CodexSurface`

### Lifecycle and state

- `connect()`
- `getSnapshot()`
- `onStateChange(listener)`
- `onEvent(listener)`
- `close()`

### Authentication

- `refreshAccount()`
- `startChatGptLogin()`
- `cancelLogin(loginId?)`
- `logout()`

### Remote control

- `readConfigRequirements()`
- `readRemoteControlStatus()`
- `enableRemoteControl(options?)`
- `disableRemoteControl(options?)`
- `startRemoteControlPairing(options?)`
- `readRemoteControlPairingStatus(options?)`
- `listRemoteControlClients(options)`
- `revokeRemoteControlClient(options)`

These state-neutral methods expose app-server's official remote-control RPCs in
trusted Node code. Pairing returns an opaque `pairingCode`, optional manual code,
environment ID, and `bigint` expiry timestamp. The official QR payload is
`https://chatgpt.com/codex/pair?pairing_code=<encoded code>`; use the raw code for
status polling. See [Remote control and device pairing](/guide/remote-control).

### Catalogs

- `refreshConversations()`
- `listConversations(options?)`
- `readConversationSummary(conversationId)`
- `listModels(options?)`
- `listSkills(options?)`

`readConversationSummary()` performs `thread/read` with `includeTurns: false`
and returns metadata for one known conversation. It does not load turns, create
a conversation runtime, change the conversation catalog, or emit surface
events.

### Conversation lifecycle

- `createConversation(options?, hostOptions?)`
- `forkConversation(sourceId, options?, hostOptions?)` — forks through the latest completed turn and returns `{ conversationId, conversation, snapshot }` without selecting it.
- `forkConversationAtMessage(sourceId, index, options?, hostOptions?)` — forks through an assistant message, or through the preceding assistant and resubmits a user message.
- `selectConversation(id)`
- `forgetConversation(id)` — releases local runtime state without changing the app-server thread; the summary remains available and the conversation can be loaded again later.
- `archiveConversation(id)`
- `unarchiveConversation(id)`
- `deleteConversation(id)`
- `readConversationHistory(id?)`
- `renameConversation(title)`
- `conversation(id)`

### Active conversation actions

- `updateConversationSettings(settings)`
- `sendMessage(prompt, options?)`
- `compactConversation()`
- `startReview(options?)`
- `steerMessage(prompt, options?)`
- `interrupt()`
- `deleteMessage(index)`
- `editMessage(index, content)`
- `retryMessage(index)`
- `forkMessage(index)` — forks the active conversation at a message and selects the new conversation.
- queued-prompt actions
- approval and app-server client-request responses
- `setGoal(objective, tokenBudget?)` / `clearGoal()`

## `CodexConversation`

Stable Node handle for one conversation:

```ts
type CodexConversation = {
  readonly id: string;
  fork(
    options?: ForkCodexConversationOptions,
    hostOptions?: CodexConversationHostOptions,
  ): Promise<CodexConversationForkResult>;
  forkMessage(
    index: number,
    options?: ForkCodexConversationOptions,
    hostOptions?: CodexConversationHostOptions,
  ): Promise<CodexConversationForkResult>;
  /** Loads 5 recent full-detail turns immediately; older pages follow the configured loading strategy. */
  load(options?: CodexConversationLoadOptions): Promise<CodexConversationSnapshot>;
  select(): Promise<CodexConversationSnapshot>;
  readHistory(): Promise<CodexConversationHistory>;
  /** Loads the next older page and reports whether another page remains. */
  loadOlderHistory(): Promise<CodexConversationHistoryPage>;
  rename(title: string): Promise<CodexConversationSnapshot>;
  updateSettings(settings: UpdateCodexConversationSettings): Promise<CodexConversationSnapshot>;
  sendMessage(prompt: string, options?: SendCodexMessageOptions): Promise<CodexConversationSnapshot>;
  compact(): Promise<CodexConversationSnapshot>;
  startReview(options?: StartCodexReviewOptions): Promise<CodexConversationSnapshot>;
  steerMessage(prompt: string, options?: SendCodexMessageOptions): Promise<CodexConversationSnapshot>;
  interrupt(): Promise<CodexConversationSnapshot>;
  rollbackToTurn(turnId: string): Promise<CodexConversationSnapshot>;
  startRealtime(options: StartCodexRealtimeOptions): Promise<CodexRealtimeSession>;
  getSnapshot(): CodexConversationSnapshot;
  onStateChange(listener): () => void;
  onEvent(listener): () => void;
  // message, queue, approval, client request, and goal actions are also exposed
};
```

Fork types are protocol-free and exported from `@codex-app-sdk/backend`:

```ts
type ForkCodexConversationOptions = CreateCodexConversationOptions;

type CodexConversationForkResult = {
  readonly conversationId: string;
  readonly conversation: CodexConversation;
  readonly snapshot: CodexConversationSnapshot;
};
```

Omitted fork overrides inherit from the source app-server thread. A latest-state
fork requires an idle source; a message fork may target a completed boundary
before an active turn. Assistant messages fork through their turn. User
messages fork through the preceding assistant turn and are submitted as the
new fork's first prompt, including their attachments. The new conversation is
fully usable immediately, but the surface's current selection remains unchanged
until the host calls `result.conversation.select()`.

`sendMessage` and `steerMessage` accept the same attachment options. Steering
maps attachments to app-server `UserInput` blocks and includes them in the
optimistic user steer message.

Reviews accept:

```ts
type CodexSurfaceReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title?: string | null }
  | { type: 'custom'; instructions: string };
```

`sendMessage('/review')` and `/review <instructions>` route to `review/start`.
The returned app-server turn supplies the visible review prompt; it is not a
separate optimistic slash-command message.

`serviceTier` is accepted by conversation creation, settings updates, and
message options. Passing `null` to settings or message options clears Fast mode
for subsequent turns; omitted values preserve the current tier.

### Realtime voice

`startRealtime()` exposes app-server's experimental realtime session as a
high-level conversation handle:

```ts
const realtime = await conversation.startRealtime({
  version: 'v2',
  outputModality: 'audio',
  transport: { type: 'websocket' },
});

const unsubscribe = realtime.onEvent((event) => {
  if (event.type === 'realtime.transcriptCompleted') {
    console.log(event.payload.text);
  }
  if (event.type === 'realtime.audioDelta') {
    playPcm(event.payload.audio);
  }
});

await realtime.appendAudio({
  data: pcm16leBase64,
  sampleRate: 24_000,
  numChannels: 1,
});

await realtime.stop();
unsubscribe();
```

The audio contract is mono signed PCM16LE at 24 kHz. App-server owns the
realtime upstream connection, server-side VAD, transcription, and synthesized
audio. `appendText()` and `appendSpeech()` are also available.

The websocket transport accepts `appendAudio()` and requires API-key auth in
Codex. ChatGPT-authenticated browser/webview hosts should instead create an
`RTCPeerConnection`, add an audio track and the `oai-events` data channel, then
pass `{ type: 'webrtc', sdp: offer.sdp }` with a WebRTC-compatible protocol
version such as `v1`. The returned session's `remoteSdp` is the answer to apply
with `setRemoteDescription()`; audio then travels over the WebRTC media track.
Realtime is an experimental Codex protocol and may change between CLI
versions.

## Runtime utilities

### Executable and transport

- `CodexAppServerStdioTransport`
- `CodexAppServerUnixSocketTransport`
- `discoverCodexExecutable`
- `codexRuntimePathEntries`
- `withCodexRuntimePath`

### History adapters

- `codexThreadToSurfaceMessages`
- `codexTurnToSurfaceMessages`
- `codexItemToSurfaceMessage`
- `codexItemToToolPart`
- `codexItemToMediaPart`

### Apple speech

- `resolveAppleSpeechAnalyzerPath`
- `transcribeWithAppleSpeechAnalyzer`

See the [surface guide](/guide/surface), [conversations](/guide/conversations),
and [extensions](/guide/extensions).
