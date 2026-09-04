import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CodexElectronAttachmentRegistry,
  registerCodexNativeIpc,
  type IpcMainPort,
  type IpcRendererPort,
} from '../src';
import {
  createCodexNativeRendererApi,
  exposeCodexNativeRendererApi,
  TypedIpcRenderer,
} from '../src/preload';

const backendMocks = vi.hoisted(() => ({
  transcribeWithAppleSpeechAnalyzer: vi.fn(async () => ({ text: 'native transcript' })),
}));

vi.mock('@codex-app-sdk/backend', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  transcribeWithAppleSpeechAnalyzer: backendMocks.transcribeWithAppleSpeechAnalyzer,
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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
    const attachments = new CodexElectronAttachmentRegistry();

    const dispose = registerCodexNativeIpc({ clipboard, dialog, ipcMain: main, shell }, {
      transcribeAudio,
    }, attachments);

    expect([...main.handlers.keys()].sort()).toStrictEqual([
      'codex-native:copy-to-clipboard',
      'codex-native:ingest-attachments',
      'codex-native:open-external',
      'codex-native:pick-attachments',
      'codex-native:read-image-preview',
      'codex-native:transcribe-audio',
    ]);
    const picked = await main.call('codex-native:pick-attachments') as Array<Record<string, unknown>>;
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({
      type: 'image',
      name: 'diagram.png',
      mimeType: 'image/png',
      size: 3,
    });
    expect(picked[0]?.previewUrl).toBe('data:image/png;base64,cG5n');
    expect(picked[0]).not.toHaveProperty('path');
    expect(picked[0]?.reference).toMatch(/^electron-attachment:/);
    expect(attachments.resolve({
      type: 'image', reference: picked[0]?.reference as string,
    })).toMatchObject({
      type: 'image',
      path: imagePath,
      previewUrl: 'data:image/png;base64,cG5n',
    });

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
    const ingestedPath = attachments.resolve({
      type: 'file',
      reference: ingested[0]?.reference as string,
    }).path;
    expect(path.basename(ingestedPath)).toBe('0-notes.md');
    temporaryDirectories.push(path.dirname(ingestedPath));

    await expect(main.call('codex-native:read-image-preview', picked[0]?.reference)).resolves.toBe(
      'data:image/png;base64,cG5n',
    );
    await expect(main.call('codex-native:read-image-preview', 'attachment:missing')).rejects.toThrow(
      'Attachment reference is invalid or expired',
    );

    const audioData = new TextEncoder().encode('audio').buffer;
    await expect(main.call('codex-native:transcribe-audio', audioData, { locale: 'en-US' })).resolves.toStrictEqual({
      text: 'dictated prompt',
    });
    expect(transcribeAudio).toHaveBeenCalledWith(Buffer.from(audioData), { locale: 'en-US' });

    dispose();
    expect(main.handlers.size).toBe(0);
    expect(() => attachments.resolve({
      type: 'file', reference: ingested[0]?.reference as string,
    })).toThrow('Attachment reference is invalid or expired');
    await expect(access(ingestedPath)).resolves.toBeUndefined();
  });

  it('restores previews for SDK-ingested images after the attachment registry resets', async () => {
    const main = new FakeMainPort();
    const attachments = new CodexElectronAttachmentRegistry();
    const dispose = registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      ipcMain: main,
      shell: { openExternal: vi.fn(async () => undefined) },
    }, {}, attachments);
    const [ingested] = await main.call('codex-native:ingest-attachments', [{
      name: 'pasted.png',
      mimeType: 'image/png',
      data: new TextEncoder().encode('png').buffer,
    }]) as Array<Record<string, unknown>>;
    const ingestedPath = attachments.resolve({
      type: 'image', reference: ingested?.reference as string,
    }).path;

    attachments.clear();

    await expect(main.call('codex-native:read-image-preview', ingestedPath)).resolves.toBe(
      'data:image/png;base64,cG5n',
    );
    await expect(main.call('codex-native:read-image-preview', path.join(os.tmpdir(), 'private.png')))
      .rejects.toThrow('Attachment reference is invalid or expired');
    dispose();
  });

  it('creates and exposes a typed preload API', async () => {
    expect(TypedIpcRenderer).toBeDefined();
    const port = new FakeRendererPort();
    const api = createCodexNativeRendererApi(port, { transcription: true });
    expect(api.capabilities).toStrictEqual({
      attachments: true,
      clipboard: true,
      externalLinks: true,
      transcription: true,
    });
    expect(createCodexNativeRendererApi(port, { transcription: false }).capabilities.transcription).toBe(false);
    await api.pickAttachments();
    await api.copyToClipboard({ text: 'Copied' });
    await api.ingestAttachments([{ name: 'notes.txt', data: new ArrayBuffer(1) }]);
    await api.openExternal('https://example.com');
    await api.readImagePreview?.('attachment:diagram');
    const audio = new ArrayBuffer(2);
    await api.transcribeAudio?.(audio, { locale: 'fr-FR', live: true });

    expect(port.invoke).toHaveBeenNthCalledWith(1, 'codex-native:pick-attachments');
    expect(port.invoke).toHaveBeenNthCalledWith(2, 'codex-native:copy-to-clipboard', { text: 'Copied' });
    expect(port.invoke).toHaveBeenNthCalledWith(3, 'codex-native:ingest-attachments', [{
      name: 'notes.txt', data: expect.any(ArrayBuffer),
    }]);
    expect(port.invoke).toHaveBeenNthCalledWith(4, 'codex-native:open-external', 'https://example.com');
    expect(port.invoke).toHaveBeenNthCalledWith(5, 'codex-native:read-image-preview', 'attachment:diagram');
    expect(port.invoke).toHaveBeenNthCalledWith(
      6,
      'codex-native:transcribe-audio',
      audio,
      { locale: 'fr-FR', live: true },
    );

    const contextBridge = { exposeInMainWorld: vi.fn() };
    const exposed = exposeCodexNativeRendererApi(contextBridge, port);
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith('codexAppSdkNative', exposed);
  });

  it('lets an explicit transcription capability override a non-macOS platform default', () => {
    const originalProcess = globalThis.process;
    vi.stubGlobal('process', { ...originalProcess, platform: 'linux' });
    try {
      const port = new FakeRendererPort();
      expect(createCodexNativeRendererApi(port).capabilities.transcription).toBe(false);
      expect(createCodexNativeRendererApi(port, { transcription: true }).capabilities.transcription).toBe(true);
      vi.stubGlobal('process', { ...originalProcess, platform: 'darwin' });
      expect(createCodexNativeRendererApi(port).capabilities.transcription).toBe(true);
      expect(createCodexNativeRendererApi(port, { transcription: false }).capabilities.transcription).toBe(false);
    } finally {
      vi.stubGlobal('process', originalProcess);
    }
  });

  it('preserves the documented default byte limits and preview budgets', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-native-default-limits-'));
    temporaryDirectories.push(directory);
    const firstImage = path.join(directory, 'first.png');
    const secondImage = path.join(directory, 'second.png');
    await Promise.all([
      writeFile(firstImage, Buffer.alloc(9 * 1024, 1)),
      writeFile(secondImage, Buffer.alloc(9 * 1024, 2)),
    ]);
    const main = new FakeMainPort();
    const attachments = new CodexElectronAttachmentRegistry();
    const transcribeAudio = vi.fn(async () => ({ text: 'ok' }));
    const dispose = registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog: { showOpenDialog: vi.fn(async () => ({
        canceled: false,
        filePaths: [firstImage, secondImage],
      })) },
      ipcMain: main,
      shell: { openExternal: vi.fn(async () => undefined) },
    }, { transcribeAudio }, attachments);

    const [single] = await main.call('codex-native:ingest-attachments', [{
      name: '26kb.txt', data: new ArrayBuffer(26 * 1024),
    }]) as Array<Record<string, unknown>>;
    const singlePath = attachments.path(single?.reference as string);
    temporaryDirectories.push(path.dirname(singlePath));

    const batch = Array.from({ length: 5 }, (_, index) => ({
      name: `${index}.txt`, data: new ArrayBuffer(21 * 1024),
    }));
    const ingestedBatch = await main.call('codex-native:ingest-attachments', batch) as Array<Record<string, unknown>>;
    temporaryDirectories.push(path.dirname(attachments.path(ingestedBatch[0]?.reference as string)));
    expect(ingestedBatch).toHaveLength(5);

    await expect(main.call('codex-native:transcribe-audio', new ArrayBuffer(26 * 1024))).resolves.toStrictEqual({
      text: 'ok',
    });
    const picked = await main.call('codex-native:pick-attachments') as Array<Record<string, unknown>>;
    expect(picked).toHaveLength(2);
    expect(picked.every((attachment) => typeof attachment.previewUrl === 'string')).toBe(true);
    dispose();
  });

  it('enforces picker cancellation, file, and aggregate-size boundaries', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-native-picker-'));
    temporaryDirectories.push(directory);
    const exactPath = path.join(directory, 'exact.txt');
    const smallPath = path.join(directory, 'small.txt');
    const oversizedPath = path.join(directory, 'oversized.txt');
    await Promise.all([
      writeFile(exactPath, Buffer.alloc(3)),
      writeFile(smallPath, Buffer.alloc(2)),
      writeFile(oversizedPath, Buffer.alloc(4)),
    ]);
    const dialog = { showOpenDialog: vi.fn() };
    dialog.showOpenDialog
      .mockResolvedValueOnce({ canceled: true, filePaths: [exactPath] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [directory] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [exactPath] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [oversizedPath] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [smallPath, exactPath] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [exactPath, exactPath] });
    const main = new FakeMainPort();
    const dispose = registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog,
      ipcMain: main,
      shell: { openExternal: vi.fn(async () => undefined) },
    }, { maxAttachmentBytes: 3, maxTotalAttachmentBytes: 5 });

    await expect(main.call('codex-native:pick-attachments')).resolves.toStrictEqual([]);
    expect(dialog.showOpenDialog).toHaveBeenNthCalledWith(1, {
      title: 'Add Files & Photos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Files and photos', extensions: ['*'] }],
    });
    await expect(main.call('codex-native:pick-attachments')).resolves.toStrictEqual([]);
    await expect(main.call('codex-native:pick-attachments')).rejects.toThrow(
      `Attachment is not a file: ${directory}`,
    );
    await expect(main.call('codex-native:pick-attachments')).resolves.toEqual([
      expect.objectContaining({ name: 'exact.txt', size: 3, type: 'file' }),
    ]);
    await expect(main.call('codex-native:pick-attachments')).rejects.toThrow(
      `Attachment exceeds the 3 byte limit: ${oversizedPath}`,
    );
    await expect(main.call('codex-native:pick-attachments')).resolves.toEqual([
      expect.objectContaining({ name: 'small.txt', size: 2 }),
      expect.objectContaining({ name: 'exact.txt', size: 3 }),
    ]);
    await expect(main.call('codex-native:pick-attachments')).rejects.toThrow(
      'Attachments exceed the 5 total byte limit',
    );
    dispose();
  });

  it('enforces raster type and cumulative preview budgets before reading files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-native-preview-budget-'));
    temporaryDirectories.push(directory);
    const firstImage = path.join(directory, 'first.png');
    const secondImage = path.join(directory, 'second.png');
    const thirdImage = path.join(directory, 'third.png');
    const oversizedImage = path.join(directory, 'oversized.png');
    const textPath = path.join(directory, 'notes.txt');
    const svgPath = path.join(directory, 'vector.svg');
    await Promise.all([
      writeFile(firstImage, Buffer.alloc(8 * 1024 * 1024)),
      writeFile(secondImage, Buffer.alloc(8 * 1024 * 1024)),
      writeFile(thirdImage, Buffer.from('x')),
      writeFile(oversizedImage, Buffer.alloc((8 * 1024 * 1024) + 1)),
      writeFile(textPath, Buffer.from('x')),
      writeFile(svgPath, Buffer.from('x')),
    ]);
    await Promise.all([chmod(oversizedImage, 0), chmod(textPath, 0), chmod(svgPath, 0)]);
    const main = new FakeMainPort();
    const dispose = registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog: { showOpenDialog: vi.fn(async () => ({
        canceled: false,
        filePaths: [oversizedImage, textPath, svgPath, firstImage, secondImage, thirdImage],
      })) },
      ipcMain: main,
      shell: { openExternal: vi.fn(async () => undefined) },
    });

    const picked = await main.call('codex-native:pick-attachments') as Array<Record<string, unknown>>;
    expect(picked).toHaveLength(6);
    expect(picked[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(picked[0]).not.toHaveProperty('previewUrl');
    expect(picked[1]).toMatchObject({ type: 'file', mimeType: 'application/octet-stream' });
    expect(picked[1]).not.toHaveProperty('previewUrl');
    expect(picked[2]).toMatchObject({ type: 'image', mimeType: 'image/svg+xml' });
    expect(picked[2]).not.toHaveProperty('previewUrl');
    expect(picked[3]?.previewUrl).toEqual(expect.stringMatching(/^data:image\/png;base64,/));
    expect(picked[4]?.previewUrl).toEqual(expect.stringMatching(/^data:image\/png;base64,/));
    expect(picked[5]).not.toHaveProperty('previewUrl');
    dispose();
  });

  it('reads only bounded raster previews from managed temporary directories', async () => {
    const directory = path.join(os.tmpdir(), `codex-app-sdk-attachments-contract-${process.pid}-1`);
    await mkdir(directory);
    temporaryDirectories.push(directory);
    const exactPath = path.join(directory, 'exact.png');
    const oversizedPath = path.join(directory, 'oversized.png');
    const svgPath = path.join(directory, 'vector.svg');
    const textPath = path.join(directory, 'notes.txt');
    const directoryPath = path.join(directory, 'folder.png');
    await Promise.all([
      writeFile(exactPath, Buffer.from('png')),
      writeFile(oversizedPath, Buffer.from('large')),
      writeFile(svgPath, Buffer.from('x')),
      writeFile(textPath, Buffer.from('x')),
      mkdir(directoryPath),
    ]);
    const main = new FakeMainPort();
    const dispose = registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      ipcMain: main,
      shell: { openExternal: vi.fn(async () => undefined) },
    }, { maxImagePreviewBytes: 3 });

    await expect(main.call('codex-native:read-image-preview', exactPath)).resolves.toBe(
      'data:image/png;base64,cG5n',
    );
    await expect(main.call('codex-native:read-image-preview', oversizedPath)).resolves.toBeNull();
    await expect(main.call('codex-native:read-image-preview', svgPath)).resolves.toBeNull();
    await expect(main.call('codex-native:read-image-preview', textPath)).resolves.toBeNull();
    await expect(main.call('codex-native:read-image-preview', directoryPath)).resolves.toBeNull();
    await expect(main.call('codex-native:read-image-preview', path.join(directory, 'missing.png')))
      .resolves.toBeNull();
    await expect(main.call(
      'codex-native:read-image-preview',
      path.join(directory, `${'x'.repeat(1_024)}.png`),
    )).rejects.toMatchObject({ code: 'ENAMETOOLONG' });
    await expect(main.call(
      'codex-native:read-image-preview',
      path.join(os.tmpdir(), 'x-codex-app-sdk-attachments-contract-1', 'image.png'),
    )).rejects.toThrow('Attachment reference is invalid or expired');
    await expect(main.call(
      'codex-native:read-image-preview',
      path.join(os.tmpdir(), 'codex-app-sdk-attachments-contract-1.evil', 'image.png'),
    )).rejects.toThrow('Attachment reference is invalid or expired');
    await expect(main.call(
      'codex-native:read-image-preview',
      path.join(process.cwd(), 'codex-app-sdk-attachments-contract-1', 'image.png'),
    )).rejects.toThrow('Attachment reference is invalid or expired');
    await expect(main.call(
      'codex-native:read-image-preview',
      path.relative(process.cwd(), exactPath),
    )).rejects.toThrow('Attachment reference is invalid or expired');

    const lstat = vi.spyOn(fsPromises, 'lstat');
    const readFile = vi.spyOn(fsPromises, 'readFile');
    lstat.mockResolvedValueOnce({ isFile: () => true, size: 4 } as never);
    await expect(main.call('codex-native:read-image-preview', exactPath)).resolves.toBeNull();
    lstat.mockResolvedValueOnce({ isFile: () => true, size: 3 } as never);
    readFile.mockResolvedValueOnce(Buffer.from('large'));
    await expect(main.call('codex-native:read-image-preview', exactPath)).resolves.toBeNull();
    for (const error of [null, 'failure', {}, { code: 'EACCES' }]) {
      lstat.mockRejectedValueOnce(error);
      await expect(main.call('codex-native:read-image-preview', exactPath)).rejects.toBe(error);
    }
    lstat.mockRestore();
    readFile.mockRestore();
    dispose();

    const largeLimitMain = new FakeMainPort();
    const disposeLargeLimit = registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      ipcMain: largeLimitMain,
      shell: { openExternal: vi.fn(async () => undefined) },
    }, { maxImagePreviewBytes: 1_024 });
    await expect(largeLimitMain.call('codex-native:read-image-preview', directoryPath)).resolves.toBeNull();
    disposeLargeLimit();
  });

  it('accepts exact ingestion limits and sanitizes renderer-provided file names', async () => {
    const main = new FakeMainPort();
    const attachments = new CodexElectronAttachmentRegistry();
    const dispose = registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      ipcMain: main,
      shell: { openExternal: vi.fn(async () => undefined) },
    }, { maxAttachmentBytes: 2, maxTotalAttachmentBytes: 40 }, attachments);
    const inputs = Array.from({ length: 20 }, (_, index) => ({
      name: index === 0 ? 'bad\u0000name.png' : index === 1 ? '\u0000\u001f' : `${index}.txt`,
      data: new Uint8Array([index, index]).buffer,
      ...(index === 0 ? { mimeType: ' image/png ' } : {}),
    }));

    const ingested = await main.call('codex-native:ingest-attachments', inputs) as Array<Record<string, unknown>>;
    expect(ingested).toHaveLength(20);
    expect(ingested[0]).toMatchObject({
      name: 'badname.png', mimeType: 'image/png', size: 2, type: 'image',
    });
    expect(ingested[0]?.previewUrl).toBe('data:image/png;base64,AAA=');
    expect(ingested[1]).toMatchObject({ name: 'attachment', size: 2, type: 'file' });
    const ingestedDirectory = path.dirname(attachments.path(ingested[0]?.reference as string));
    temporaryDirectories.push(ingestedDirectory);
    expect((await fsPromises.stat(path.join(ingestedDirectory, '0-badname.png'))).mode & 0o777).toBe(0o600);
    dispose();
  });

  it('filters SVG and oversized previews from renderer-ingested attachments', async () => {
    const main = new FakeMainPort();
    const attachments = new CodexElectronAttachmentRegistry();
    const dispose = registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      ipcMain: main,
      shell: { openExternal: vi.fn(async () => undefined) },
    }, {
      maxAttachmentBytes: (8 * 1024 * 1024) + 1,
      maxTotalAttachmentBytes: (24 * 1024 * 1024) + 2,
    }, attachments);

    const ingested = await main.call('codex-native:ingest-attachments', [
      { name: 'vector.svg', mimeType: 'image/svg+xml', data: new ArrayBuffer(1) },
      { name: 'exact.png', mimeType: 'image/png', data: new ArrayBuffer(8 * 1024 * 1024) },
      { name: 'oversized.png', mimeType: 'image/png', data: new ArrayBuffer((8 * 1024 * 1024) + 1) },
    ]) as Array<Record<string, unknown>>;
    expect(ingested[0]).not.toHaveProperty('previewUrl');
    expect(ingested[1]?.previewUrl).toEqual(expect.stringMatching(/^data:image\/png;base64,/));
    expect(ingested[2]).not.toHaveProperty('previewUrl');
    temporaryDirectories.push(path.dirname(attachments.path(ingested[0]?.reference as string)));
    dispose();
  });

  it('does not create a temporary directory for an empty ingestion batch', async () => {
    const main = new FakeMainPort();
    const mkdtempCall = vi.spyOn(fsPromises, 'mkdtemp');
    const dispose = registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      ipcMain: main,
      shell: { openExternal: vi.fn(async () => undefined) },
    });

    await expect(main.call('codex-native:ingest-attachments', [])).resolves.toStrictEqual([]);
    expect(mkdtempCall).not.toHaveBeenCalled();
    dispose();
  });

  it('preserves exact clipboard, link, and transcription boundaries', async () => {
    const main = new FakeMainPort();
    const clipboard = { write: vi.fn() };
    const shell = { openExternal: vi.fn(async () => undefined) };
    const transcribeAudio = vi.fn(async () => ({ text: 'ok' }));
    const dispose = registerCodexNativeIpc({
      clipboard,
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      ipcMain: main,
      shell,
    }, { maxAudioBytes: 3, transcribeAudio });
    const text = 'x'.repeat(5_000_000);
    const html = 'x'.repeat(10_000_000);

    await main.call('codex-native:copy-to-clipboard', { text, html });
    expect(clipboard.write).toHaveBeenCalledWith({ text, html });
    await main.call('codex-native:copy-to-clipboard', { text: 'plain', html: '' });
    expect(clipboard.write).toHaveBeenLastCalledWith({ text: 'plain' });
    await main.call('codex-native:copy-to-clipboard', { text: 'without HTML' });
    expect(clipboard.write).toHaveBeenLastCalledWith({ text: 'without HTML' });
    for (const [input, normalized] of [
      [' http://example.com ', 'http://example.com/'],
      ['mailto:person@example.com', 'mailto:person@example.com'],
      ['tel:+13125550100', 'tel:+13125550100'],
    ]) {
      await main.call('codex-native:open-external', input);
      expect(shell.openExternal).toHaveBeenLastCalledWith(normalized);
    }
    const audio = new Uint8Array([1, 2, 3]).buffer;
    await expect(main.call(
      'codex-native:transcribe-audio', audio, { locale: ' fr-FR ', live: false },
    )).resolves.toStrictEqual({ text: 'ok' });
    expect(transcribeAudio).toHaveBeenLastCalledWith(Buffer.from(audio), { locale: 'fr-FR', live: false });
    await expect(main.call('codex-native:transcribe-audio', new ArrayBuffer(0))).resolves.toStrictEqual({ text: 'ok' });
    expect(transcribeAudio).toHaveBeenLastCalledWith(Buffer.alloc(0), undefined);
    await main.call('codex-native:transcribe-audio', new ArrayBuffer(0), { live: true });
    expect((transcribeAudio.mock.calls.at(-1) as unknown as [Buffer, unknown])?.[1]).toStrictEqual({ live: true });
    await main.call('codex-native:transcribe-audio', new ArrayBuffer(0), { locale: 'en-US' });
    expect((transcribeAudio.mock.calls.at(-1) as unknown as [Buffer, unknown])?.[1]).toStrictEqual({ locale: 'en-US' });
    dispose();
  });

  it('uses the built-in Apple transcriber with configured assets', async () => {
    backendMocks.transcribeWithAppleSpeechAnalyzer.mockClear();
    const main = new FakeMainPort();
    const dispose = registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      ipcMain: main,
      shell: { openExternal: vi.fn(async () => undefined) },
    }, { appleSpeechAssetsPath: '/opt/codex/speech' });
    const audio = new Uint8Array([1, 2]).buffer;

    await expect(main.call(
      'codex-native:transcribe-audio', audio, { locale: 'en-US', live: true },
    )).resolves.toStrictEqual({ text: 'native transcript' });
    expect(backendMocks.transcribeWithAppleSpeechAnalyzer).toHaveBeenCalledWith(
      Buffer.from(audio),
      { locale: 'en-US', live: true },
      { assetsPath: '/opt/codex/speech' },
    );
    dispose();
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
    await expect(main.call('codex-native:copy-to-clipboard', null)).rejects.toThrow(
      'Clipboard content must be an object',
    );
    await expect(main.call('codex-native:copy-to-clipboard', 42)).rejects.toThrow(
      'Clipboard content must be an object',
    );
    await expect(main.call('codex-native:copy-to-clipboard', { text: 'ok', html: 42 })).rejects.toThrow(
      'Clipboard HTML must be a string',
    );
    await expect(main.call('codex-native:copy-to-clipboard', {
      text: 'x'.repeat(5_000_001),
    })).rejects.toThrow('Clipboard content is too large');
    await expect(main.call('codex-native:copy-to-clipboard', {
      text: 'ok', html: 'x'.repeat(10_000_001),
    })).rejects.toThrow('Clipboard content is too large');
    await expect(main.call('codex-native:ingest-attachments', null)).rejects.toThrow(
      'Attachments must be an array',
    );
    await expect(main.call('codex-native:ingest-attachments', Array.from({ length: 21 }, () => ({
      name: 'empty.txt', data: new ArrayBuffer(0),
    })))).rejects.toThrow('At most 20 attachments can be added at once');
    await expect(main.call('codex-native:ingest-attachments', [null])).rejects.toThrow(
      'Attachment must be an object',
    );
    await expect(main.call('codex-native:ingest-attachments', [[]])).rejects.toThrow(
      'Attachment must be an object',
    );
    await expect(main.call('codex-native:ingest-attachments', [{
      name: ' ', data: new ArrayBuffer(0),
    }])).rejects.toThrow('Attachment name must be a non-empty string');
    await expect(main.call('codex-native:ingest-attachments', [{
      name: 'file.txt', data: 'bytes',
    }])).rejects.toThrow('Attachment data must be an ArrayBuffer');
    await expect(main.call('codex-native:ingest-attachments', [{
      name: 'file.txt', data: new ArrayBuffer(0), mimeType: ' ',
    }])).rejects.toThrow('Attachment MIME type must be a non-empty string');
    await expect(main.call('codex-native:transcribe-audio', 'audio')).rejects.toThrow(
      'Audio data must be an ArrayBuffer',
    );
    await expect(main.call('codex-native:transcribe-audio', new ArrayBuffer(0), null)).rejects.toThrow(
      'Speech transcription options must be an object',
    );
    await expect(main.call('codex-native:transcribe-audio', new ArrayBuffer(0), [])).rejects.toThrow(
      'Speech transcription options must be an object',
    );
    await expect(main.call('codex-native:transcribe-audio', new ArrayBuffer(0), { live: 'yes' })).rejects.toThrow(
      'Speech transcription live mode must be a boolean',
    );
    await expect(main.call('codex-native:transcribe-audio', new ArrayBuffer(0), { locale: ' ' })).rejects.toThrow(
      'Speech transcription locale must be a non-empty string',
    );
    await expect(main.call('codex-native:read-image-preview', ' ')).rejects.toThrow(
      'Image preview attachment reference must be a non-empty string',
    );
    await expect(main.call('codex-native:open-external', 42)).rejects.toThrow(
      'External URL must be a non-empty string',
    );
    await expect(main.call('codex-native:read-image-preview', 'attachment:unknown')).rejects.toThrow(
      'Attachment reference is invalid or expired',
    );
    dispose();
  });

  it.each([
    ['maxAttachmentBytes', 0, 'Attachment byte limit must be a positive integer'],
    ['maxAudioBytes', -1, 'Audio byte limit must be a positive integer'],
    ['maxTotalAttachmentBytes', 1.5, 'Total attachment byte limit must be a positive integer'],
    ['maxImagePreviewBytes', Number.MAX_SAFE_INTEGER + 1, 'Image preview byte limit must be a positive integer'],
  ] as const)('rejects an invalid %s option', (option, value, message) => {
    const main = new FakeMainPort();
    expect(() => registerCodexNativeIpc({
      clipboard: { write: vi.fn() },
      dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
      ipcMain: main,
      shell: { openExternal: vi.fn(async () => undefined) },
    }, { [option]: value })).toThrow(message);
    expect(main.handlers.size).toBe(0);
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
