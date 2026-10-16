import { afterEach, expect, it, vi } from 'vitest';
import type { CodexSpeechSessionEvent } from '@codex-app-sdk/core/native';
import { createSherpaSpeechService } from '../src/node/sherpa-speech-session';

const services: ReturnType<typeof createSherpaSpeechService>[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.dispose())); });
function service(idleTimeoutMs = 80) {
  const value = createSherpaSpeechService({
    model: { encoder: '/local/encoder', decoder: '/local/decoder', joiner: '/local/joiner', tokens: '/local/tokens' },
    helperPath: new URL('./fixtures/sherpa-helper.cjs', import.meta.url).pathname,
    idleTimeoutMs, requestTimeoutMs: 300,
  });
  services.push(value);
  return value;
}
const input = (sessionId: string) => ({ sessionId, sampleRate: 16000 });
const pcm = (marker: number) => new Float32Array([marker]).buffer;

it('reuses one preloaded helper across sessions, replaces partials and finalizes once', async () => {
  const host = service();
  expect(host.processId).toBeUndefined();
  await host.preload();
  const pid = host.processId;
  const events: CodexSpeechSessionEvent[] = [];
  const first = await host.startSession(input('one'), (event) => events.push(event));
  await first.append(pcm(1));
  expect(events).toEqual([
    { type: 'transcript', sessionId: 'one', finalText: '', partialText: 'a cat' },
    { type: 'transcript', sessionId: 'one', finalText: '', partialText: 'a cap' },
  ]);
  const stopped = first.stop();
  expect(first.stop()).toBe(stopped);
  const results = await Promise.all([stopped, first.stop()]);
  expect(results).toEqual([{ text: 'A cap.' }, { text: 'A cap.' }]);
  await expect(first.append(pcm(1))).rejects.toThrow('recording');
  const next = await host.startSession(input('one'), (event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(events).toHaveLength(2);
  expect(host.processId).toBe(pid);
  await next.cancel();
  await vi.waitFor(() => expect(host.processId).toBeUndefined());
  expect(() => process.kill(pid!, 0)).toThrow();
  const restarted = await host.startSession(input('restart'), () => {});
  expect(host.processId).not.toBe(pid);
  await restarted.cancel();
});

it('isolates simultaneous streams, cancellation and late events during rapid restart', async () => {
  const host = service();
  const events: CodexSpeechSessionEvent[] = [];
  const old = await host.startSession(input('same'), (e) => events.push(e));
  const other = await host.startSession(input('other'), (e) => events.push(e));
  await expect(host.startSession(input('same'), () => {})).rejects.toThrow('already');
  await old.cancel();
  const fresh = await host.startSession(input('same'), (e) => events.push(e));
  await fresh.append(pcm(1));
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(events.map((e) => e.type === 'transcript' && e.partialText)).toEqual(['a cat', 'a cap']);
  expect(host.processId).toBeDefined(); // Other sessions block idle retirement.
  expect(await old.stop()).toEqual({ text: '', error: 'Speech recording cancelled.' });
  await Promise.all([fresh.stop(), other.stop()]);
});

it.each([3, 4, 6, 7])('fails safely on helper error/exit/hang/protocol failure (%s), then restarts', async (marker) => {
  const host = service();
  const events: CodexSpeechSessionEvent[] = [];
  const session = await host.startSession(input('bad'), (e) => events.push(e));
  await expect(session.append(pcm(marker))).rejects.toThrow();
  const result = await session.stop();
  expect(result.text).toBe('');
  expect(result.error).toBeTruthy();
  expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
  const next = await host.startSession(input('good'), () => {});
  await next.append(pcm(1));
  expect(await next.stop()).toEqual({ text: 'A cap.' });
});

it('discards a finalizing session on cancel without cancelling another shared stream', async () => {
  const host = service();
  const first = await host.startSession(input('finalizing'), () => {});
  const other = await host.startSession(input('survivor'), () => {});
  const stopping = first.stop();
  await Promise.all([first.cancel(), first.cancel()]);
  expect(await stopping).toEqual({ text: '', error: 'Speech recording cancelled.' });
  await other.append(pcm(1));
  expect(await other.stop()).toEqual({ text: 'A cap.' });
});

it('waits for idle retirement before a racing start and cancels startup/disposal without publishing late text', async () => {
  const host = service(5);
  await host.preload();
  const oldPid = host.processId;
  await new Promise((resolve) => setTimeout(resolve, 15));
  const next = await host.startSession(input('race'), () => {});
  expect(host.processId).not.toBe(oldPid);
  expect(() => process.kill(oldPid!, 0)).toThrow();
  await next.cancel();
  const abort = new AbortController();
  const events = vi.fn();
  const starting = host.startSession(input('aborted'), events, { signal: abort.signal });
  abort.abort();
  await expect(starting).rejects.toThrow('cancelled');
  expect(events).not.toHaveBeenCalled();
  const last = await host.startSession(input('last'), () => { throw new Error('Disconnected consumer'); });
  await last.append(pcm(1));
  await host.dispose();
  expect((await last.stop()).error).toBeTruthy();
  await expect(host.preload()).rejects.toThrow('disposed');
});

it('rejects invalid model/lifecycle/session/PCM options before accepting input', async () => {
  expect(() => service(-1)).toThrow();
  const host = service();
  await expect(host.startSession({ ...input('bad'), sampleRate: 0 }, () => {})).rejects.toThrow('sample rate');
  await expect(host.startSession(input('../bad'), () => {})).rejects.toThrow('session');
  const session = await host.startSession(input('ok'), () => {});
  await expect(session.append(new ArrayBuffer(3))).rejects.toThrow('PCM');
  await expect(session.append(new ArrayBuffer(256 * 1024 + 4))).rejects.toThrow('PCM');
  await session.cancel();
});
