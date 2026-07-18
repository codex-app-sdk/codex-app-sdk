import type { Thread } from '../codex/generated/v2/Thread';
import type { ThreadItem } from '../codex/generated/v2/ThreadItem';
import type { Turn } from '../codex/generated/v2/Turn';
import type { SurfaceMessage, SurfaceMessagePart } from '../surface/types';
import { codexThreadItemToToolPart } from './codex-tool-part-adapter';

export { codexThreadItemToToolPart as codexItemToToolPart } from './codex-tool-part-adapter';

export function codexThreadToSurfaceMessages(thread: Thread): SurfaceMessage[] {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  return turns.flatMap((turn) => codexTurnToSurfaceMessages(thread.id, turn));
}

export function codexTurnToSurfaceMessages(threadId: string, turn: Turn): SurfaceMessage[] {
  const messages: SurfaceMessage[] = [];
  const assistantParts: SurfaceMessagePart[] = [];
  const createdAt = timestampToIso(turn.startedAt ?? turn.completedAt);
  let assistantSegmentIndex = 0;
  let sawAssistantActivity = false;

  const flushAssistantMessage = () => {
    if (assistantParts.length === 0) {
      return;
    }

    const segmentSuffix = assistantSegmentIndex === 0 ? '' : `-segment-${assistantSegmentIndex}`;
    messages.push({
      id: `assistant-${turn.id}${segmentSuffix}`,
      role: 'assistant',
      status: surfaceMessageStatus(turn.status),
      turnId: turn.id,
      parts: [...assistantParts],
      createdAt,
    });
    assistantParts.length = 0;
    assistantSegmentIndex += 1;
  };

  for (const item of Array.isArray(turn.items) ? turn.items : []) {
    if (item.type === 'userMessage') {
      const text = userMessageText(item);
      if (text) {
        const isSteerMessage = sawAssistantActivity;
        flushAssistantMessage();
        messages.push({
          id: item.clientId ?? `user-${threadId}-${turn.id}-${item.id ?? messages.length}`,
          ...(isSteerMessage ? { kind: 'steer' as const } : {}),
          role: 'user',
          status: 'complete',
          turnId: turn.id,
          parts: [{ type: 'text', text }],
          createdAt,
        });
      }
      continue;
    }

    if (item.type === 'agentMessage') {
      const text = typeof item.text === 'string' ? item.text : '';
      if (text) {
        sawAssistantActivity = true;
        assistantParts.push({ type: 'text', text, itemId: item.id });
      }
      continue;
    }

    if (item.type === 'exitedReviewMode') {
      const text = typeof item.review === 'string' ? item.review : '';
      if (text) {
        sawAssistantActivity = true;
        assistantParts.push({ type: 'text', text, itemId: item.id });
      }
      continue;
    }

    const toolPart = codexThreadItemToToolPart(item);
    if (toolPart) {
      sawAssistantActivity = true;
      assistantParts.push(toolPart);
    }
  }

  flushAssistantMessage();
  return messages;
}

export function codexItemToSurfaceMessage(
  threadId: string,
  turn: Pick<Turn, 'id' | 'status' | 'startedAt'>,
  item: ThreadItem,
): SurfaceMessage | null {
  const createdAt = timestampToIso(turn.startedAt);
  if (item.type === 'userMessage') {
    const text = userMessageText(item);
    return text ? {
      id: item.clientId ?? `user-${threadId}-${turn.id}-${item.id}`,
      role: 'user',
      status: 'complete',
      turnId: turn.id,
      parts: [{ type: 'text', text }],
      createdAt,
      metadata: { conversationId: threadId, turnId: turn.id, itemId: item.id },
    } : null;
  }

  if (item.type === 'agentMessage' || item.type === 'exitedReviewMode') {
    const text = item.type === 'agentMessage' ? item.text : item.review;
    return text ? {
      id: `assistant-${item.id}`,
      role: 'assistant',
      status: surfaceMessageStatus(turn.status),
      turnId: turn.id,
      parts: [{ type: 'text', text, itemId: item.id }],
      createdAt,
      metadata: { conversationId: threadId, turnId: turn.id, itemId: item.id },
    } : null;
  }

  const toolPart = codexThreadItemToToolPart(item);
  return toolPart ? {
    id: `assistant-${item.id}`,
    role: 'assistant',
    status: surfaceMessageStatus(turn.status),
    turnId: turn.id,
    parts: [toolPart],
    createdAt,
    metadata: { conversationId: threadId, turnId: turn.id, itemId: item.id },
  } : null;
}

function userMessageText(item: Extract<ThreadItem, { type: 'userMessage' }>): string {
  const content = Array.isArray(item.content) ? item.content : [];
  return content.map(userInputText).filter(Boolean).join('\n');
}

function userInputText(input: unknown): string {
  if (!isRecord(input) || typeof input.type !== 'string') {
    return '';
  }
  if (input.type === 'text' && typeof input.text === 'string') return input.text;
  if (input.type === 'skill' && typeof input.name === 'string') return `$${input.name}`;
  if (input.type === 'mention' && typeof input.name === 'string') return `@${input.name}`;
  if (input.type === 'image' && typeof input.url === 'string') return `![image](${input.url})`;
  if (input.type === 'localImage' && typeof input.path === 'string') return `![image](${input.path})`;
  return '';
}

function surfaceMessageStatus(status: Turn['status']): SurfaceMessage['status'] {
  if (status === 'completed') return 'complete';
  if (status === 'failed') return 'error';
  return 'streaming';
}

function timestampToIso(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return new Date(0).toISOString();
  }
  return new Date(timestamp * 1000).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
