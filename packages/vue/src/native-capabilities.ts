import type {
  CodexHostCapabilities,
  CodexNativeAttachment,
  CodexNativeAttachmentInput,
  CodexNativeRendererApi,
} from '@codex-app-sdk/core/native';
import {
  hasInjectionContext,
  inject,
  provide,
  type InjectionKey,
} from 'vue';

type CodexNativeWindow = Window & {
  codexAppSdkNative?: CodexNativeRendererApi;
};

const hostCapabilitiesKey: InjectionKey<CodexHostCapabilities | undefined> = Symbol(
  'codex-app-sdk-host-capabilities',
);

export type CodexAttachmentPicker = () => Promise<CodexNativeAttachment[]>;
export type CodexAttachmentIngester = (
  files: readonly CodexNativeAttachmentInput[],
) => Promise<CodexNativeAttachment[]>;

export function provideCodexHostCapabilities(
  capabilities: CodexHostCapabilities | undefined,
): CodexHostCapabilities | undefined {
  provide(hostCapabilitiesKey, capabilities);
  return capabilities;
}

export function useCodexHostCapabilities(): CodexHostCapabilities | undefined {
  const fallback = getCodexGlobalHostCapabilities();
  return hasInjectionContext() ? inject(hostCapabilitiesKey, fallback) : fallback;
}

export function getCodexGlobalHostCapabilities(): CodexHostCapabilities | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as CodexNativeWindow).codexAppSdkNative;
}

/** @deprecated Use `getCodexGlobalHostCapabilities` or the scoped provider. */
export function getCodexNativeRendererApi(): CodexNativeRendererApi | undefined {
  return getCodexGlobalHostCapabilities();
}

export async function pickCodexAttachments(
  override?: CodexAttachmentPicker,
  capabilities: CodexHostCapabilities | undefined = getCodexGlobalHostCapabilities(),
): Promise<CodexNativeAttachment[]> {
  const pick = override ?? capabilities?.pickAttachments;
  return pick ? pick() : [];
}

export async function ingestCodexAttachments(
  files: readonly File[],
  override?: CodexAttachmentIngester,
  capabilities: CodexHostCapabilities | undefined = getCodexGlobalHostCapabilities(),
): Promise<CodexNativeAttachment[]> {
  if (files.length === 0) return [];
  const ingest = override ?? capabilities?.ingestAttachments;
  if (!ingest) return [];

  const inputs = await Promise.all(files.map(async (file) => ({
    name: file.name,
    ...(file.type ? { mimeType: file.type } : {}),
    data: await file.arrayBuffer(),
  })));
  return ingest(inputs);
}
