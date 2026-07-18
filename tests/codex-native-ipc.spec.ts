import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerCodexNativeIpc,
  type IpcMainPort,
  type IpcRendererPort,
} from '../src/electron';
import {
  createCodexNativeRendererApi,
  exposeCodexNativeRendererApi,
  TypedIpcRenderer,
} from '../src/electron/preload';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('Codex native Electron bridge', () => {
  it('owns picker, clipboard, safe external links, ingestion, and transcription handlers', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-native-ipc-test-'));
    temporaryDirectories.push(directory);
    const imagePath = path.join(directory, 'diagram.png');
    await writeFile(imagePath, Buffer.from('png'));
    const main = new FakeMainPort();
    const clipboard = { write: vi.fn() };
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [imagePath] })),
    };
    const shell = { openExternal: vi.fn(async () => undefined) };
    const transcribeAudio = vi.fn(async () => ({ text: 'dictated prompt' }));

    const dispose = registerCodexNativeIpc({ clipboard, dialog, ipcMain: main, shell }, {
      transcribeAudio,
    });

    expect([...main.handlers.keys()].sort()).toStrictEqual([
      'codex-native:copy-to-clipboard',
      'codex-native:ingest-attachments',
      'codex-native:open-external',
      'codex-native:pick-attachments',
      'codex-native:transcribe-audio',
    ]);
    const picked = await main.call('codex-native:pick-attachments') as Array<Record<string, unknown>>;
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({
      type: 'image',
      path: imagePath,
      name: 'diagram.png',
      mimeType: 'image/png',
      size: 3,
    });
    expect(picked[0]?.previewUrl).toBe('data:image/png;base64,cG5n');

    await main.call('codex-native:copy-to-clipboard', { text: 'Done', html: '<p>Done</p>' });
    expect(clipboard.write).toHaveBeenCalledWith({ text: 'Done', html: '<p>Done</p>' });

    await main.call('codex-native:open-external', 'https://example.com/docs');
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/docs');
    await expect(main.call('codex-native:open-external', 'javascript:alert(1)')).rejects.toThrow(
      'Unsupported external URL protocol',
    );

    const attachmentData = new TextEncoder().encode('notes').buffer;
    const ingested = await main.call('codex-native:ingest-attachments', [{
      name: '../notes.md',
      mimeType: 'text/markdown',
      data: attachmentData,
    }]) as Array<Record<string, unknown>>;
    expect(ingested).toHaveLength(1);
    expect(ingested[0]).toMatchObject({
      type: 'file',
      name: 'notes.md',
      mimeType: 'text/markdown',
      size: 5,
    });
    expect(path.basename(ingested[0]?.path as string)).toBe('0-notes.md');

    const audioData = new TextEncoder().encode('audio').buffer;
    await expect(main.call('codex-native:transcribe-audio', audioData, { locale: 'en-US' })).resolves.toStrictEqual({
      text: 'dictated prompt',
    });
    expect(transcribeAudio).toHaveBeenCalledWith(Buffer.from(audioData), { locale: 'en-US' });

    dispose();
    expect(main.handlers.size).toBe(0);
  });

  it('creates and exposes a typed preload API', async () => {
    expect(TypedIpcRenderer).toBeDefined();
    const port = new FakeRendererPort();
    const api = createCodexNativeRendererApi(port);
    expect(api.capabilities.attachments).toBe(true);
    expect(createCodexNativeRendererApi(port, { transcription: false }).capabilities.transcription).toBe(false);
    await api.pickAttachments();
    await api.copyToClipboard({ text: 'Copied' });
    await api.openExternal('https://example.com');

    expect(port.invoke).toHaveBeenNthCalledWith(1, 'codex-native:pick-attachments');
    expect(port.invoke).toHaveBeenNthCalledWith(2, 'codex-native:copy-to-clipboard', { text: 'Copied' });
    expect(port.invoke).toHaveBeenNthCalledWith(3, 'codex-native:open-external', 'https://example.com');

    const contextBridge = { exposeInMainWorld: vi.fn() };
    const exposed = exposeCodexNativeRendererApi(contextBridge, port);
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith('codexAppSdkNative', exposed);
  });

  it('rejects oversized, malformed, and executable renderer payloads', async () => {
    const main = new FakeMainPort();
    const dispose = registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      ipcMain: main,
      shell: { openExternal: vi.fn(async () => undefined) },
    }, {
      maxAttachmentBytes: 2,
      maxTotalAttachmentBytes: 3,
      maxAudioBytes: 2,
      transcribeAudio: vi.fn(async () => ({ text: '' })),
    });

    await expect(main.call('codex-native:ingest-attachments', [{
      name: 'large.txt', data: new Uint8Array([1, 2, 3]).buffer,
    }])).rejects.toThrow('exceeds the 2 byte limit');
    await expect(main.call('codex-native:ingest-attachments', [
      { name: 'one.txt', data: new Uint8Array([1, 2]).buffer },
      { name: 'two.txt', data: new Uint8Array([3, 4]).buffer },
    ])).rejects.toThrow('exceed the 3 total byte limit');
    await expect(main.call('codex-native:transcribe-audio', new Uint8Array([1, 2, 3]).buffer)).rejects.toThrow(
      'exceeds the 2 byte limit',
    );
    await expect(main.call('codex-native:copy-to-clipboard', { text: 42 })).rejects.toThrow(
      'Clipboard text must be a string',
    );
    dispose();
  });
});

class FakeMainPort implements IpcMainPort {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, handler);
  }
  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }
  async call(channel: string, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`Missing handler: ${channel}`);
    return handler({}, ...args);
  }
}

class FakeRendererPort implements IpcRendererPort {
  readonly invoke = vi.fn(async () => []);
  on(): void {}
  off(): void {}
}
