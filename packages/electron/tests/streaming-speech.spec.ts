import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { CodexSpeechSessionEvent } from '@codex-app-sdk/core/native';
import { registerCodexNativeIpc, type CodexNativeMainOptions } from '../src/codex-native-ipc';
import { createCodexNativeRendererApi } from '../src/codex-native-renderer';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function runtime(options: CodexNativeMainOptions) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcMain = { handle: (name: string, fn: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(name, fn); },
    removeHandler: (name: string) => { handlers.delete(name); } };
  function renderer() {
    const bus = new EventEmitter();
    const sender = new EventEmitter();
    const senderFrame = { processId: 1, routingId: 1, send: (name: string, payload: unknown) => bus.emit(name, {}, payload) };
    return { sender, senderFrame, api: createCodexNativeRendererApi({
      invoke: async (name, ...args) => handlers.get(name)!({ sender, senderFrame }, ...args),
      on: (name, fn) => { bus.on(name, fn); }, off: (name, fn) => { bus.off(name, fn); },
    }, { transcription: true, streamingTranscription: true }) };
  }
  const dispose = registerCodexNativeIpc({ ipcMain, clipboard: { write() {} }, dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, shell: { openExternal: async () => {} } }, options);
  cleanups.push(dispose);
  return { renderer, dispose, handlers };
}

it('routes live speech only to its owner and cancels on renderer teardown', async () => {
  let publish!: (event: CodexSpeechSessionEvent) => void;
  const session = { append: vi.fn(async () => {}), stop: vi.fn(async () => ({ text: 'Final words.' })), cancel: vi.fn(async () => {}) };
  const { renderer, dispose, handlers } = runtime({
    startSpeechSession: async (_options, onEvent) => { publish = onEvent; return session; },
  });
  const owner = renderer();
  const other = renderer();
  const received: CodexSpeechSessionEvent[] = [];
  const unsubscribe = owner.api.streamingTranscription!.onEvent((event) => received.push(event));
  const stream = owner.api.streamingTranscription!;
  await stream.start({ sessionId: 'first', sampleRate: 16000 });
  publish({ type: 'transcript', sessionId: 'first', finalText: '', partialText: 'fine words' });
  expect(received).toEqual([{ type: 'transcript', sessionId: 'first', finalText: '', partialText: 'fine words' }]);
  await expect(other.api.streamingTranscription!.stop('first')).rejects.toThrow('owner');
  await stream.append('first', new Float32Array([0.2]).buffer);
  expect(session.append).toHaveBeenCalledOnce();
  expect(await stream.stop('first')).toEqual({ text: 'Final words.' });
  expect(session.stop).toHaveBeenCalledOnce();
  await stream.start({ sessionId: 'second', sampleRate: 16000 });
  owner.sender.emit('destroyed');
  await vi.waitFor(() => expect(session.cancel).toHaveBeenCalled());
  publish({ type: 'transcript', sessionId: 'second', finalText: 'late', partialText: '' });
  expect(received).toHaveLength(1);
  unsubscribe();
  dispose();
  expect(handlers.size).toBe(0);
});

it('rejects invalid input and bounded-audio overflow without allowing another renderer to cancel the owner', async () => {
  const session = { append: vi.fn(async () => {}), stop: vi.fn(async () => ({ text: '' })), cancel: vi.fn(async () => {}) };
  const h = runtime({ maxAudioBytes: 8, startSpeechSession: async () => session });
  const stream = h.renderer().api.streamingTranscription!;
  await expect(stream.start({ sessionId: '../bad', sampleRate: 16000 })).rejects.toThrow('Invalid');
  await expect(stream.start({ sessionId: 'valid', sampleRate: -1 })).rejects.toThrow('Invalid');
  await stream.start({ sessionId: 'valid', sampleRate: 16000 });
  await expect(stream.start({ sessionId: 'another', sampleRate: 16000 })).rejects.toThrow('already active');
  await expect(h.renderer().api.streamingTranscription!.cancel('valid')).rejects.toThrow('owner');
  await expect(stream.append('valid', new ArrayBuffer(3))).rejects.toThrow('Invalid PCM');
  await stream.append('valid', new ArrayBuffer(8));
  await expect(stream.append('valid', new ArrayBuffer(4))).rejects.toThrow('byte limit');
  expect(session.cancel).toHaveBeenCalledOnce();
  await stream.cancel('valid');
  h.dispose();
});

it.each(['details', 'legacy'] as const)('keeps speech through unrelated navigation, but cancels document replacement (%s events)', async (format) => {
  const session = { append: vi.fn(async () => {}), stop: vi.fn(async () => ({ text: '' })), cancel: vi.fn(async () => {}) };
  let ready!: () => void;
  let signal: AbortSignal | undefined;
  const h = runtime({ startSpeechSession: async (_input, _onEvent, options) => {
    signal = options?.signal;
    await new Promise<void>((resolve) => { ready = resolve; });
    return session;
  } });
  const owner = h.renderer();
  function navigate(isSameDocument: boolean, isMainFrame: boolean, frame = owner.senderFrame) {
    if (format === 'details') owner.sender.emit('did-start-navigation', { isSameDocument, isMainFrame, frame });
    else owner.sender.emit('did-start-navigation', {}, 'about:blank', isSameDocument, isMainFrame, frame.processId, frame.routingId);
  }
  const stream = owner.api.streamingTranscription!;
  const starting = stream.start({ sessionId: 'pending', sampleRate: 16000 });
  const failed = expect(starting).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(signal).toBeDefined());
  navigate(false, false, { ...owner.senderFrame, routingId: 2 });
  navigate(true, true);
  expect(signal!.aborted).toBe(false);
  // Replacing the owner frame must cancel even if the owner is a subframe.
  navigate(false, false);
  expect(signal!.aborted).toBe(true);
  ready();
  await failed;
  await vi.waitFor(() => expect(session.cancel).toHaveBeenCalledOnce());
  const next = stream.start({ sessionId: 'next', sampleRate: 16000 });
  await Promise.resolve();
  ready();
  await next;
  navigate(false, true);
  await vi.waitFor(() => expect(session.cancel).toHaveBeenCalledTimes(2));
});

it('reports recognizer errors and permits retry after a failed startup', async () => {
  let publish!: (event: CodexSpeechSessionEvent) => void;
  const session = { append: vi.fn(async () => {}), stop: vi.fn(async () => ({ text: '' })), cancel: vi.fn(async () => {}) };
  const factory = vi.fn<NonNullable<CodexNativeMainOptions['startSpeechSession']>>()
    .mockRejectedValueOnce(new Error('Model unavailable'))
    .mockImplementation(async (_options, onEvent) => { publish = onEvent; return session; });
  const h = runtime({ startSpeechSession: factory });
  const stream = h.renderer().api.streamingTranscription!;
  const events: CodexSpeechSessionEvent[] = [];
  stream.onEvent((event) => events.push(event));
  await expect(stream.start({ sessionId: 'failed', sampleRate: 16000 })).rejects.toThrow('Model unavailable');
  await stream.start({ sessionId: 'retry', sampleRate: 16000 });
  publish({ type: 'error', sessionId: 'retry', error: 'Recognition failed' });
  expect(events).toEqual([{ type: 'error', sessionId: 'retry', error: 'Recognition failed' }]);
  await vi.waitFor(() => expect(session.cancel).toHaveBeenCalledOnce());
  h.dispose();
});
