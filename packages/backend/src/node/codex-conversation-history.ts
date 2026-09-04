import type { Thread } from '../codex/generated/v2/Thread';
import type { ThreadItem } from '../codex/generated/v2/ThreadItem';
import type { Turn } from '../codex/generated/v2/Turn';
import { basename, extname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  SurfaceMessage,
  SurfaceMessageAttachment,
  SurfaceMessageMediaPart,
  SurfaceMessagePart,
} from '@codex-app-sdk/core/surface';
import { codexThreadItemToToolPart } from './codex-tool-part-adapter';
import { finalizeTurnToolParts } from './codex-surface-message-state';

export { codexThreadItemToToolPart as codexItemToToolPart } from './codex-tool-part-adapter';

const MAX_INLINE_GENERATED_IMAGE_BYTES = 16 * 1024 * 1024;
const supportedGeneratedImageMimeTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export function codexThreadToSurfaceMessages(thread: Thread): SurfaceMessage[] {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  return turns.flatMap((turn) => codexTurnToSurfaceMessages(thread.id, turn));
}

/**
 * Keep bounded data previews from optimistic messages when app-server history
 * rematerializes the same user attachment from its local filesystem path.
 * Filesystem URLs are not renderer-safe in Electron and are intentionally not
 * used as image sources.
 */
export function preserveHistoricalAttachmentPreviews(
  previousMessages: readonly SurfaceMessage[],
  historyMessages: readonly SurfaceMessage[],
): SurfaceMessage[] {
  const previewsByPath = new Map<string, string>();
  for (const message of previousMessages) {
    for (const part of message.parts) {
      if (part.type !== 'attachment' || part.attachment.kind !== 'image' || !part.attachment.path) continue;
      if (isRendererSafeImagePreview(part.attachment.url)) {
        previewsByPath.set(part.attachment.path, part.attachment.url);
      }
    }
  }
  if (previewsByPath.size === 0) return [...historyMessages];

  return historyMessages.map((message) => {
    let changed = false;
    const parts = message.parts.map((part) => {
      if (part.type !== 'attachment' || part.attachment.kind !== 'image' || !part.attachment.path) {
        return part;
      }
      const previewUrl = previewsByPath.get(part.attachment.path);
      if (!previewUrl || part.attachment.url === previewUrl) return part;
      changed = true;
      return { ...part, attachment: { ...part.attachment, url: previewUrl } };
    });
    return changed ? { ...message, parts } : message;
  });
}

export function codexTurnToSurfaceMessages(threadId: string, turn: Turn): SurfaceMessage[] {
  const messages: SurfaceMessage[] = [];
  const assistantParts: SurfaceMessagePart[] = [];
  const createdAt = timestampToIso(turn.startedAt ?? turn.completedAt);
  let assistantSegmentIndex = 0;
  let sawAssistantActivity = false;
  const initialUserMessageKeys = new Set<string>();

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
        const initialMessageKey = isSteerMessage ? null : JSON.stringify(parts);
        if (initialMessageKey && initialUserMessageKeys.has(initialMessageKey)) continue;
        if (initialMessageKey) initialUserMessageKeys.add(initialMessageKey);
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
        assistantParts.push({
          type: 'text',
          text,
          itemId: item.id,
          ...(item.phase ? { phase: item.phase } : {}),
        });
      }
      continue;
    }

    if (item.type === 'reasoning') {
      const summaries = item.summary
        .map((summary, summaryIndex) => ({ summary: summary.trim(), summaryIndex }))
        .filter(({ summary }) => summary.length > 0);
      if (summaries.length > 0) {
        sawAssistantActivity = true;
        assistantParts.push(...summaries.map(({ summary, summaryIndex }) => ({
          type: 'reasoning' as const,
          summary,
          itemId: item.id,
          summaryIndex,
        })));
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
    const mediaPart = codexItemToMediaPart(item);
    if (mediaPart) {
      sawAssistantActivity = true;
      assistantParts.push(mediaPart);
    }
  }

  flushAssistantMessage();
  return turn.status === 'inProgress'
    ? messages
    : finalizeTurnToolParts(messages, turn.id, turn.status);
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
      parts: [{
        type: 'text',
        text,
        itemId: item.id,
        ...(item.type === 'agentMessage' && item.phase ? { phase: item.phase } : {}),
      }],
      createdAt,
      metadata: { conversationId: threadId, turnId: turn.id, itemId: item.id },
    } : null;
  }

  if (item.type === 'reasoning') {
    const parts = item.summary
      .map((summary, summaryIndex) => ({ summary: summary.trim(), summaryIndex }))
      .filter(({ summary }) => summary.length > 0)
      .map(({ summary, summaryIndex }) => ({
        type: 'reasoning' as const,
        summary,
        itemId: item.id,
        summaryIndex,
      }));
    return parts.length > 0 ? {
      id: `assistant-${item.id}`,
      role: 'assistant',
      status: surfaceMessageStatus(turn.status),
      turnId: turn.id,
      parts,
      createdAt,
      metadata: { conversationId: threadId, turnId: turn.id, itemId: item.id },
    } : null;
  }

  const parts: SurfaceMessagePart[] = [];
  const toolPart = codexThreadItemToToolPart(item);
  if (toolPart) parts.push(toolPart);
  const mediaPart = codexItemToMediaPart(item);
  if (mediaPart) parts.push(mediaPart);
  const message: SurfaceMessage | null = parts.length > 0 ? {
    id: `assistant-${item.id}`,
    role: 'assistant',
    status: surfaceMessageStatus(turn.status),
    turnId: turn.id,
    parts,
    createdAt,
    metadata: { conversationId: threadId, turnId: turn.id, itemId: item.id },
  } : null;
  if (!message || turn.status === 'inProgress') return message;
  return finalizeTurnToolParts([message], turn.id, turn.status)[0] ?? null;
}

export function codexItemToMediaPart(item: ThreadItem): SurfaceMessageMediaPart | null {
  if (item.type !== 'imageGeneration') return null;
  const toolPart = codexThreadItemToToolPart(item);
  if (toolPart?.status !== 'completed') return null;

  const candidatePath = typeof item.savedPath === 'string' && isAbsolute(item.savedPath)
    ? item.savedPath
    : null;
  const savedPathMimeType = candidatePath ? mimeTypeForSource(candidatePath) : undefined;
  const savedPath = savedPathMimeType && supportedGeneratedImageMimeTypes.has(savedPathMimeType)
    ? candidatePath
    : null;
  const result = typeof item.result === 'string' ? item.result.trim() : '';
  const inlineImage = codexImageDataUrl(result);
  const url = inlineImage?.url ?? (savedPath ? pathToFileURL(savedPath).href : undefined);
  if (!url) return null;

  const prompt = typeof item.revisedPrompt === 'string' ? item.revisedPrompt.trim() : '';
  return {
    type: 'media',
    itemId: item.id,
    media: {
      url,
      alt: 'Generated image',
      title: 'Generated image',
      mimeType: inlineImage?.mimeType ?? savedPathMimeType ?? 'image/png',
      ...(prompt ? { prompt } : {}),
    },
  };
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

export function codexImageDataUrl(result: string): { url: string; mimeType: string } | null {
  if (!result) return null;
  const dataUrlMatch = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(result);
  const compact = (dataUrlMatch?.[1] ?? result).replace(/\s+/g, '');
  const maxEncodedLength = Math.ceil(MAX_INLINE_GENERATED_IMAGE_BYTES / 3) * 4 + 4;
  if (
    !compact
    || compact.length > maxEncodedLength
    || compact.length % 4 !== 0
    || !/^[a-z0-9+/]+={0,2}$/i.test(compact)
  ) {
    return null;
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_INLINE_GENERATED_IMAGE_BYTES) return null;
  const mimeType = generatedImageMimeType(bytes);
  if (!mimeType) return null;
  return { url: `data:${mimeType};base64,${compact}`, mimeType };
}

function isRendererSafeImagePreview(value: string | undefined): value is string {
  return Boolean(
    value
    && value.length <= 16 * 1024 * 1024
    && /^data:image\/(?:avif|bmp|gif|heic|heif|jpe?g|png|webp);base64,[a-z\d+/]+={0,2}$/i.test(value),
  );
}

function generatedImageMimeType(bytes: Uint8Array): string | null {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  const header = Buffer.from(bytes.subarray(0, 12)).toString('ascii');
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
  if (bytes.byteLength >= 12 && header.slice(4, 12) === 'ftypavif') return 'image/avif';
  return null;
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function surfaceMessageStatus(status: Turn['status']): SurfaceMessage['status'] {
  if (status === 'inProgress') return 'streaming';
  if (status === 'failed') return 'error';
  return 'complete';
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
