import type { Thread } from '../codex/generated/v2/Thread';
import type { ThreadItem } from '../codex/generated/v2/ThreadItem';
import type { Turn } from '../codex/generated/v2/Turn';
import type { SurfaceMessage, SurfaceMessageToolPart } from '../surface/types';

export function codexThreadToSurfaceMessages(thread: Thread): SurfaceMessage[] {
  return thread.turns.flatMap((turn) => codexTurnToSurfaceMessages(thread.id, turn));
}

export function codexTurnToSurfaceMessages(threadId: string, turn: Turn): SurfaceMessage[] {
  const messages: SurfaceMessage[] = [];
  for (const item of turn.items) {
    const message = codexItemToSurfaceMessage(threadId, turn, item);
    if (message) {
      messages.push(message);
    }
  }
  return messages;
}

export function codexItemToSurfaceMessage(
  threadId: string,
  turn: Pick<Turn, 'id' | 'status' | 'startedAt'>,
  item: ThreadItem,
): SurfaceMessage | null {
  const metadata = { conversationId: threadId, turnId: turn.id, itemId: item.id };
  const createdAt = timestampToIso(turn.startedAt);
  if (item.type === 'userMessage') {
    const text = item.content.map(userInputText).filter(Boolean).join('\n');
    return text ? {
      id: item.clientId ?? `user-${item.id}`,
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text }],
      createdAt,
      metadata,
    } : null;
  }

  if (item.type === 'agentMessage') {
    return {
      id: `assistant-${item.id}`,
      role: 'assistant',
      status: turnStatus(turn.status),
      parts: [{ type: 'text', text: item.text }],
      createdAt,
      metadata,
    };
  }

  if (item.type === 'plan' || item.type === 'exitedReviewMode') {
    return {
      id: `assistant-${item.id}`,
      role: 'assistant',
      status: turnStatus(turn.status),
      parts: [{ type: 'text', text: item.type === 'plan' ? item.text : item.review }],
      createdAt,
      metadata,
    };
  }

  const tool = codexItemToToolPart(item);
  return tool ? {
    id: `assistant-${item.id}`,
    role: 'assistant',
    status: turnStatus(turn.status),
    parts: [tool],
    createdAt,
    metadata,
  } : null;
}

export function codexItemToToolPart(item: ThreadItem): SurfaceMessageToolPart | null {
  switch (item.type) {
    case 'commandExecution':
      return {
        type: 'tool',
        id: item.id,
        title: item.command,
        kind: 'command',
        status: toolStatus(item.status),
        ...(item.aggregatedOutput ? { body: item.aggregatedOutput, output: item.aggregatedOutput } : {}),
        metadata: { cwd: item.cwd, exitCode: item.exitCode },
      };
    case 'fileChange':
      return {
        type: 'tool',
        id: item.id,
        title: item.changes.length === 1 ? 'Changed 1 file' : `Changed ${item.changes.length} files`,
        kind: 'file-change',
        status: toolStatus(item.status),
        output: item.changes,
      };
    case 'mcpToolCall':
      return {
        type: 'tool',
        id: item.id,
        title: `${item.server} · ${item.tool}`,
        kind: 'mcp',
        status: toolStatus(item.status),
        input: item.arguments,
        ...(item.result ? { output: item.result } : {}),
        ...(item.error ? { body: item.error.message } : {}),
      };
    case 'dynamicToolCall':
      return {
        type: 'tool',
        id: item.id,
        title: [item.namespace, item.tool].filter(Boolean).join(' · '),
        kind: 'tool',
        status: item.success === false ? 'failed' : toolStatus(item.status),
        input: item.arguments,
        ...(item.contentItems ? { output: item.contentItems } : {}),
      };
    case 'reasoning':
      return {
        type: 'tool',
        id: item.id,
        title: 'Reasoning',
        kind: 'reasoning',
        status: 'completed',
        body: [...item.summary, ...item.content].join('\n'),
      };
    case 'webSearch':
      return {
        type: 'tool',
        id: item.id,
        title: item.query || 'Web search',
        kind: 'web-search',
        status: 'completed',
      };
    case 'imageView':
      return { type: 'tool', id: item.id, title: `Viewed ${item.path}`, kind: 'image', status: 'completed' };
    case 'imageGeneration':
      return { type: 'tool', id: item.id, title: 'Generated image', kind: 'image', status: toolStatus(item.status) };
    case 'collabAgentToolCall':
      return { type: 'tool', id: item.id, title: `Agent ${item.tool}`, kind: 'agent', status: toolStatus(item.status) };
    case 'sleep':
      return { type: 'tool', id: item.id, title: 'Waited', kind: 'wait', status: 'completed', metadata: { durationMs: item.durationMs } };
    default:
      return null;
  }
}

function userInputText(input: ThreadItem & never): string;
function userInputText(input: { type: string; [key: string]: unknown }): string;
function userInputText(input: { type: string; [key: string]: unknown }): string {
  if (input.type === 'text' && typeof input.text === 'string') return input.text;
  if (input.type === 'skill' && typeof input.name === 'string') return `$${input.name}`;
  if (input.type === 'mention' && typeof input.name === 'string') return `@${input.name}`;
  if (input.type === 'image' && typeof input.url === 'string') return `![image](${input.url})`;
  if (input.type === 'localImage' && typeof input.path === 'string') return `![image](${input.path})`;
  return '';
}

function toolStatus(status: string): SurfaceMessageToolPart['status'] {
  if (['failed', 'declined', 'error'].includes(status)) return 'failed';
  if (['completed', 'complete', 'applied'].includes(status)) return 'completed';
  return 'running';
}

function turnStatus(status: Turn['status']): SurfaceMessage['status'] {
  if (status === 'failed') return 'error';
  if (status === 'inProgress') return 'streaming';
  return 'complete';
}

function timestampToIso(timestamp: number | null): string | undefined {
  return typeof timestamp === 'number' ? new Date(timestamp * 1000).toISOString() : undefined;
}
