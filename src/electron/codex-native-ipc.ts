import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  CodexNativeAttachment,
  CodexNativeAttachmentInput,
  CodexNativeClipboardContent,
} from '../native/types';
import {
  transcribeWithAppleSpeechAnalyzer,
  type AppleSpeechTranscriptionOptions,
  type AppleSpeechTranscriptionResult,
} from '../node/apple-speech-transcription';
import {
  registerIpcMainHandlers,
  type IpcMainPort,
} from './typed-ipc';
import {
  codexNativeChannels as channels,
  type CodexNativeRequests as NativeRequests,
} from './codex-native-renderer';

export type CodexNativeDialog = {
  showOpenDialog(options: {
    filters?: { name: string; extensions: string[] }[];
    properties: Array<'multiSelections' | 'openFile'>;
    title: string;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
};

export type CodexNativeClipboard = {
  write(content: { html?: string; text: string }): void;
};

export type CodexNativeShell = {
  openExternal(href: string): Promise<void>;
};

export type CodexNativeMainOptions = {
  appleSpeechAssetsPath?: string;
  maxAttachmentBytes?: number;
  maxTotalAttachmentBytes?: number;
  maxAudioBytes?: number;
  maxImagePreviewBytes?: number;
  transcribeAudio?: (
    audioData: Buffer,
    options?: AppleSpeechTranscriptionOptions,
  ) => Promise<AppleSpeechTranscriptionResult>;
};

export type CodexNativeMainDependencies = {
  clipboard: CodexNativeClipboard;
  dialog: CodexNativeDialog;
  ipcMain: IpcMainPort;
  shell: CodexNativeShell;
};

const defaultMaxAttachmentBytes = 25 * 1024 * 1024;
const defaultMaxTotalAttachmentBytes = 100 * 1024 * 1024;
const defaultMaxAudioBytes = 25 * 1024 * 1024;
const maxPreviewBytes = 8 * 1024 * 1024;
const maxTotalPreviewBytes = 16 * 1024 * 1024;

export function registerCodexNativeIpc(
  dependencies: CodexNativeMainDependencies,
  options: CodexNativeMainOptions = {},
): () => void {
  const maxAttachmentBytes = positiveByteLimit(
    options.maxAttachmentBytes,
    defaultMaxAttachmentBytes,
    'Attachment byte limit',
  );
  const maxAudioBytes = positiveByteLimit(
    options.maxAudioBytes,
    defaultMaxAudioBytes,
    'Audio byte limit',
  );
  const maxTotalAttachmentBytes = positiveByteLimit(
    options.maxTotalAttachmentBytes,
    defaultMaxTotalAttachmentBytes,
    'Total attachment byte limit',
  );
  const maxImagePreviewBytes = positiveByteLimit(
    options.maxImagePreviewBytes,
    maxPreviewBytes,
    'Image preview byte limit',
  );

  const unregister = registerIpcMainHandlers<NativeRequests>(dependencies.ipcMain, {
    [channels.copyToClipboard]: (_event, value) => {
      const content = clipboardContent(value);
      dependencies.clipboard.write(content);
    },
    [channels.ingestAttachments]: async (_event, value) => {
      const inputs = attachmentInputs(value, maxAttachmentBytes, maxTotalAttachmentBytes);
      if (inputs.length === 0) return [];
      const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-app-sdk-attachments-'));
      return Promise.all(inputs.map(async (input, index) => {
        const filePath = path.join(temporaryDirectory, `${index}-${safeFileName(input.name)}`);
        const data = Buffer.from(input.data);
        await fs.writeFile(filePath, data, { mode: 0o600 });
        return attachmentFromPath(filePath, {
          mimeType: input.mimeType ?? mimeTypeForPath(input.name),
          name: safeFileName(input.name),
          previewData: data,
        });
      }));
    },
    [channels.openExternal]: async (_event, value) => {
      await dependencies.shell.openExternal(externalHref(value));
    },
    [channels.pickAttachments]: async () => {
      const result = await dependencies.dialog.showOpenDialog({
        title: 'Add Files & Photos',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Files and photos', extensions: ['*'] },
        ],
      });
      if (result.canceled) return [];
      const attachments: CodexNativeAttachment[] = [];
      let totalBytes = 0;
      let previewBytes = 0;
      for (const filePath of result.filePaths) {
        const metadata = await fs.stat(filePath);
        if (!metadata.isFile()) throw new TypeError(`Attachment is not a file: ${filePath}`);
        if (metadata.size > maxAttachmentBytes) {
          throw new RangeError(`Attachment exceeds the ${maxAttachmentBytes} byte limit: ${filePath}`);
        }
        totalBytes += metadata.size;
        if (totalBytes > maxTotalAttachmentBytes) {
          throw new RangeError(`Attachments exceed the ${maxTotalAttachmentBytes} total byte limit`);
        }
        const mimeType = mimeTypeForPath(filePath);
        const previewData = mimeType.startsWith('image/')
          && mimeType !== 'image/svg+xml'
          && metadata.size <= maxPreviewBytes
          && previewBytes + metadata.size <= maxTotalPreviewBytes
          ? await fs.readFile(filePath)
          : undefined;
        if (previewData) previewBytes += previewData.byteLength;
        attachments.push(attachmentFromPath(filePath, {
          mimeType,
          name: path.basename(filePath),
          previewData,
          size: metadata.size,
        }));
      }
      return attachments;
    },
    [channels.readImagePreview]: async (_event, value) => {
      const filePath = absoluteLocalPath(value, 'Image preview path');
      const mimeType = mimeTypeForPath(filePath);
      if (!mimeType.startsWith('image/') || mimeType === 'image/svg+xml') return null;
      let metadata;
      try {
        metadata = await fs.stat(filePath);
      } catch (error) {
        if (isMissingFileError(error)) return null;
        throw error;
      }
      if (!metadata.isFile() || metadata.size > maxImagePreviewBytes) return null;
      const data = await fs.readFile(filePath);
      if (data.byteLength > maxImagePreviewBytes) return null;
      return `data:${mimeType};base64,${data.toString('base64')}`;
    },
    [channels.transcribeAudio]: async (_event, value, rawOptions) => {
      const audioData = arrayBuffer(value, 'Audio data');
      if (audioData.byteLength > maxAudioBytes) {
        throw new RangeError(`Audio data exceeds the ${maxAudioBytes} byte limit`);
      }
      const transcriptionOptions = appleSpeechOptions(rawOptions);
      const transcribe = options.transcribeAudio
        ?? ((data: Buffer, inputOptions?: AppleSpeechTranscriptionOptions) => (
          transcribeWithAppleSpeechAnalyzer(data, inputOptions, {
            ...(options.appleSpeechAssetsPath
              ? { assetsPath: options.appleSpeechAssetsPath }
              : {}),
          })
        ));
      return transcribe(Buffer.from(audioData), transcriptionOptions);
    },
  });

  return () => {
    unregister();
  };
}

function attachmentInputs(
  value: unknown,
  maxBytes: number,
  maxTotalBytes: number,
): CodexNativeAttachmentInput[] {
  if (!Array.isArray(value)) throw new TypeError('Attachments must be an array');
  if (value.length > 20) throw new RangeError('At most 20 attachments can be added at once');
  let totalBytes = 0;
  return value.map((entry) => {
    const record = objectRecord(entry, 'Attachment');
    const name = nonEmptyString(record.name, 'Attachment name');
    const data = arrayBuffer(record.data, 'Attachment data');
    if (data.byteLength > maxBytes) {
      throw new RangeError(`Attachment '${name}' exceeds the ${maxBytes} byte limit`);
    }
    totalBytes += data.byteLength;
    if (totalBytes > maxTotalBytes) {
      throw new RangeError(`Attachments exceed the ${maxTotalBytes} total byte limit`);
    }
    return {
      name,
      data,
      ...(record.mimeType === undefined
        ? {}
        : { mimeType: nonEmptyString(record.mimeType, 'Attachment MIME type') }),
    };
  });
}

function attachmentFromPath(
  filePath: string,
  metadata: {
    mimeType: string;
    name: string;
    previewData?: Uint8Array;
    size?: number;
  },
): CodexNativeAttachment {
  const size = metadata.size ?? metadata.previewData?.byteLength ?? 0;
  return {
    id: randomUUID(),
    type: metadata.mimeType.startsWith('image/') ? 'image' : 'file',
    path: filePath,
    name: metadata.name,
    mimeType: metadata.mimeType,
    size,
    ...(metadata.previewData
      && metadata.mimeType !== 'image/svg+xml'
      && metadata.previewData.byteLength <= maxPreviewBytes
      ? { previewUrl: `data:${metadata.mimeType};base64,${Buffer.from(metadata.previewData).toString('base64')}` }
      : {}),
  };
}

function clipboardContent(value: unknown): CodexNativeClipboardContent {
  const record = objectRecord(value, 'Clipboard content');
  const text = typeof record.text === 'string' ? record.text : invalid('Clipboard text must be a string');
  const html = record.html === undefined
    ? undefined
    : typeof record.html === 'string'
      ? record.html
      : invalid('Clipboard HTML must be a string');
  if (text.length > 5_000_000 || (html?.length ?? 0) > 10_000_000) {
    throw new RangeError('Clipboard content is too large');
  }
  return { text, ...(html ? { html } : {}) };
}

function externalHref(value: unknown): string {
  const href = nonEmptyString(value, 'External URL');
  const url = new URL(href);
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol.toLowerCase())) {
    throw new TypeError(`Unsupported external URL protocol: ${url.protocol}`);
  }
  return url.href;
}

function appleSpeechOptions(value: unknown): AppleSpeechTranscriptionOptions | undefined {
  if (value === undefined) return undefined;
  const record = objectRecord(value, 'Speech transcription options');
  if (record.live !== undefined && typeof record.live !== 'boolean') {
    throw new TypeError('Speech transcription live mode must be a boolean');
  }
  return {
    ...(record.locale === undefined
      ? {}
      : { locale: nonEmptyString(record.locale, 'Speech transcription locale') }),
    ...(record.live === undefined ? {} : { live: record.live }),
  };
}

function arrayBuffer(value: unknown, label: string): ArrayBuffer {
  if (!(value instanceof ArrayBuffer)) throw new TypeError(`${label} must be an ArrayBuffer`);
  return value;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function absoluteLocalPath(value: unknown, label: string): string {
  const filePath = nonEmptyString(value, label);
  if (!path.isAbsolute(filePath) || filePath.includes('\0')) {
    throw new TypeError(`${label} must be an absolute local path`);
  }
  return filePath;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function safeFileName(value: string): string {
  const name = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name || 'attachment';
}

function positiveByteLimit(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return ({
    avif: 'image/avif',
    bmp: 'image/bmp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
  } as Record<string, string>)[extension] ?? 'application/octet-stream';
}

function invalid(message: string): never {
  throw new TypeError(message);
}
