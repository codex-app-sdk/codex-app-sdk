import type { CodexAppServerClient, v2 } from '../codex/index';
import type {
  CodexConversationEvent,
  CodexConversationHistory,
  CodexConversationHistoryPage,
  CodexConversationPromptHistory,
  CodexConversationLoadingStrategy,
  CodexConversationSnapshot,
  CodexRealtimeEvent,
  CodexRealtimeInputAudioChunk,
  CodexSurfaceApprovalDecision,
  CodexSurfaceApprovalMode,
  CodexSurfaceApprovalPreset,
  CodexSurfaceApprovalScope,
  CodexSurfaceClientRequestResponse,
  CodexSurfaceJsonValue,
  CodexSurfacePermissionMode,
  CreateCodexConversationOptions,
  SendCodexMessageOptions,
  StartCodexRealtimeOptions,
  StartCodexReviewOptions,
  UpdateCodexConversationSettings,
} from '@codex-app-sdk/core/surface';
import type { CodexMcpServerDefinition } from './codex-surface-mcp';
import type { CodexAppServerStdioTransportOptions } from './codex-stdio-transport';
import type { CodexAppServerUnixSocketTransportOptions } from './codex-unix-socket-transport';

export type GenerateCodexTextOptions = {
  baseInstructions?: string;
  cwd?: string;
  developerInstructions?: string;
  model?: string;
  outputSchema?: CodexSurfaceJsonValue;
  reasoningEffort?: string;
  serviceTier?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type CodexGeneratedText = {
  text: string;
};

export type CodexDynamicToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; imageUrl: string };

export type CodexDynamicToolResult = string | {
  content: readonly CodexDynamicToolContent[];
  success?: boolean;
};

export type CodexDynamicToolCall = {
  callId: string;
  conversationId: string;
  turnId: string;
  arguments: CodexSurfaceJsonValue;
  extensionContext?: unknown;
};

export type CodexDynamicTool = {
  name: string;
  description: string;
  inputSchema: CodexSurfaceJsonValue;
  deferLoading?: boolean;
  execute(call: CodexDynamicToolCall): CodexDynamicToolResult | Promise<CodexDynamicToolResult>;
};

export type CodexThreadStartExtension = {
  baseInstructions?: string;
  config?: Readonly<Record<string, CodexSurfaceJsonValue>>;
  developerInstructions?: string;
};

export type CodexConversationHostOptions = {
  extensionContext?: unknown;
  /** Replaces the surface MCP definitions for this conversation. Main-process only. */
  mcpServers?: readonly CodexMcpServerDefinition[];
};

export type CodexConversationDefaults = Pick<
  CreateCodexConversationOptions,
  'model' | 'reasoningEffort' | 'serviceTier'
>;

export type CodexConversationLoadOptions = CodexConversationHostOptions & {
  cwd?: string;
  loadingStrategy?: CodexConversationLoadingStrategy;
};

/** Trusted thread-start overrides applied to a fork. Omitted values inherit from the source thread. */
export type ForkCodexConversationOptions = CreateCodexConversationOptions;

export type CodexConversationForkResult = {
  readonly conversationId: string;
  readonly conversation: CodexConversation;
  readonly snapshot: CodexConversationSnapshot;
};

export type ListCodexSkillsOptions = {
  cwd?: string;
  forceReload?: boolean;
};

/** State returned by the app-server remote-control connection. */
export type CodexSurfaceRemoteControlStatus = v2.RemoteControlStatusReadResponse;

/** One-time remote-control pairing details returned by the app-server. */
export type CodexSurfaceRemoteControlPairing = v2.RemoteControlPairingStartResponse;

/** Result of checking whether a remote-control pairing code was claimed. */
export type CodexSurfaceRemoteControlPairingStatus = v2.RemoteControlPairingStatusResponse;

/** A device currently paired with a remote-control environment. */
export type CodexSurfaceRemoteControlClient = v2.RemoteControlClient;

/** A page of devices paired with a remote-control environment. */
export type CodexSurfaceRemoteControlClientPage = v2.RemoteControlClientsListResponse;

/** Managed configuration requirements relevant to the host surface. */
export type CodexSurfaceConfigRequirements = v2.ConfigRequirements;

export type CodexSurfaceExtension = {
  dynamicTools?: readonly CodexDynamicTool[];
  configureConversation?: (context: {
    operation: 'start' | 'resume';
    conversationId: string | null;
    cwd?: string;
    createOptions?: Readonly<CreateCodexConversationOptions>;
    extensionContext?: unknown;
  }) => CodexThreadStartExtension | Promise<CodexThreadStartExtension>;
};

export type CodexConversation = {
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
  load(options?: CodexConversationLoadOptions): Promise<CodexConversationSnapshot>;
  select(): Promise<CodexConversationSnapshot>;
  readHistory(): Promise<CodexConversationHistory>;
  readPromptHistory(): Promise<CodexConversationPromptHistory>;
  loadOlderHistory(): Promise<CodexConversationHistoryPage>;
  rename(title: string): Promise<CodexConversationSnapshot>;
  updateSettings(settings: UpdateCodexConversationSettings): Promise<CodexConversationSnapshot>;
  sendMessage(prompt: string, options?: SendCodexMessageOptions): Promise<CodexConversationSnapshot>;
  continueInterruptedTurn(): Promise<CodexConversationSnapshot>;
  /** Starts an experimental app-server realtime voice session without exposing JSON-RPC. */
  startRealtime(options: StartCodexRealtimeOptions): Promise<CodexRealtimeSession>;
  compact(): Promise<CodexConversationSnapshot>;
  startReview(options?: StartCodexReviewOptions): Promise<CodexConversationSnapshot>;
  steerMessage(prompt: string, options?: SendCodexMessageOptions): Promise<CodexConversationSnapshot>;
  interrupt(): Promise<CodexConversationSnapshot>;
  deleteTurn(turnId: string): Promise<CodexConversationSnapshot>;
  editTurn(turnId: string, content: string): Promise<CodexConversationSnapshot>;
  retryTurn(turnId: string): Promise<CodexConversationSnapshot>;
  deleteQueuedPrompt(promptId: string): Promise<CodexConversationSnapshot>;
  updateQueuedPrompt(promptId: string, prompt: string): Promise<CodexConversationSnapshot>;
  steerQueuedPrompt(promptId: string, prompt?: string): Promise<CodexConversationSnapshot>;
  respondToClientRequest(response: CodexSurfaceClientRequestResponse): Promise<CodexConversationSnapshot>;
  resolveApproval(
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope?: CodexSurfaceApprovalScope,
  ): Promise<CodexConversationSnapshot>;
  setGoal(objective: string, tokenBudget?: number | null): Promise<CodexConversationSnapshot>;
  clearGoal(): Promise<CodexConversationSnapshot>;
  getSnapshot(): CodexConversationSnapshot;
  onStateChange(listener: (snapshot: CodexConversationSnapshot) => void): () => void;
  onEvent(listener: (event: CodexConversationEvent) => void): () => void;
};

export type CodexRealtimeSession = {
  readonly conversationId: string;
  readonly transport: 'websocket' | 'webrtc';
  readonly remoteSdp: string | null;
  appendAudio(audio: CodexRealtimeInputAudioChunk): Promise<void>;
  appendText(text: string, role?: 'user' | 'developer' | 'assistant'): Promise<void>;
  appendSpeech(text: string): Promise<void>;
  stop(): Promise<void>;
  onEvent(listener: (event: CodexRealtimeEvent) => void): () => void;
};

export type CodexAppServerTransportOptions =
  | CodexAppServerStdioTransportOptions
  | CodexAppServerUnixSocketTransportOptions;

export type CodexSurfaceOptions = {
  approvalPreset?: CodexSurfaceApprovalPreset;
  approvalMode?: CodexSurfaceApprovalMode;
  clientInfo?: { name: string; title?: string; version: string };
  /** Host-owned defaults used by explicit and implicit conversation creation. */
  conversationDefaults?: Readonly<CodexConversationDefaults>;
  conversationLimit?: number;
  /** Default history loading strategy for resumed conversations. */
  loadingStrategy?: CodexConversationLoadingStrategy;
  /** Trusted main-process CODEX_HOME for the app-server. Never expose this through renderer IPC. */
  codexHome?: string;
  cwd?: string;
  autoSelectFirstConversation?: boolean;
  extensions?: readonly CodexSurfaceExtension[];
  /** App-owned MCP servers applied to every started or resumed conversation. Main-process only. */
  mcpServers?: readonly CodexMcpServerDefinition[];
  /** Receives notifications added by a newer app-server than this SDK schema. */
  onUnknownNotification?: (notification: { method: string; params?: unknown }) => void;
  permissionMode?: CodexSurfacePermissionMode;
  /** Defaults to a spawned stdio child; use `{ type: 'unixSocket' }` to reuse an existing local daemon. */
  transport?: CodexAppServerTransportOptions;
  /** Test and advanced embedding seam. Most apps should let the SDK create the client. */
  client?: CodexAppServerClient;
};
