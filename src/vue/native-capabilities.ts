import type {
  CodexNativeAttachment,
  CodexNativeAttachmentInput,
  CodexNativeRendererApi,
} from '../native/types';

type CodexNativeWindow = Window & {
  codexAppSdkNative?: CodexNativeRendererApi;
};

export type CodexAttachmentPicker = () => Promise<CodexNativeAttachment[]>;
export type CodexAttachmentIngester = (
  files: readonly CodexNativeAttachmentInput[],
) => Promise<CodexNativeAttachment[]>;

export function getCodexNativeRendererApi(): CodexNativeRendererApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as CodexNativeWindow).codexAppSdkNative;
}

export async function pickCodexAttachments(
  override?: CodexAttachmentPicker,
): Promise<CodexNativeAttachment[]> {
  const pick = override ?? getCodexNativeRendererApi()?.pickAttachments;
  return pick ? pick() : [];
}

export async function ingestCodexAttachments(
  files: readonly File[],
  override?: CodexAttachmentIngester,
): Promise<CodexNativeAttachment[]> {
  if (files.length === 0) return [];
  const ingest = override ?? getCodexNativeRendererApi()?.ingestAttachments;
  if (!ingest) return [];

  const inputs = await Promise.all(files.map(async (file) => ({
    name: file.name,
    ...(file.type ? { mimeType: file.type } : {}),
    data: await file.arrayBuffer(),
  })));
  return ingest(inputs);
}
