// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserSpeechRecorder, isBrowserSpeechRecordingSupported } from '../../src/audio/browser-speech-recorder';

function audioHost() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() });
  const stream = { getTracks: () => [track] };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const port = { onmessage: null as ((event: { data: unknown }) => void) | null, postMessage: vi.fn(), close: vi.fn() };
  const node = { port, connect: vi.fn(), disconnect: vi.fn(), onprocessorerror: null as (() => void) | null };
  const context = {
    sampleRate: 16000, audioWorklet: { addModule: vi.fn(async () => {}) },
    resume: vi.fn(async () => {}), close: vi.fn(async () => {}), destination: {},
    createMediaStreamSource: vi.fn(() => source),
  };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  vi.stubGlobal('AudioWorkletNode', class { constructor() { return node; } });
  return { track, context, port, node, source, getUserMedia, stream };
}
afterEach(() => vi.unstubAllGlobals());

it('drains the last worklet block before closing capture, without recording before activation', async () => {
  const h = audioHost();
  const recorder = new BrowserSpeechRecorder();
  let acknowledge!: () => void;
  const received: ArrayBuffer[] = [];
  const levels: number[] = [];
  const rate = await recorder.start((audio) => { received.push(audio); return new Promise((resolve) => { acknowledge = resolve; }); }, vi.fn(), (level) => levels.push(level));
  expect(rate).toBe(16000);
  expect(h.source.connect).not.toHaveBeenCalled();
  recorder.activate();
  const stop = recorder.stop();
  const audio = new Float32Array([0.1, 0.2]).buffer;
  h.port.onmessage!({ data: audio });
  expect(levels[0]).toBe(1);
  h.port.onmessage!({ data: 'stopped' });
  await vi.waitFor(() => expect(received).toEqual([audio]));
  expect(h.track.stop).not.toHaveBeenCalled();
  acknowledge();
  await stop;
  expect(h.track.stop).toHaveBeenCalledOnce();
  expect(h.context.close).toHaveBeenCalledOnce();
  expect(h.port.close).toHaveBeenCalledOnce();
  h.port.onmessage!({ data: audio });
  expect(levels).toEqual([1]);
});

it('reports changing microphone energy even while audio transport is blocked', async () => {
  const h = audioHost();
  const recorder = new BrowserSpeechRecorder();
  const levels: number[] = [];
  let deliver!: () => void;
  await recorder.start(() => new Promise<void>((resolve) => { deliver = resolve; }), vi.fn(), (level) => levels.push(level));
  recorder.activate();
  h.port.onmessage!({ data: new Float32Array([0.05, -0.05]).buffer });
  await Promise.resolve();
  h.port.onmessage!({ data: new Float32Array([0, 0]).buffer });
  expect(levels[0]).toBeCloseTo(0.4);
  expect(levels[1]).toBe(0);
  recorder.release();
  deliver();
});

it('rejects finalization when navigation releases capture during its drain', async () => {
  const h = audioHost();
  const recorder = new BrowserSpeechRecorder();
  const error = vi.fn();
  await recorder.start(vi.fn(async () => {}), error);
  recorder.activate();
  const stopping = recorder.stop();
  recorder.release();
  // Late audio callbacks and activation cannot revive a disposed recording.
  h.node.onprocessorerror?.();
  recorder.activate();
  await expect(stopping).rejects.toThrow('interrupted');
  expect(error).not.toHaveBeenCalled();
  expect(h.source.connect).toHaveBeenCalledOnce();
  expect(h.track.stop).toHaveBeenCalledOnce();
});

it('releases permission-granted tracks even when cancellation happened while the permission prompt was open', async () => {
  const h = audioHost();
  let grant!: (stream: typeof h.stream) => void;
  h.getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
  const recorder = new BrowserSpeechRecorder();
  const starting = recorder.start(vi.fn(async () => {}), vi.fn());
  recorder.release();
  grant(h.stream);
  await expect(starting).rejects.toThrow('cancelled');
  expect(h.track.stop).toHaveBeenCalledOnce();
  expect(h.context.audioWorklet.addModule).not.toHaveBeenCalled();
});

it.each(['transport', 'overload', 'processor', 'microphone'] as const)('stops capture and reports a %s failure', async (failure) => {
  const h = audioHost();
  const recorder = new BrowserSpeechRecorder();
  const error = vi.fn();
  let acknowledge = () => {};
  await recorder.start(async () => {
    if (failure === 'transport') throw new Error('Disconnected');
    if (failure === 'overload') await new Promise<void>((resolve) => { acknowledge = resolve; });
  }, error);
  recorder.activate();
  if (failure === 'processor') h.node.onprocessorerror?.();
  else if (failure === 'microphone') h.track.dispatchEvent(new Event('ended'));
  else {
    // Normal 2048-sample worklet blocks build a backlog behind a slow transport.
    h.port.onmessage!({ data: new ArrayBuffer(8192) });
    await Promise.resolve();
    if (failure === 'overload') {
      for (let i = 0; i < 32; i++) h.port.onmessage!({ data: new ArrayBuffer(8192) });
    }
  }
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  acknowledge();
  expect(h.track.stop).toHaveBeenCalledOnce();
  await expect(recorder.stop()).rejects.toThrow('No active');
});

it('only offers streaming capture when media capture and AudioWorklet are supported', () => {
  audioHost();
  expect(isBrowserSpeechRecordingSupported()).toBe(true);
  vi.stubGlobal('AudioWorkletNode', undefined);
  expect(isBrowserSpeechRecordingSupported()).toBe(false);
  vi.stubGlobal('navigator', { mediaDevices: undefined });
  expect(isBrowserSpeechRecordingSupported()).toBe(false);
});

it.each(['module', 'resume'] as const)('does not revive the microphone when cancellation races with %s startup', async (stage) => {
  const h = audioHost();
  let proceed!: () => void;
  const pending = new Promise<void>((resolve) => { proceed = resolve; });
  const operation = stage === 'module' ? h.context.audioWorklet.addModule : h.context.resume;
  operation.mockReturnValueOnce(pending);
  const recorder = new BrowserSpeechRecorder();
  const starting = recorder.start(vi.fn(async () => {}), vi.fn());
  await vi.waitFor(() => expect(operation).toHaveBeenCalled());
  recorder.release();
  proceed();
  await expect(starting).rejects.toThrow('cancelled');
  expect(h.track.stop).toHaveBeenCalledOnce();
  expect(h.source.connect).not.toHaveBeenCalled();
});
