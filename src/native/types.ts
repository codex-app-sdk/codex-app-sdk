export type CodexSpeechTranscriptionResult = {
  text: string;
  error?: string;
};

export type CodexNativeAttachment = {
  id: string;
  type: 'file' | 'image';
  path: string;
  name: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
};

export type CodexNativeAttachmentInput = {
  name: string;
  mimeType?: string;
  data: ArrayBuffer;
};

export type CodexNativeClipboardContent = {
  text: string;
  html?: string;
};

export type CodexNativeRendererApi = {
  capabilities: {
    attachments: boolean;
    clipboard: boolean;
    externalLinks: boolean;
    transcription: boolean;
  };
  copyToClipboard(content: CodexNativeClipboardContent): Promise<void>;
  ingestAttachments(files: readonly CodexNativeAttachmentInput[]): Promise<CodexNativeAttachment[]>;
  openExternal(href: string): Promise<void>;
  pickAttachments(): Promise<CodexNativeAttachment[]>;
  transcribeAudio(
    audioData: ArrayBuffer,
    options?: { locale?: string; live?: boolean },
  ): Promise<CodexSpeechTranscriptionResult>;
};

export const codexNativeRendererGlobal = 'codexAppSdkNative';
