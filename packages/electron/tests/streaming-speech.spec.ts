import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type { CodexSpeechSessionEvent, CodexSpeechTranscriptionResult, CodexPreparedSpeechSession } from '@codex-app-sdk/core/native';
import { registerCodexNativeIpc, type CodexNativeMainOptions } from '../src/codex-native-ipc';
import { createCodexNativeRendererApi } from '../src/codex-native-renderer';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function runtime(options: CodexNativeMainOptions, speechPreparation = false) {
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
    }, { transcription: true, streamingTranscription: true, speechPreparation }) };
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
  const observed: string[] = [];
  const h = runtime({ startSpeechSession: async (_input, _onEvent, options) => {
    signal = options?.signal;
    await new Promise<void>((resolve) => { ready = resolve; });
    return session;
  }, onSpeechOperation: (operation) => {
    observed.push(operation);
    return outcome => { observed.push(`${operation}:${outcome}`); };
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
  await vi.waitFor(() => expect(observed).toEqual([
    'start', 'start:cancelled', 'cancel', 'cancel:cancelled',
    'start', 'start:succeeded', 'cancel', 'cancel:cancelled',
  ]));
});

it('pairs concurrent speech observations without exposing arguments, results, or duplicate stops', async () => {
  const observations: unknown[][] = [];
  const executionOrder: string[] = [];
  const sessions = ['private first text', 'private second text'].map(text => ({
    append: vi.fn(async () => {}), stop: vi.fn(async () => { executionOrder.push('stop:execute'); return { text }; }), cancel: vi.fn(async () => {}),
  }));
  let index = 0;
  const h = runtime({
    startSpeechSession: async () => { executionOrder.push('start:execute'); return sessions[index++]!; },
    onSpeechOperation: (...args) => {
      executionOrder.push(`${args[0]}:begin`);
      const observation: unknown[] = [...args];
      observations.push(observation);
      return (...outcome) => { observation.push(outcome); };
    },
  });
  const first = h.renderer().api.streamingTranscription!;
  const second = h.renderer().api.streamingTranscription!;
  await expect(first.start({ sessionId: '../invalid', sampleRate: 16000 })).rejects.toThrow('Invalid');
  expect(observations).toEqual([]);
  await Promise.all([
    first.start({ sessionId: 'private-first-id', sampleRate: 16000, locale: 'en-US' }),
    second.start({ sessionId: 'private-second-id', sampleRate: 16000 }),
  ]);
  await first.append('private-first-id', new Float32Array([0.7]).buffer);
  expect(await Promise.all([second.stop('private-second-id'), first.stop('private-first-id'), first.stop('private-first-id')]))
    .toEqual([{ text: 'private second text' }, { text: 'private first text' }, { text: 'private first text' }]);
  expect(observations).toEqual([
    ['start', ['succeeded']], ['start', ['succeeded']], ['stop', ['succeeded']], ['stop', ['succeeded']],
  ]);
  expect(executionOrder).toEqual([
    'start:begin', 'start:execute', 'start:begin', 'start:execute',
    'stop:begin', 'stop:execute', 'stop:begin', 'stop:execute',
  ]);
  for (const session of sessions) expect(session.stop).toHaveBeenCalledOnce();
});

it.each(['disabled', 'begin throws', 'finish throws', 'finish rejects', 'finish pending'] as const)(
  'keeps dictation independent of observation (%s)', async mode => {
    const session = { append: vi.fn(async () => {}), stop: vi.fn(async () => ({ text: 'Final words.' })), cancel: vi.fn(async () => {}) };
    let begins = 0;
    let finishes = 0;
    const h = runtime({
      startSpeechSession: async () => session,
      onSpeechOperation: () => {
        begins += 1;
        if (mode === 'disabled') return;
        if (mode === 'begin throws') throw new Error('Observer failed');
        return () => {
          finishes += 1;
          if (mode === 'finish throws') throw new Error('Observer failed');
          if (mode === 'finish pending') return new Promise<void>(() => {});
          return Promise.reject(new Error('Observer failed'));
        };
      },
    });
    const stream = h.renderer().api.streamingTranscription!;
    await stream.start({ sessionId: 'recording', sampleRate: 16000 });
    await stream.append('recording', new Float32Array([0.3]).buffer);
    expect(await stream.stop('recording')).toEqual({ text: 'Final words.' });
    expect(session.append).toHaveBeenCalledOnce();
    expect(session.stop).toHaveBeenCalledOnce();
    expect(begins).toBe(2);
    expect(finishes).toBe(mode === 'disabled' || mode === 'begin throws' ? 0 : 2);
  },
);

it('preserves native failures and pairs cancellation with an in-flight stop once', async () => {
  const observed: string[] = [];
  const failure = new Error('Private recognizer failure');
  let finishStop!: () => void;
  const session = {
    append: async () => {},
    stop: vi.fn<() => Promise<CodexSpeechTranscriptionResult>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ text: '', error: 'Private recognition error' })
      .mockImplementation(() => new Promise(resolve => { finishStop = () => resolve({ text: 'Discarded text' }); })),
    cancel: vi.fn(async () => {}),
  };
  const h = runtime({
    startSpeechSession: vi.fn<NonNullable<CodexNativeMainOptions['startSpeechSession']>>()
      .mockRejectedValueOnce(failure).mockResolvedValue(session),
    onSpeechOperation: operation => {
      observed.push(operation);
      return outcome => { observed.push(`${operation}:${outcome}`); };
    },
  });
  const stream = h.renderer().api.streamingTranscription!;
  await expect(stream.start({ sessionId: 'failed', sampleRate: 16000 })).rejects.toBe(failure);
  await stream.start({ sessionId: 'retry', sampleRate: 16000 });
  await expect(stream.stop('retry')).rejects.toBe(failure);
  await stream.start({ sessionId: 'reported-error', sampleRate: 16000 });
  expect(await stream.stop('reported-error')).toEqual({ text: '', error: 'Private recognition error' });
  await stream.start({ sessionId: 'race', sampleRate: 16000 });
  const stopping = stream.stop('race');
  await vi.waitFor(() => expect(finishStop).toBeDefined());
  await Promise.all([stream.cancel('race'), stream.cancel('race')]);
  finishStop();
  expect(await stopping).toEqual({ text: 'Discarded text' });
  expect(session.cancel).toHaveBeenCalledOnce();
  session.cancel.mockRejectedValueOnce(failure);
  await stream.start({ sessionId: 'cancel-error', sampleRate: 16000 });
  await expect(stream.cancel('cancel-error')).resolves.toBeUndefined();
  expect(observed).toEqual([
    'start', 'start:failed', 'start', 'start:succeeded', 'stop', 'stop:failed',
    'start', 'start:succeeded', 'stop', 'stop:failed',
    'start', 'start:succeeded', 'stop', 'cancel', 'cancel:cancelled', 'stop:cancelled',
    'start', 'start:succeeded', 'cancel', 'cancel:failed',
  ]);
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


it('owns prepared sessions before activation, preserves actual rate, and rejects foreign or repeated activation', async () => {
  const session = { append: vi.fn(async () => {}), stop: vi.fn(async () => ({ text: 'ready' })), cancel: vi.fn(async () => {}) };
  const prepared = { start: vi.fn(async (_rate: number) => session), cancel: vi.fn(async () => {}) };
  const prepare = vi.fn(async () => prepared);
  const h = runtime({ prepareSpeechSession: prepare }, true);
  const owner = h.renderer();
  const other = h.renderer();
  const stream = owner.api.streamingTranscription!;
  await stream.prepare!({ sessionId: 'prepared', locale: 'fr-FR' });
  expect(prepared.start).not.toHaveBeenCalled();
  await expect(other.api.streamingTranscription!.start({ sessionId: 'prepared', sampleRate: 48000 })).rejects.toThrow('owner');
  await expect(stream.append('prepared', new ArrayBuffer(4))).rejects.toThrow('not active');
  await stream.start({ sessionId: 'prepared', sampleRate: 48000, locale: 'fr-FR' });
  expect(prepared.start).toHaveBeenCalledWith(48000);
  await expect(stream.start({ sessionId: 'prepared', sampleRate: 48000 })).rejects.toThrow('already active');
  await stream.append('prepared', new Float32Array([0.5]).buffer);
  expect(await stream.stop('prepared')).toEqual({ text: 'ready' });
  expect(session.append).toHaveBeenCalledOnce();
  await stream.prepare!({ sessionId: 'next' });
  owner.sender.emit('destroyed');
  await vi.waitFor(() => expect(prepared.cancel).toHaveBeenCalled());
});

it('cancels pending preparation immediately and cleans late resources without reviving the renderer', async () => {
  let finish!: (value: CodexPreparedSpeechSession) => void;
  let signal!: AbortSignal;
  const prepared = { start: vi.fn<CodexPreparedSpeechSession['start']>(), cancel: vi.fn(async () => {}) };
  const h = runtime({ prepareSpeechSession: async (_input, _onEvent, options) => {
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  } }, true);
  const stream = h.renderer().api.streamingTranscription!;
  const preparing = stream.prepare!({ sessionId: 'pending' });
  const rejected = expect(preparing).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(signal).toBeDefined());
  await stream.cancel('pending');
  expect(signal.aborted).toBe(true);
  finish(prepared);
  await rejected;
  await vi.waitFor(() => expect(prepared.cancel).toHaveBeenCalledOnce());
  expect(prepared.start).not.toHaveBeenCalled();
});

it.each(['cancel', 'failure'] as const)('cleans prepared resources across an in-flight activation %s and permits the next recording', async outcome => {
  let resolve!: (value: typeof session) => void;
  let reject!: (error: Error) => void;
  const session = { append: vi.fn(async () => {}), stop: vi.fn(async () => ({ text: '' })), cancel: vi.fn(async () => {}) };
  const pending = new Promise<typeof session>((yes, no) => { resolve = yes; reject = no; });
  const prepared = { start: vi.fn(() => pending), cancel: vi.fn(async () => {}) };
  const h = runtime({ prepareSpeechSession: async () => prepared }, true);
  const stream = h.renderer().api.streamingTranscription!;
  await stream.prepare!({ sessionId: 'activation' });
  const starting = stream.start({ sessionId: 'activation', sampleRate: 44100 });
  const failed = expect(starting).rejects.toThrow(outcome === 'cancel' ? 'cancelled' : 'Activation failed');
  await vi.waitFor(() => expect(prepared.start).toHaveBeenCalledWith(44100));
  if (outcome === 'cancel') { await stream.cancel('activation'); resolve(session); }
  else reject(new Error('Activation failed'));
  await failed;
  await vi.waitFor(() => expect(prepared.cancel).toHaveBeenCalledOnce());
  if (outcome === 'cancel') await vi.waitFor(() => expect(session.cancel).toHaveBeenCalledOnce());
  await stream.prepare!({ sessionId: 'next-activation' });
  await stream.cancel('next-activation');
});
