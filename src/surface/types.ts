export type SurfaceMessageTextPart = {
  type: 'text';
  text: string;
};

export type SurfaceMessageStatusPart = {
  type: 'status';
  text: string;
};

export type SurfaceMessageToolPart = {
  type: 'tool';
  id: string;
  title: string;
  kind?: string;
  status: 'running' | 'completed' | 'failed';
  statusText?: string;
  body?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
};

export type SurfaceMessagePart =
  | SurfaceMessageTextPart
  | SurfaceMessageStatusPart
  | SurfaceMessageToolPart;

export type SurfaceMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  status: 'complete' | 'streaming' | 'error';
  parts: readonly SurfaceMessagePart[];
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export type CodexConversationSummary = {
  id: string;
  title: string;
  preview: string;
  cwd: string;
  status: 'idle' | 'active' | 'error';
  createdAt: string;
  updatedAt: string;
};

export type CodexSurfaceApproval = {
  id: string;
  kind: 'command' | 'file-change' | 'permissions';
  conversationId: string;
  turnId?: string;
  itemId: string;
  title: string;
  description?: string;
  command?: string;
  cwd?: string;
};

export type CodexSurfaceApprovalDecision = 'approve' | 'deny';
export type CodexSurfaceApprovalScope = 'once' | 'session';

export type CodexSurfaceStatus = 'idle' | 'connecting' | 'ready' | 'error';

export type CodexSurfaceSnapshot = {
  status: CodexSurfaceStatus;
  conversations: CodexConversationSummary[];
  activeConversationId: string | null;
  messages: SurfaceMessage[];
  approvals: CodexSurfaceApproval[];
  busy: boolean;
  error: string | null;
};

export type CodexSurfacePermissionMode = 'read-only' | 'workspace-write' | 'full-access';
export type CodexSurfaceApprovalMode = 'ask' | 'never';

export type CreateCodexConversationOptions = {
  approvalMode?: CodexSurfaceApprovalMode;
  cwd?: string;
  model?: string;
  permissionMode?: CodexSurfacePermissionMode;
};

export type SendCodexMessageOptions = {
  model?: string;
};

export type CodexSurfaceApi = {
  connect(): Promise<CodexSurfaceSnapshot>;
  refreshConversations(): Promise<CodexSurfaceSnapshot>;
  createConversation(options?: CreateCodexConversationOptions): Promise<CodexSurfaceSnapshot>;
  selectConversation(conversationId: string): Promise<CodexSurfaceSnapshot>;
  sendMessage(prompt: string, options?: SendCodexMessageOptions): Promise<CodexSurfaceSnapshot>;
  interrupt(): Promise<CodexSurfaceSnapshot>;
  resolveApproval(
    approvalId: string,
    decision: CodexSurfaceApprovalDecision,
    scope?: CodexSurfaceApprovalScope,
  ): Promise<CodexSurfaceSnapshot>;
  getSnapshot(): Promise<CodexSurfaceSnapshot>;
  onStateChange(listener: (snapshot: CodexSurfaceSnapshot) => void): () => void;
};
