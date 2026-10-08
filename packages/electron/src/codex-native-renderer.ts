import type {
  CodexNativeAttachment,
  CodexNativeAttachmentInput,
  CodexNativeClipboardContent,
  CodexNativeRendererApi,
  CodexSpeechTranscriptionResult,
  CodexSpeechSessionOptions,
  CodexSpeechSessionEvent,
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
  startSpeech: 'codex-native:start-speech',
  appendSpeech: 'codex-native:append-speech',
  stopSpeech: 'codex-native:stop-speech',
  cancelSpeech: 'codex-native:cancel-speech',
} as const;
export const codexSpeechEventChannel = 'codex-native:speech-event';

export type CodexNativeRequests = {
  [codexNativeChannels.startSpeech]: IpcRequest<[options: CodexSpeechSessionOptions], void>;
  [codexNativeChannels.appendSpeech]: IpcRequest<[sessionId: string, audio: ArrayBuffer], void>;
  [codexNativeChannels.stopSpeech]: IpcRequest<[sessionId: string], CodexSpeechTranscriptionResult>;
  [codexNativeChannels.cancelSpeech]: IpcRequest<[sessionId: string], void>;
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
  options: { transcription?: boolean; streamingTranscription?: boolean } = {},
): CodexNativeRendererApi {
  const renderer = new TypedIpcRenderer<CodexNativeRequests, { [codexSpeechEventChannel]: CodexSpeechSessionEvent }>(port);
  const transcription = options.transcription ?? process.platform === 'darwin';
  return {
    capabilities: {
      attachments: true,
      clipboard: true,
      externalLinks: true,
      transcription,
    },
    ...(transcription && (options.streamingTranscription ?? process.platform === 'darwin') ? {
      streamingTranscription: {
        start: (input: CodexSpeechSessionOptions) => renderer.invoke(codexNativeChannels.startSpeech, input),
        append: (id: string, audio: ArrayBuffer) => renderer.invoke(codexNativeChannels.appendSpeech, id, audio),
        stop: (id: string) => renderer.invoke(codexNativeChannels.stopSpeech, id),
        cancel: (id: string) => renderer.invoke(codexNativeChannels.cancelSpeech, id),
        onEvent: (listener: (event: CodexSpeechSessionEvent) => void) => renderer.on(codexSpeechEventChannel, listener),
      },
    } : {}),
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
  options?: { transcription?: boolean; streamingTranscription?: boolean },
): CodexNativeRendererApi {
  const api = createCodexNativeRendererApi(port, options);
  contextBridge.exposeInMainWorld('codexAppSdkNative', api);
  return api;
}
