export type ToolExecutionState = 'running' | 'completed' | 'error' | 'canceled';

export type ToolStatusDescriptor = {
  action: string;
  phase: string;
  params?: Record<string, unknown>;
  source: string;
};

export type MessageToolCall = {
  args: unknown;
  done?: boolean;
  function: string;
  id: string;
  /** Assistant message that contains this tool call, when adapted from a surface message. */
  messageId?: string;
  kind?: string;
  metadata?: Readonly<Record<string, unknown>>;
  /** App-server item id for this tool call, when available. */
  itemId?: string;
  state: ToolExecutionState;
  status?: string;
  /** Turn that produced this tool call, when adapted from a surface message. */
  turnId?: string;
  result: unknown;
};

export function getMessageToolCallName(toolCall: MessageToolCall) {
  return toolCall.function;
}

export function isImageGenerationToolCall(toolCall: MessageToolCall): boolean {
  return toolCall.kind === 'imageGeneration' || toolCall.function === 'image_generation';
}

export function getMessageToolCallArgs(toolCall: MessageToolCall) {
  return toolCall.args;
}

export type MessageMedia = {
  alt?: string;
  mimeType?: string;
  prompt?: string;
  title?: string;
  url: string;
};

export type MessageAttachment = {
  kind: 'file' | 'image';
  name: string;
  path?: string;
  url?: string;
  mimeType?: string;
};

export type MessagePhase = 'commentary' | 'final_answer';

export type MessagePart =
  | { type: 'attachment'; attachment: MessageAttachment }
  | { type: 'media'; media: MessageMedia }
  | { type: 'reasoning'; summary: string; itemId?: string; summaryIndex?: number }
  | { type: 'text'; content: string; itemId?: string; phase?: MessagePhase }
  | { type: 'tool'; toolCall: MessageToolCall };

export type MessageSuggestedPrompt = {
  kind: 'chat' | 'idea';
  text: string;
};

export type Message = {
  compactionStatus?: 'completed' | 'running';
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  engine?: string;
  id?: string;
  model?: string;
  parts?: MessagePart[];
  streaming?: boolean;
  suggestedPrompts?: MessageSuggestedPrompt[];
  toolCalls?: MessageToolCall[];
  type?: 'compaction' | 'display' | 'steer' | 'text';
};

export type ChatModelOption = {
  engine: string;
  internalId: string;
  label: string;
};
