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
  /** Completed turns initially include all items (default) or prompt/final summaries. */
  historyItemsView?: 'full' | 'summary';
  codexHome?: string;
  cwd?: string;
  autoSelectFirstConversation?: boolean;
  extensions?: readonly CodexSurfaceExtension[];
  mcpServers?: readonly CodexMcpServerDefinition[];
  onUnknownNotification?: (notification: { method: string; params?: unknown }) => void;
  onListenerError?: (error: unknown) => void;
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

### Account rate limits

`readRateLimits(options?: ReadCodexRateLimitsOptions)` reads fresh account limits
and returns `CodexSurfaceRateLimits`. Pass `{ excludeResetCreditDetails: true }`
for counts only, or `false` for credit details. The successful read replaces
`snapshot.rateLimits` and emits `rateLimits.changed`; failed reads preserve the
last successful value and reject. Reads also reject if the account changes or
the surface closes before the response is published.

Requests use the `CodexAppServerClient` request timeout. There is no per-read
transport abort. A host can abandon a read and discard its late result.

### Earned rate-limit resets

`consumeRateLimitResetCredit(options)` makes one explicit redemption attempt:

```ts
type ConsumeCodexRateLimitResetCreditOptions = {
  idempotencyKey: string;
  creditId?: string;
};
type CodexSurfaceRateLimitResetCreditResult = {
  outcome: 'reset' | 'alreadyRedeemed' | 'nothingToReset' | 'noCredit';
};
```

Require user confirmation before calling. Use a non-empty UUID as the
`idempotencyKey` for each logical attempt; reuse that exact key if explicitly
retrying an uncertain attempt. `creditId`, when supplied, is a non-empty opaque
ID from `readRateLimits()`. Omitting it lets the provider select a credit.
Identifiers are preserved, not trimmed or generated by the SDK.

`reset` consumed a credit; `alreadyRedeemed` is an idempotent success.
`nothingToReset` means no eligible window, and `noCredit` means no available
credit. The SDK returns only the outcome: it does not infer new windows or
credit counts, change snapshots, retry, or refresh automatically. Explicitly
read limits afterward.

Provider errors and the existing client timeout propagate. Account changes or
surface closure reject a stale result. A timeout or stale-result rejection does
**not** prove that redemption failed; do not generate a new key for a retry of
that attempt. There is no per-operation transport abort. Host abandonment cannot
undo a request already sent to the provider.

### Account usage

`readAccountUsage(): Promise<CodexSurfaceAccountUsage>` reads account-wide
ChatGPT token summaries and daily buckets on demand. It takes no thread ID,
does not request or return thread estimates, and does not change snapshots or
emit usage events. Reads are never collected automatically or exported to
telemetry. Unsupported authentication/provider reads reject rather than
returning invented zeroes.

The five summary metrics (`lifetimeTokens`, `peakDailyTokens`,
`longestRunningTurnSec`, `currentStreakDays`, `longestStreakDays`) are nullable
decimal strings. `dailyUsageBuckets` is either `null` or rows containing
`startDate` and an exact decimal-string `tokens` count. Unsafe numeric counts
reject. Account changes, surface closure, request timeouts, and provider errors
have the same read controls as `readRateLimits()`.

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

`turn.completed` reflects app-server `turn/completed`, never an inferred result
from thread idle. `turn.error` preserves the server's `willRetry` flag; a
non-retrying error records a failed turn. `conversation.activityChanged` and
snapshot `busy` describe readiness, not task success. An idle turn whose
terminal notification is missing retains its last-known status. See
[readiness and turn outcomes](/guide/surface#readiness-is-not-a-turn-outcome).

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

Delete, edit, and retry require paginated conversation history. With app-server
0.164.0, legacy-history turns reject these mutations without changing history.

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
  /** Loads 5 recent turns using the configured paging and detail policies. */
  load(options?: CodexConversationLoadOptions): Promise<CodexConversationSnapshot>;
  select(): Promise<CodexConversationSnapshot>;
  readHistory(): Promise<CodexConversationHistory>;
  readPromptHistory(): Promise<CodexConversationPromptHistory>;
  /** Loads the next older page and reports whether another page remains. */
  loadOlderHistory(): Promise<CodexConversationHistoryPage>;
  /** Loads and caches full items for one currently loaded summary turn. */
  loadTurnHistory(turnId: string): Promise<CodexConversationSnapshot>;
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

`CodexConversationLoadOptions` accepts `historyItemsView?: 'full' | 'summary'`
alongside `loadingStrategy` and host configuration. A policy-only load on a
hydrated handle preserves its history window and live state; selecting `full`
awaits all loaded turn details and applies to future pages. Full turns are never
downgraded. `loadTurnHistory` shares concurrent requests, reports per-turn errors,
and preserves live work received during the read. The standalone surface also
exposes `loadTurnHistory(turnId, conversationId?)`.

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
- `startAppleSpeechSession(options, onEvent, dependencies?)`

`startAppleSpeechSession` accepts `{ sessionId, sampleRate, locale? }` and resolves
when the native helper is ready. Its session exposes `append(ArrayBuffer)` for
mono Float32 little-endian PCM, `stop()` to drain a final `{ text, error? }`, and
`cancel()` to discard input. Partial/final snapshot events carry the session ID.
Live sessions enable Apple's `volatileResults` and `fastResults` reporting options
to prioritize responsiveness. Apple documents a potential accuracy tradeoff for
[`fastResults`](https://developer.apple.com/documentation/speech/speechtranscriber/reportingoption/fastresults);
completed-file batch transcription does not enable it.
The optional dependencies include `assetsPath`, `signal` for cancellation during
startup, and `spawn` for process integration. Startup has a two-minute deadline;
finalization has a 30-second deadline. Temporary helper copies are removed at exit.

The owned helper source is published in `@codex-app-sdk/backend/native`.
Contributors can rebuild the universal macOS binary with `npm run build:apple-speech`
(Xcode 26 or later). The same binary supports the existing completed-file batch API.
To verify actual streaming locally, build the backend and run
`node scripts/test-apple-speech-live.mjs <mono-16000-f32le.pcm>` with a non-sensitive
speech fixture. This tests paced native recognition, not physical microphone access.
The command reports startup and first-text latency. Pass an optional maximum
first-text time in milliseconds after the fixture path to enforce a local latency
budget. Compare the same fixture on the same Mac; timings include its leading silence.

See the [surface guide](/guide/surface), [conversations](/guide/conversations),
and [extensions](/guide/extensions).

## `ConversationContentTransport`

Hosts carrying conversation snapshots or events over IPC or a network can replace
embedded image data URLs and file diffs larger than 64 KiB with small references before serialization. Image objects carry optional display `width` and `height`, probed from at most 64 KiB of base64 header text with EXIF orientation applied. Unreadable headers omit dimensions without changing image access. Create one
instance per conversation and pass immutable SDK snapshots/events to `project(value)`.
The original value and provider history remain unchanged; unchanged objects are reused. Remote HTTP image URLs are unchanged.

References have the form `conversation-image:<encoded conversation ID>:<sha256>`.
Route them through the renderer host's `readImagePreview` capability. Authorize the
request against the current conversation, then call
`read(currentSnapshot, contentId, offset)`. It returns `{ data, totalBytes, nextOffset }`,
where `data` is a base64-encoded chunk of the original image data URL, at most 64 KiB
before encoding. Start at offset zero and continue until `nextOffset` is null.

Reads fail for content absent from the supplied snapshot or invalid offsets. The
host must bind the request to the authorized conversation and recheck that binding
after asynchronous work. The weak cache only retains projections while their
source values remain reachable; it is not a media archive or conversation store.
Content entries refer to existing provider strings without retaining full binary
copies. Reads encode bounded blocks of at most 64 KiB, including UTF-8 diffs.

Large file changes keep their path, operation, and summary. Their `diff` becomes an
empty string alongside `diffContent: { sessionId, contentId, byteLength, changeKind }`.
The Vue file target forwards this reference to the host on selection. Fetch it using
the same `read` method; offsets and lengths count UTF-8 bytes, and the reconstructed
text is the exact historical patch (full file text for add/delete, unified hunks for
update). Reads never consult the current working-tree file.

### Original tool images from local history

Set `originalHistoryImages: true` on `CodexSurface` to restore recorded tool
images from the local app-server's existing history file. The default is `false`.
The SDK obtains that path from app-server, verifies the history's conversation
identity, and reads it without modifying it or creating image files or sidecars.

History snapshots contain small `conversation-image:` media references with
intrinsic dimensions when available. Originals belong to their recorded turn,
outer tool-call ID, and image index; temporary filenames do not establish image
identity. Native `imageView` operations remain as tool/path rows in this mode,
while their mutable current-file thumbnails are omitted. Other native media is
unchanged. Recorded images are inserted before the turn's final answer.

Main-process hosts can use `conversation.readContent(contentId, offset)` (or
`surface.readConversationContent(conversationId, contentId, offset)`) for both
original images and existing inline image/diff content. The result has the same
`{ data, totalBytes, nextOffset }` chunk contract as
`ConversationContentTransport.read`. The synchronous reader remains available.
Authorize the conversation before calling and recheck its host binding after
awaiting the result. The SDK checks that an original reference still belongs to
the current snapshot after asynchronous reads; foreign IDs and invalid offsets
are rejected. No renderer or mobile protocol change is required.

Scanning uses 64 KiB file reads, at most 256 MiB per history file and 100,000
records; records over 32 MiB are skipped. Each of two cached offset indexes holds
at most 2,048 images; at most two encoded originals share one 20 MiB cache budget. Index scans and
record decodes are serialized per surface, including requests from older clients. At most 256 output blocks are examined per operation. Unavailable,
malformed, oversized, and foreign history cannot grant image access. The provider
history file must be accessible to the SDK process; this option is intended for
local app-server integrations.
