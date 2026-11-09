export type CodexSpeechTranscriptionResult = {
  text: string;
  error?: string;
};

/** Full replacement of the current transcript, not an append-only word delta. */
export type CodexSpeechTranscript = { finalText: string; partialText: string };
export type CodexSpeechPreparationOptions = { sessionId: string; locale?: string };
export type CodexSpeechSessionOptions = CodexSpeechPreparationOptions & { sampleRate: number };
/** Trusted-process session; PCM is delivered only after startup completes. */
export type CodexSpeechSession = {
  append(audio: ArrayBuffer): Promise<void>;
  stop(): Promise<CodexSpeechTranscriptionResult>;
  cancel(): Promise<void>;
};
/** Preparation owns resources until activation at the actual capture sample rate. */
export type CodexPreparedSpeechSession = {
  start(sampleRate: number): Promise<CodexSpeechSession>;
  cancel(): Promise<void>;
};
export type CodexSpeechSessionEvent =
  | ({ type: 'transcript'; sessionId: string } & CodexSpeechTranscript)
  | { type: 'error'; sessionId: string; error: string };

/** Mono Float32 little-endian PCM, sent once in capture order. Stop drains final results. */
export type CodexStreamingTranscription = {
  /** Optional connection preparation, safe to run concurrently with microphone setup. */
  prepare?(options: CodexSpeechPreparationOptions): Promise<void>;
  start(options: CodexSpeechSessionOptions): Promise<void>;
  append(sessionId: string, audio: ArrayBuffer): Promise<void>;
  stop(sessionId: string): Promise<CodexSpeechTranscriptionResult>;
  cancel(sessionId: string): Promise<void>;
  onEvent(listener: (event: CodexSpeechSessionEvent) => void): () => void;
};

/** Renderer-safe attachment metadata. `reference` is an opaque host capability, never a filesystem path. */
export type CodexHostAttachment = {
  id: string;
  type: 'file' | 'image';
  reference: string;
  name: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
};

export type CodexHostAttachmentInput = {
  name: string;
  mimeType?: string;
  data: ArrayBuffer;
};

/** @deprecated Use the platform-neutral `CodexHostAttachment` name. */
export type CodexNativeAttachment = CodexHostAttachment;
/** @deprecated Use the platform-neutral `CodexHostAttachmentInput` name. */
export type CodexNativeAttachmentInput = CodexHostAttachmentInput;

export type CodexNativeClipboardContent = {
  text: string;
  html?: string;
};

export type CodexHostCapabilities = {
  /** Absent when only batch transcription is available. */
  streamingTranscription?: CodexStreamingTranscription;
  capabilities: {
    attachments: boolean;
    clipboard: boolean;
    externalLinks: boolean;
    transcription: boolean;
  };
  copyToClipboard(content: CodexNativeClipboardContent): Promise<void>;
  ingestAttachments(files: readonly CodexHostAttachmentInput[]): Promise<CodexHostAttachment[]>;
  openExternal(href: string): Promise<void>;
  pickAttachments(): Promise<CodexHostAttachment[]>;
  readImagePreview?(reference: string): Promise<string | null>;
  transcribeAudio(
    audioData: ArrayBuffer,
    options?: { locale?: string; live?: boolean },
  ): Promise<CodexSpeechTranscriptionResult>;
};

/** @deprecated Use the platform-neutral `CodexHostCapabilities` name. */
export type CodexNativeRendererApi = CodexHostCapabilities;

export const codexNativeRendererGlobal = 'codexAppSdkNative';
