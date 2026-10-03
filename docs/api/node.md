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

Closing the default stdio transport ends stdin first so app-server can stop its
threads and flush history. It allows 12 seconds by default (`shutdownTimeoutMs`
overrides this), then escalates to SIGTERM and SIGKILL with at most one second
for each signal. Hosts should await close and allow at least 15 seconds in
their outer shutdown lifecycle. Forced termination cannot guarantee a history
flush.

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
- `getVersionedSnapshot()` and `onStatePatch(listener)`: an incremental state
  stream. Start from the versioned snapshot, then apply each patch in version
  order with `applyCodexSurfaceStateChanges` (or let
  `subscribeCodexSurfaceState` do it). A patch carries only changed top-level
  values and changed list items, so its size tracks the change rather than
  conversation length. The Electron and web transports use it automatically.

During `connect()`, the surface discovers app-server experimental features and
enables supported runtime capabilities when the running version advertises
them as disabled. These currently include `compaction_image_budget` for
image-aware manual and automatic compaction and
`default_mode_request_user_input` so agents can ask non-blocking questions
outside plan mode. App-server versions without feature discovery remain
supported.

`CodexAppServerStdioTransport` enables `default_mode_request_user_input` at
process launch because app-server establishes that tool gate before the SDK can
negotiate features over JSON-RPC. An externally managed Unix-socket app-server
must be launched with the feature enabled by its owner.

### Authentication

- `refreshAccount()`
- `startChatGptLogin()`
- `startChatGptDeviceCodeLogin()`
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

- `generateText(prompt, options?)` — runs one read-only ephemeral Codex turn and returns `{ text }` without persisting or projecting a conversation into surface state.
- `createConversation(options?, hostOptions?)`
- `forkConversation(sourceId, options?, hostOptions?)` — forks through the latest completed turn and returns `{ conversationId, conversation, snapshot }` without selecting it.
- `forkConversationAtTurn(sourceId, turnId, options?, hostOptions?)` — forks through one completed turn by stable ID.
- `selectConversation(id)`
- `forgetConversation(id)` — releases local runtime state without changing the app-server thread; the summary remains available and the conversation can be loaded again later.
- `archiveConversation(id)`
- `unarchiveConversation(id)`
- `deleteConversation(id)`
- `readConversationHistory(id?)`
- `readConversationPromptHistory(id?)` — reads user prompts from one summary-only page of the 100 most recent turns.
- `renameConversation(title)`
- `conversation(id)`

`generateText()` is intended for trusted, app-owned helpers such as drafting a
commit message or structured metadata. It starts an app-server thread with
`ephemeral: true`, `:read-only` permissions, no dynamic SDK tools or sticky
environments, and automatic unsubscription. The turn is never added to the
surface conversation catalog, selected, or emitted through surface events.

```ts
const result = await surface.generateText('Summarize these changes', {
  cwd: '/Users/me/project',
  developerInstructions: 'Return JSON only.',
  outputSchema: {
    type: 'object',
    properties: { summary: { type: 'string' } },
    required: ['summary'],
    additionalProperties: false,
  },
  signal: abortController.signal,
});
```

The result remains text even when `outputSchema` is supplied; the host owns
JSON parsing and product-specific validation. Closing the surface, aborting the
provided signal, or reaching `timeoutMs` interrupts the active turn and still
unsubscribes the ephemeral thread.

### Active conversation actions

- `updateConversationSettings(settings)`
- `sendMessage(prompt, options?)`
- `continueInterruptedTurn()`
- `compactConversation()`
- `startReview(options?)`
- `steerMessage(prompt, options?)`
- `interrupt()`
- `deleteTurn(turnId)`
- `editTurn(turnId, content)`
- `retryTurn(turnId)`
- `forkTurn(turnId)` — forks the active conversation through a completed turn and selects the new conversation.
- queued-prompt actions: `deleteQueuedPrompt(id)`,
  `updateQueuedPrompt(id, prompt)`, and `steerQueuedPrompt(id, prompt?)`
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
  forkTurn(
    turnId: string,
    options?: ForkCodexConversationOptions,
    hostOptions?: CodexConversationHostOptions,
  ): Promise<CodexConversationForkResult>;
  /** Loads 5 recent full-detail turns immediately; older pages follow the configured loading strategy. */
  load(options?: CodexConversationLoadOptions): Promise<CodexConversationSnapshot>;
  select(): Promise<CodexConversationSnapshot>;
  readHistory(): Promise<CodexConversationHistory>;
  readPromptHistory(): Promise<CodexConversationPromptHistory>;
  /** Loads the next older page and reports whether another page remains. */
  loadOlderHistory(): Promise<CodexConversationHistoryPage>;
  rename(title: string): Promise<CodexConversationSnapshot>;
  updateSettings(settings: UpdateCodexConversationSettings): Promise<CodexConversationSnapshot>;
  sendMessage(prompt: string, options?: SendCodexMessageOptions): Promise<CodexConversationSnapshot>;
  continueInterruptedTurn(): Promise<CodexConversationSnapshot>;
  compact(): Promise<CodexConversationSnapshot>;
  startReview(options?: StartCodexReviewOptions): Promise<CodexConversationSnapshot>;
  steerMessage(prompt: string, options?: SendCodexMessageOptions): Promise<CodexConversationSnapshot>;
  interrupt(): Promise<CodexConversationSnapshot>;
  deleteTurn(turnId: string): Promise<CodexConversationSnapshot>;
  editTurn(turnId: string, content: string): Promise<CodexConversationSnapshot>;
  retryTurn(turnId: string): Promise<CodexConversationSnapshot>;
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
fork requires an idle source; a turn fork may target a completed boundary
before an active turn. The new conversation is
fully usable immediately, but the surface's current selection remains unchanged
until the host calls `result.conversation.select()`.

`sendMessage` and `steerMessage` accept the same attachment options. Steering
maps attachments to app-server `UserInput` blocks and includes them in the
optimistic user steer message.

`continueInterruptedTurn()` is available only when the handle's latest turn is
`interrupted` and no turn is active. It sends `turn/start` with empty input,
creates no synthetic user message, and returns the snapshot containing the new
provider-authored turn. Because eligibility comes from loaded turn history, the
same operation works after the host reconnects or restarts.

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
  data: pcm16leBytes, // Uint8Array; the SDK encodes it for app-server
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

Realtime versions `v1`, `v2`, and `v3` are accepted. V3 canonical timeline
notifications are exposed as `realtime.itemStarted`,
`realtime.itemTranscriptDelta` (`itemId`, `delta`), and
`realtime.itemCompleted`. Item payloads retain the upstream JSON shape.

For browser hosts, `CodexSurface` also exposes a renderer-safe signaling pair
through both the Electron and web bridges:

```ts
const { sdp } = await surface.startLiveChat(conversationId, {
  sdp: browserOffer,
  // version defaults to 'v3'; output modality is always 'audio'.
  voice: 'marin',
});
await surface.stopLiveChat(conversationId);
```

`StartCodexLiveChatOptions` accepts the realtime settings above except
`transport` and `outputModality`, plus the required SDP offer. It always uses
WebRTC. The explicit conversation ID keeps signaling independent of the
currently selected thread. No credentials or raw audio cross this API.
The Vue [`useCodexLiveChat`](./vue#usecodexlivechat-options) composable handles
the browser media lifecycle. Only one live session should own a given thread
at a time; stop it before starting another owner.

## Runtime utilities

### Executable and transport

- `CodexAppServerStdioTransport`
- `CodexAppServerUnixSocketTransport`
- `discoverCodexExecutable`
- `codexRuntimePathEntries`
- `withCodexRuntimePath`
- `resolveCodexRuntime({ command?, env?, discovery? })`

The stdio transport resolves the Codex command and `PATH` with
`resolveCodexRuntime()`, which probes the user's login shell asynchronously,
gives up after `shellTimeoutMs` (default 5 seconds), and caches the result for
the process, so starting or reconnecting does not block the event loop. The
synchronous helpers keep their behavior but now also bound each shell probe by
`shellTimeoutMs`.

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
