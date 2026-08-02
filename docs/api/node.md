# Node runtime API

```ts
import {
  CodexSurface,
  createCodexSurface,
} from 'codex-app-sdk/node';
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
  };
  conversationLimit?: number;
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

### Catalogs

- `refreshConversations()`
- `listConversations(options?)`
- `listModels(options?)`
- `listSkills(options?)`

### Conversation lifecycle

- `createConversation(options?, hostOptions?)`
- `selectConversation(id)`
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
- queued-prompt actions
- approval and app-server client-request responses
- `setGoal(objective, tokenBudget?)` / `clearGoal()`

## `CodexConversation`

Stable Node handle for one conversation:

```ts
type CodexConversation = {
  readonly id: string;
  load(options?: CodexConversationLoadOptions): Promise<CodexConversationSnapshot>;
  select(): Promise<CodexConversationSnapshot>;
  readHistory(): Promise<CodexConversationHistory>;
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

`sendMessage` and `steerMessage` accept the same attachment options. Steering
maps attachments to app-server `UserInput` blocks and includes them in the
optimistic user steer message.

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
