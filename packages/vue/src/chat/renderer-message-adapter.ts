import type { SurfaceMessage, SurfaceMessagePart } from '@codex-app-sdk/core/surface';
import type { Message, MessagePart, MessageToolCall, ToolExecutionState } from './types';

export type ChatMessageInput = Message | SurfaceMessage;

export function chatMessagesFromInputs(messages: readonly ChatMessageInput[]): Message[] {
  return messages.map(chatMessageFromInput);
}

export function chatMessageFromInput(message: ChatMessageInput): Message {
  return settleTerminalMessageToolCalls(
    'content' in message ? message : surfaceMessageToChatMessage(message),
  );
}

export function surfaceMessageToChatMessage(message: SurfaceMessage): Message {
  const contentParts: string[] = [];
  const parts: MessagePart[] = [];
  const toolCalls: MessageToolCall[] = [];
  const turnId = message.turnId ?? stringMetadata(message.metadata, 'turnId');

  for (const part of message.parts) {
    if (part.type === 'tool') {
      const toolCall = rendererToolPartToToolCall(message, part, toolCalls.length);
      toolCalls.push(toolCall);
      parts.push({ type: 'tool', toolCall });
    } else if (part.type === 'attachment') {
      parts.push({
        type: 'attachment',
        attachment: { ...part.attachment },
      });
    } else if (part.type === 'media') {
      parts.push({
        type: 'media',
        media: { ...part.media },
      });
    } else if (part.type === 'reasoning') {
      parts.push({
        type: 'reasoning',
        summary: part.summary,
        itemId: part.itemId,
        summaryIndex: part.summaryIndex,
      });
    } else if (part.type === 'question') {
      parts.push({ type: 'question', request: part.request });
    } else if (part.type === 'text') {
      contentParts.push(part.text);
      parts.push({
        type: 'text',
        content: part.text,
        ...(part.itemId ? { itemId: part.itemId } : {}),
        ...(part.phase ? { phase: part.phase } : {}),
      });
    } else {
      contentParts.push(part.text);
      parts.push({ type: 'text', content: part.text });
    }
  }

  return settleTerminalMessageToolCalls({
    content: contentParts.join('\n\n'),
    createdAt: message.createdAt,
    id: message.id,
    parts,
    role: message.role === 'user' ? 'user' : 'assistant',
    streaming: message.status === 'streaming',
    toolCalls,
    ...(turnId ? { turnId } : {}),
    ...(message.kind === 'compaction' ? { compactionStatus: message.status === 'streaming' ? 'running' : 'completed' } : {}),
    type: message.kind === 'compaction' ? 'compaction' : message.kind === 'steer' ? 'steer' : 'text',
  });
}

function settleTerminalMessageToolCalls(message: Message): Message {
  if (message.streaming === true) return message;

  const settledCalls = new Map<MessageToolCall, MessageToolCall>();
  let changed = false;
  const settle = (toolCall: MessageToolCall): MessageToolCall => {
    const cached = settledCalls.get(toolCall);
    if (cached) return cached;
    if (toolCall.done === true && toolCall.state !== 'running') {
      return toolCall;
    }

    changed = true;
    const settled = {
      ...toolCall,
      done: true,
      ...(toolCall.state === 'running' ? {
        state: 'error' as const,
        status: terminalToolStatus(toolCall.status),
      } : {}),
    };
    settledCalls.set(toolCall, settled);
    return settled;
  };

  const toolCalls = message.toolCalls?.map(settle);
  const parts = message.parts?.map((part) => (
    part.type === 'tool' ? { ...part, toolCall: settle(part.toolCall) } : part
  ));
  return changed ? { ...message, parts, toolCalls } : message;
}

function terminalToolStatus(status: string | undefined): string {
  if (status?.trim().startsWith('{')) {
    try {
      const descriptor = JSON.parse(status) as Record<string, unknown>;
      return JSON.stringify({ ...descriptor, phase: 'failed' });
    } catch {
      // A stale running label is less useful than a stable terminal fallback.
    }
  }
  return 'failed';
}

function rendererToolPartToToolCall(message: SurfaceMessage, part: Extract<SurfaceMessagePart, { type: 'tool' }>, index: number): MessageToolCall {
  const turnId = message.turnId ?? stringMetadata(message.metadata, 'turnId');
  return {
    args: part.input ?? (part.body ? { output: part.body } : undefined),
    done: part.status !== 'running',
    function: part.title,
    id: part.id || `${message.id}-tool-${index}`,
    ...(part.kind ? { kind: part.kind } : {}),
    itemId: part.id || `${message.id}-tool-${index}`,
    messageId: message.id,
    ...(part.metadata ? { metadata: { ...part.metadata } } : {}),
    result: rendererToolPartResult(part),
    state: rendererToolStatusToState(part.status),
    status: part.statusText ?? part.status,
    ...(turnId ? { turnId } : {}),
  };
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function rendererToolPartResult(part: Extract<SurfaceMessagePart, { type: 'tool' }>): unknown {
  if (isRecord(part.output) && 'structuredContent' in part.output) {
    return part.output.structuredContent;
  }

  return part.body ?? part.output;
}

function rendererToolStatusToState(status: Extract<SurfaceMessagePart, { type: 'tool' }>['status']): ToolExecutionState {
  if (status === 'running') {
    return 'running';
  }

  return status === 'failed' ? 'error' : 'completed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
