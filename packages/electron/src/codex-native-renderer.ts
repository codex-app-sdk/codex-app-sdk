import type {
  CodexNativeAttachment,
  CodexNativeAttachmentInput,
  CodexNativeClipboardContent,
  CodexNativeRendererApi,
  CodexSpeechTranscriptionResult,
} from '@codex-app-sdk/core/native';
import {
  TypedIpcRenderer,
  type IpcRendererPort,
  type IpcRequest,
} from './typed-ipc';

export const codexNativeChannels = {
  copyToClipboard: 'codex-native:copy-to-clipboard',
  ingestAttachments: 'codex-native:ingest-attachments',
  openExternal: 'codex-native:open-external',
  pickAttachments: 'codex-native:pick-attachments',
  readImagePreview: 'codex-native:read-image-preview',
  transcribeAudio: 'codex-native:transcribe-audio',
} as const;

export type CodexNativeRequests = {
  [codexNativeChannels.copyToClipboard]: IpcRequest<[content: CodexNativeClipboardContent], void>;
  [codexNativeChannels.ingestAttachments]: IpcRequest<[
    files: readonly CodexNativeAttachmentInput[],
  ], CodexNativeAttachment[]>;
  [codexNativeChannels.openExternal]: IpcRequest<[href: string], void>;
  [codexNativeChannels.pickAttachments]: IpcRequest<[], CodexNativeAttachment[]>;
  [codexNativeChannels.readImagePreview]: IpcRequest<[path: string], string | null>;
  [codexNativeChannels.transcribeAudio]: IpcRequest<[
    audioData: ArrayBuffer,
    options?: { locale?: string; live?: boolean },
  ], CodexSpeechTranscriptionResult>;
};

export type CodexContextBridge = {
  exposeInMainWorld(key: string, api: unknown): void;
};

export function createCodexNativeRendererApi(
  port: IpcRendererPort,
  options: { transcription?: boolean } = {},
): CodexNativeRendererApi {
  const renderer = new TypedIpcRenderer<CodexNativeRequests, object>(port);
  return {
    capabilities: {
      attachments: true,
      clipboard: true,
      externalLinks: true,
      transcription: options.transcription ?? process.platform === 'darwin',
    },
    copyToClipboard: (content) => renderer.invoke(codexNativeChannels.copyToClipboard, content),
    ingestAttachments: (files) => renderer.invoke(codexNativeChannels.ingestAttachments, files),
    openExternal: (href) => renderer.invoke(codexNativeChannels.openExternal, href),
    pickAttachments: () => renderer.invoke(codexNativeChannels.pickAttachments),
    readImagePreview: (path) => renderer.invoke(codexNativeChannels.readImagePreview, path),
    transcribeAudio: (audioData, transcriptionOptions) => (
      renderer.invoke(codexNativeChannels.transcribeAudio, audioData, transcriptionOptions)
    ),
  };
}

export function exposeCodexNativeRendererApi(
  contextBridge: CodexContextBridge,
  port: IpcRendererPort,
  options?: { transcription?: boolean },
): CodexNativeRendererApi {
  const api = createCodexNativeRendererApi(port, options);
  contextBridge.exposeInMainWorld('codexAppSdkNative', api);
  return api;
}
