import type { Thread } from '../codex/generated/v2/Thread';
import type { ThreadItem } from '../codex/generated/v2/ThreadItem';
import type { Turn } from '../codex/generated/v2/Turn';
import { basename, extname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  SurfaceMessage,
  SurfaceMessageAttachment,
  SurfaceMessagePart,
} from '../surface/types';
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
      metadata: { conversationId: threadId, turnId: turn.id },
    });
    assistantParts.length = 0;
    assistantSegmentIndex += 1;
  };

  for (const item of Array.isArray(turn.items) ? turn.items : []) {
    if (item.type === 'userMessage') {
      const parts = userMessageParts(item);
      if (parts.length > 0) {
        const isSteerMessage = sawAssistantActivity;
        flushAssistantMessage();
        messages.push({
          id: item.clientId ?? `user-${threadId}-${turn.id}-${item.id ?? messages.length}`,
          ...(isSteerMessage ? { kind: 'steer' as const } : {}),
          role: 'user',
          status: 'complete',
          turnId: turn.id,
          parts,
          createdAt,
          metadata: { conversationId: threadId, turnId: turn.id },
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
    const parts = userMessageParts(item);
    return parts.length > 0 ? {
      id: item.clientId ?? `user-${threadId}-${turn.id}-${item.id}`,
      role: 'user',
      status: 'complete',
      turnId: turn.id,
      parts,
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

function userMessageParts(item: Extract<ThreadItem, { type: 'userMessage' }>): SurfaceMessagePart[] {
  const content = Array.isArray(item.content) ? item.content : [];
  const parts: SurfaceMessagePart[] = [];
  let text: string[] = [];
  const flushText = () => {
    if (text.length > 0) parts.push({ type: 'text', text: text.join('\n') });
    text = [];
  };

  for (const input of content) {
    const inputText = userInputText(input);
    if (inputText) {
      text.push(inputText);
      continue;
    }
    const attachment = userInputAttachment(input);
    if (!attachment) continue;
    flushText();
    parts.push({ type: 'attachment', attachment });
  }
  flushText();
  return parts;
}

function userInputText(input: unknown): string {
  if (!isRecord(input) || typeof input.type !== 'string') {
    return '';
  }
  if (input.type === 'text' && typeof input.text === 'string') return input.text;
  if (input.type === 'skill' && typeof input.name === 'string') return `$${input.name}`;
  return '';
}

function userInputAttachment(input: unknown): SurfaceMessageAttachment | null {
  if (!isRecord(input) || typeof input.type !== 'string') return null;
  if (input.type === 'mention' && typeof input.path === 'string') {
    const name = typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : attachmentName(input.path, 'File');
    const mimeType = mimeTypeForSource(input.path);
    return {
      kind: 'file',
      name,
      path: input.path,
      ...(mimeType ? { mimeType } : {}),
    };
  }
  if (input.type === 'image' && typeof input.url === 'string') {
    const mimeType = mimeTypeForSource(input.url);
    return {
      kind: 'image',
      name: attachmentName(input.url, 'Image'),
      url: input.url,
      ...(mimeType ? { mimeType } : {}),
    };
  }
  if (input.type === 'localImage' && typeof input.path === 'string') {
    const mimeType = mimeTypeForSource(input.path);
    return {
      kind: 'image',
      name: attachmentName(input.path, 'Image'),
      path: input.path,
      ...(isAbsolute(input.path) ? { url: pathToFileURL(input.path).href } : {}),
      ...(mimeType ? { mimeType } : {}),
    };
  }
  return null;
}

function attachmentName(source: string, fallback: string): string {
  try {
    const path = /^[a-z][a-z\d+.-]*:/i.test(source) ? new URL(source).pathname : source;
    const name = basename(decodeURIComponent(path)).trim();
    return name || fallback;
  } catch {
    return basename(source).trim() || fallback;
  }
}

function mimeTypeForSource(source: string): string | undefined {
  const dataMimeType = /^data:([^;,]+)/i.exec(source)?.[1]?.toLowerCase();
  if (dataMimeType) return dataMimeType;
  let extension = '';
  try {
    const path = /^[a-z][a-z\d+.-]*:/i.test(source) ? new URL(source).pathname : source;
    extension = extname(path).slice(1).toLowerCase();
  } catch {
    extension = extname(source).slice(1).toLowerCase();
  }
  return ({
    avif: 'image/avif',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    pdf: 'application/pdf',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
  } as Record<string, string>)[extension];
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
