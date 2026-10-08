// @vitest-environment jsdom
import { effectScope } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import type { CodexSpeechSessionEvent, CodexStreamingTranscription } from '@codex-app-sdk/core/native';
import { useChatComposerVoice } from '../../src/chat/use-chat-composer-voice';
import type { SpeechRecorder } from '../../src/audio/browser-speech-recorder';

const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); });

function setup() {
  const listeners = new Set<(event: CodexSpeechSessionEvent) => void>();
  let resolve!: (result: { text: string }) => void;
  const service: CodexStreamingTranscription = {
    start: vi.fn(async () => {}), append: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    stop: vi.fn(() => new Promise<{ text: string }>((done) => { resolve = done; })),
    onEvent: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const capture = { start: vi.fn<SpeechRecorder['start']>(async () => 16000), activate: vi.fn(), stop: vi.fn(async () => {}), release: vi.fn() };
  const insert = vi.fn();
  const scope = effectScope();
  scopes.push(scope);
  const voice = scope.run(() => useChatComposerVoice({ isDisabled: () => false, isSending: () => false,
    onTranscript: insert, streamingTranscription: service,
  }, { isRecordingSupported: () => true, createStreamRecorder: () => capture }))!;
  return { voice, service, capture, insert, scope, listeners,
    emit: (event: CodexSpeechSessionEvent) => listeners.forEach((listener) => listener(event)), finish: (text: string) => resolve({ text }),
    id: () => vi.mocked(service.start).mock.calls.at(-1)![0].sessionId };
}

it('coalesces concurrent stops and only delivers the final transcript after recognition drains', async () => {
  const h = setup();
  await h.voice.toggle();
  const stopping = h.voice.stop();
  expect(await h.voice.stop()).toBe(false);
  await vi.waitFor(() => expect(h.service.stop).toHaveBeenCalledOnce());
  expect(h.voice.isTranscribing.value).toBe(true);
  expect(h.insert).not.toHaveBeenCalled();
  h.finish('A cap is blue.');
  expect(await stopping).toBe(true);
  expect(h.insert.mock.calls).toEqual([['A cap is blue.']]);
  expect(h.listeners.size).toBe(0);
});

it('discards cancelled, old-session and unmounted results, including a stop already in flight', async () => {
  const h = setup();
  await h.voice.toggle();
  const oldId = h.id();
  const oldLevel = h.capture.start.mock.calls.at(-1)![2]!;
  oldLevel(0.5);
  expect(h.voice.audioLevel.value).toBe(0.5);
  const stopping = h.voice.stop();
  oldLevel(0.8);
  expect(h.voice.audioLevel.value).toBe(0);
  await vi.waitFor(() => expect(h.service.stop).toHaveBeenCalledOnce());
  await h.voice.cancel();
  expect(h.listeners.size).toBe(0);
  await h.voice.toggle();
  oldLevel(0.9);
  expect(h.voice.audioLevel.value).toBe(0);
  h.capture.start.mock.calls.at(-1)![2]!(0.3);
  expect(h.voice.audioLevel.value).toBe(0.3);
  h.emit({ type: 'transcript', sessionId: oldId, finalText: 'stale', partialText: '' });
  expect(h.voice.transcript.value).toEqual({ finalText: '', partialText: '' });
  h.finish('stale final');
  expect(await stopping).toBe(false);
  expect(h.voice.isRecording.value).toBe(true);
  h.scope.stop();
  expect(h.voice.audioLevel.value).toBe(0);
  expect(h.listeners.size).toBe(0);
  h.emit({ type: 'transcript', sessionId: h.id(), finalText: 'late', partialText: '' });
  expect(h.insert).not.toHaveBeenCalled();
  expect(h.service.cancel).toHaveBeenCalledWith(oldId);
  expect(h.voice.isRecording.value).toBe(false);
});

it('surfaces a streaming error without delivering a transcript', async () => {
  const h = setup();
  await h.voice.toggle();
  h.emit({ type: 'error', sessionId: h.id(), error: 'Recognition failed' });
  expect(h.voice.error.value).toBe('Recognition failed');
  expect(h.voice.isRecording.value).toBe(false);
  expect(h.capture.release).toHaveBeenCalled();
  expect(await h.voice.stop()).toBe(false);
  expect(h.insert).not.toHaveBeenCalled();
});

it('does not start recognition after microphone permission finishes for a cancelled field', async () => {
  const h = setup();
  let ready!: (rate: number) => void;
  h.capture.start.mockImplementationOnce(() => new Promise((resolve) => { ready = resolve; }));
  const starting = h.voice.toggle();
  expect(h.voice.isStarting.value).toBe(true);
  expect(await h.voice.stop()).toBe(false);
  await h.voice.cancel();
  ready(16000);
  await starting;
  expect(h.service.start).not.toHaveBeenCalled();
  expect(h.voice.isRecording.value).toBe(false);
  await h.voice.toggle();
  expect(h.voice.isRecording.value).toBe(true);
});

it('cancels native startup and never commits text after the field unmounts', async () => {
  const h = setup();
  let ready!: () => void;
  vi.mocked(h.service.start).mockImplementationOnce(() => new Promise<void>((resolve) => { ready = resolve; }));
  const starting = h.voice.toggle();
  await vi.waitFor(() => expect(h.service.start).toHaveBeenCalledOnce());
  h.scope.stop();
  ready();
  await starting;
  expect(h.voice.isRecording.value).toBe(false);
  h.emit({ type: 'transcript', sessionId: h.id(), finalText: 'too late', partialText: '' });
  expect(h.insert).not.toHaveBeenCalled();
  expect(h.service.cancel).toHaveBeenCalledWith(h.id());
});

it('does not finalize native recognition when cancellation interrupts the microphone drain', async () => {
  const h = setup();
  let drained!: () => void;
  h.capture.stop.mockImplementationOnce(() => new Promise<void>((resolve) => { drained = resolve; }));
  await h.voice.toggle();
  const stopping = h.voice.stop();
  await h.voice.cancel();
  drained();
  expect(await stopping).toBe(false);
  expect(h.service.stop).not.toHaveBeenCalled();
  expect(h.insert).not.toHaveBeenCalled();
});
