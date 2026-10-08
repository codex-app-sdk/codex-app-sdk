import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import * as speech from '../src/node/apple-speech-session';

function helperProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => { child.emit('close', null); return true; }),
  });
  return child;
}

it('streams corrections before stop and returns the drained final transcript on repeated stops', async () => {
  const child = helperProcess();
  const events: unknown[] = [];
  const start = speech.startAppleSpeechSession({ sessionId: 'one', sampleRate: 16000 }, (event) => events.push(event), {
    spawn: () => child as unknown as ChildProcessWithoutNullStreams,
  });
  await vi.waitFor(() => expect(child.stdout.listenerCount('data')).toBeGreaterThan(0));
  child.stdout.write('{"type":"ready"}\n');
  const session = await start;
  await session.append(new Float32Array([0.1, 0.2]).buffer);
  child.stdout.write('{"type":"transcript","finalText":"","partialText":"a cat"}\n');
  child.stdout.write('{"type":"transcript","finalText":"A cap.","partialText":""}\n');
  expect(events).toEqual([
    { type: 'transcript', sessionId: 'one', finalText: '', partialText: 'a cat' },
    { type: 'transcript', sessionId: 'one', finalText: 'A cap.', partialText: '' },
  ]);
  const stopped = session.stop();
  expect(child.stdin.writableEnded).toBe(true);
  child.stdout.write('{"type":"done","text":"A cap."}\n');
  child.emit('close', 0);
  expect(await stopped).toEqual({ text: 'A cap.' });
  expect(await session.stop()).toEqual({ text: 'A cap.' });
  await session.cancel();
  expect(child.kill).not.toHaveBeenCalled();
});

it('cancels during helper startup without accepting late results', async () => {
  const child = helperProcess();
  const abort = new AbortController();
  const events = vi.fn();
  const starting = speech.startAppleSpeechSession({ sessionId: 'cancelled', sampleRate: 16000 }, events, {
    signal: abort.signal, spawn: () => child as unknown as ChildProcessWithoutNullStreams,
  });
  const rejected = expect(starting).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(child.stdout.listenerCount('data')).toBeGreaterThan(0));
  abort.abort();
  await rejected;
  child.stdout.write('{"type":"ready"}\n{"type":"transcript","finalText":"late","partialText":""}\n');
  expect(events).not.toHaveBeenCalled();
  expect(child.kill).toHaveBeenCalledOnce();
});

it('decodes split UTF-8 results and surfaces helper failure instead of committing a partial transcript', async () => {
  const child = helperProcess();
  const events: unknown[] = [];
  const starting = speech.startAppleSpeechSession({ sessionId: 'french', sampleRate: 48000, locale: 'fr-FR' }, (event) => events.push(event), {
    spawn: () => child as unknown as ChildProcessWithoutNullStreams,
  });
  await vi.waitFor(() => expect(child.stdout.listenerCount('data')).toBeGreaterThan(0));
  child.stdout.write('{"type":"ready"}\n');
  const session = await starting;
  const utf8 = Buffer.from('{"type":"transcript","finalText":"","partialText":"été"}\n');
  for (const byte of utf8) child.stdout.write(Buffer.from([byte]));
  expect(events[0]).toEqual({ type: 'transcript', sessionId: 'french', finalText: '', partialText: 'été' });
  child.stderr.write('Recognition unavailable');
  child.emit('close', 1);
  expect(await session.stop()).toEqual({ text: '', error: 'Recognition unavailable' });
  expect(events[1]).toEqual({ type: 'error', sessionId: 'french', error: 'Recognition unavailable' });
  await expect(session.append(new Float32Array([0]).buffer)).rejects.toThrow('no longer');
});
