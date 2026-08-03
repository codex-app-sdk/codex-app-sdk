import type { SurfaceMessage, SurfaceMessagePart } from '../../surface/types';
import type { Message, MessagePart, MessageToolCall, ToolExecutionState } from './types';

export type ChatMessageInput = Message | SurfaceMessage;

export function chatMessagesFromInputs(messages: readonly ChatMessageInput[]): Message[] {
  return messages.map(chatMessageFromInput);
}

export function chatMessageFromInput(message: ChatMessageInput): Message {
  return 'content' in message ? message : surfaceMessageToChatMessage(message);
}

export function surfaceMessageToChatMessage(message: SurfaceMessage): Message {
  const contentParts: string[] = [];
  const parts: MessagePart[] = [];
  const toolCalls: MessageToolCall[] = [];

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
    } else {
      contentParts.push(part.text);
      parts.push({ type: 'text', content: part.text });
    }
  }

  return {
    content: contentParts.join('\n\n'),
    createdAt: message.createdAt,
    id: message.id,
    parts,
    role: message.role === 'user' ? 'user' : 'assistant',
    streaming: message.status === 'streaming',
    toolCalls,
    ...(message.kind === 'compaction' ? { compactionStatus: message.status === 'streaming' ? 'running' : 'completed' } : {}),
    type: message.kind === 'compaction' ? 'compaction' : message.kind === 'steer' ? 'steer' : 'text',
  };
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
