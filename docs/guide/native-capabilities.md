# Native capabilities

The SDK includes the common native behavior a serious conversation composer
needs. Applications should not reimplement these in each sample.

## Capability API

Electron exposes `window.codexAppSdkNative`; other hosts can inject the same
platform-neutral `CodexHostCapabilities` contract into the Vue tree:

```ts
type CodexHostCapabilities = {
  capabilities: {
    attachments: boolean;
    clipboard: boolean;
    externalLinks: boolean;
    transcription: boolean;
  };
  pickAttachments(): Promise<CodexHostAttachment[]>;
  ingestAttachments(files: readonly CodexHostAttachmentInput[]): Promise<CodexHostAttachment[]>;
  readImagePreview?(reference: string): Promise<string | null>;
  copyToClipboard(content: CodexNativeClipboardContent): Promise<void>;
  openExternal(href: string): Promise<void>;
  transcribeAudio(audio: ArrayBuffer, options?: { locale?: string; live?: boolean }): Promise<CodexSpeechTranscriptionResult>;
};
```

## Native picker

`pickAttachments()` uses Electron's open-file dialog, validates every selected
file, enforces per-file and total limits, and creates image previews when safe.

The defaults are:

- 25 MiB per attachment;
- 100 MiB total per picker/ingestion call;
- at most 20 ingested attachments;
- bounded image preview generation;
- SVG files never become data-URL previews.

Override limits in the main-process `native` options.

## Paste and drag/drop

Browser `File` objects cannot be sent as trusted filesystem paths. The Vue
ingestion helper transfers their bytes through validated IPC, writes them to a
private temporary directory, and returns serializable attachment records.

Those records contain an opaque `reference`, never the trusted local path.
Electron resolves the reference inside its integration-scoped registry only
when a surface action is invoked. Web hosts use the same boundary with their own
authenticated upload endpoint and lease-owned resolver.

Pasted files live in the operating system's temporary directory so app-server's
historical `localImage` paths remain usable across an application restart. The
operating system eventually reclaims those files.

The stock conversation pane wires both image paste and drag/drop.

Optimistic image messages carry a bounded data preview through the renderer-safe
surface contract. If app-server history later rematerializes the same attachment
as a local path, the SDK preserves that preview. After a restart,
`ChatAttachmentBlock` lazily asks the native bridge for a bounded image-only data
preview instead of navigating the renderer to a blocked `file://` URL. Missing,
oversized, unsupported, or already-reclaimed files remain file chips.

## Clipboard

Message copy actions send bounded text/HTML payloads to Electron's clipboard.
The renderer never receives a raw Electron clipboard object.

## External links

The native bridge accepts only supported protocols (`http`, `https`, `mailto`,
and `tel`) before calling `shell.openExternal`. Products that need a hostname
allowlist should enforce it in their own navigation policy as well.

## Speech transcription

On supported macOS hosts, the default bridge uses the packaged Apple
SpeechAnalyzer helper. The composer records browser audio, fixes WebM duration,
and replaces the recording state with the transcription result.

Provide a custom main-process transcription implementation when another
platform or provider is required:

```ts
registerCodexElectronMain({
  // ...standard dependencies
  native: {
    transcribeAudio: async (audio, options) => {
      return myTranscriber(audio, options);
    },
  },
});
```

Presentation controls can omit the voice control entirely when transcription
is unavailable or inappropriate for the product.
