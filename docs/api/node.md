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
  transport?: CodexAppServerStdioTransportOptions;
  client?: CodexAppServerClient;
};
```

`client` is a test/advanced embedding seam. Most applications should let the SDK
construct the client.

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
- `steerMessage(prompt)`
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
  steerMessage(prompt: string): Promise<CodexConversationSnapshot>;
  interrupt(): Promise<CodexConversationSnapshot>;
  rollbackToTurn(turnId: string): Promise<CodexConversationSnapshot>;
  getSnapshot(): CodexConversationSnapshot;
  onStateChange(listener): () => void;
  onEvent(listener): () => void;
  // message, queue, approval, client request, and goal actions are also exposed
};
```

## Runtime utilities

### Executable and transport

- `CodexAppServerStdioTransport`
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
