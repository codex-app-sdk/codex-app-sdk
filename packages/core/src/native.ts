export type CodexSpeechTranscriptionResult = {
  text: string;
  error?: string;
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
