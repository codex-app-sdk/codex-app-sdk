import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import type { CodexSpeechSessionEvent } from '@codex-app-sdk/core/native';
import { startOpenAISpeechSession, type OpenAISpeechSessionConfiguration } from '../src/node/openai-speech-session';

class Socket extends EventEmitter {
  bufferedAmount = 0;
  frames: Record<string, any>[] = [];
  closed = false;
  send(data: string) { this.frames.push(JSON.parse(data)); }
  close() { this.closed = true; }
  event(data: object) { this.emit('message', Buffer.from(JSON.stringify(data))); }
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.useRealTimers(); });
function recording(sampleRate = 24000, locale?: string, configuration: Partial<OpenAISpeechSessionConfiguration> = {}) {
  const socket = new Socket();
  const events: CodexSpeechSessionEvent[] = [];
  const connect = vi.fn(() => socket as unknown as WebSocket);
  const abort = new AbortController();
  const starting = startOpenAISpeechSession({ sessionId: 'recording', sampleRate, locale }, event => events.push(event), {
    apiKey: 'test-secret', signal: abort.signal, createWebSocket: connect, ...configuration,
  });
  socket.emit('open');
  socket.event({ type: 'session.updated' });
  return { socket, events, connect, abort, starting };
}

it('configures transcription, streams PCM and partial words, and drains the committed final transcript once', async () => {
  const h = recording(24000, 'fr-FR');
  const session = await h.starting;
  cleanups.push(session.cancel);
  expect(h.connect).toHaveBeenCalledWith('wss://api.openai.com/v1/realtime?intent=transcription', { headers: { Authorization: 'Bearer test-secret' } });
  expect(h.socket.frames).toEqual([{ type: 'session.update', session: { type: 'transcription', audio: { input: {
    format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-live-transcribe', languages: ['fr'] }, turn_detection: null,
  } } } }]);
  await session.append(new Float32Array([0, 1, -1, 0.5]).buffer);
  expect(Buffer.from(h.socket.frames[1]!.audio, 'base64')).toEqual(Buffer.from([0, 0, 255, 127, 0, 128, 0, 64]));
  h.socket.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'speech', delta: 'Bon' });
  h.socket.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'speech', delta: 'jour' });
  expect(h.events.at(-1)).toEqual({ type: 'transcript', sessionId: 'recording', finalText: '', partialText: 'Bonjour' });
  const stop = session.stop();
  expect(session.stop()).toBe(stop);
  await expect(session.append(new ArrayBuffer(4))).rejects.toThrow('no longer');
  expect(h.socket.frames.filter(frame => frame.type === 'input_audio_buffer.commit')).toHaveLength(1);
  // Completion can precede acknowledgement. Only the committed item can finish the recording.
  h.socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'speech', transcript: 'Bonjour !' });
  expect(h.socket.closed).toBe(false);
  h.socket.event({ type: 'input_audio_buffer.committed', item_id: 'speech' });
  expect(await stop).toEqual({ text: 'Bonjour !' });
  expect(h.events.at(-1)).toEqual({ type: 'transcript', sessionId: 'recording', finalText: 'Bonjour !', partialText: '' });
  expect(h.socket.closed).toBe(true);
});

it('resamples across chunk boundaries identically and stops empty recordings without committing', async () => {
  const source = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 20));
  const all = recording(48000);
  const split = recording(48000);
  const empty = recording();
  const sessions = await Promise.all([all.starting, split.starting, empty.starting]);
  cleanups.push(...sessions.map(session => session.cancel));
  await sessions[0]!.append(source.buffer);
  for (let i = 0; i < source.length; i += 137) await sessions[1]!.append(source.slice(i, i + 137).buffer);
  const bytes = (socket: Socket) => Buffer.concat(socket.frames.filter(frame => frame.audio).map(frame => Buffer.from(frame.audio, 'base64')));
  expect(bytes(split.socket)).toEqual(bytes(all.socket));
  expect(bytes(all.socket).length).toBe(4800);
  expect(await sessions[2]!.stop()).toEqual({ text: '' });
  expect(empty.socket.frames).toHaveLength(1);
});

it('cancels connecting and finalizing recordings without publishing late provider text', async () => {
  const socket = new Socket();
  const abort = new AbortController();
  const starting = startOpenAISpeechSession({ sessionId: 'start', sampleRate: 16000 }, () => {}, {
    apiKey: 'secret', signal: abort.signal, createWebSocket: () => socket as unknown as WebSocket,
  });
  const rejected = expect(starting).rejects.toThrow('cancelled');
  abort.abort();
  await rejected;
  expect(socket.closed).toBe(true);
  const h = recording();
  const session = await h.starting;
  await session.append(new Float32Array(2400).buffer);
  const stopped = session.stop();
  await session.cancel();
  h.socket.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'late', transcript: 'Discard me' });
  expect(await stopped).toEqual({ text: '', error: 'Speech recording cancelled.' });
  expect(h.events).toEqual([]);
});

it.each(['error', 'close', 'malformed', 'provider', 'timeout', 'backpressure'] as const)('cleans up failed recordings and returns a safe error (%s)', async mode => {
  vi.useFakeTimers();
  const h = recording();
  const session = await h.starting;
  if (mode === 'error') h.socket.emit('error', new Error('secret'));
  if (mode === 'close') h.socket.emit('close');
  if (mode === 'malformed') h.socket.emit('message', Buffer.from('{'));
  if (mode === 'provider') h.socket.event({ type: 'error', error: { message: 'secret', code: 'invalid_api_key' } });
  if (mode === 'backpressure') {
    h.socket.bufferedAmount = 2 * 1024 * 1024;
    await expect(session.append(new ArrayBuffer(4))).rejects.toThrow('backlog');
  }
  if (mode === 'timeout') await session.append(new Float32Array(2400).buffer);
  const stopped = session.stop();
  if (mode === 'timeout') { h.socket.event({ type: 'session.updated' }); await vi.advanceTimersByTimeAsync(30_000); }
  expect((await stopped).error).toBeTruthy();
  expect(JSON.stringify(h.events)).not.toContain('secret');
  expect(h.socket.closed).toBe(true);
});

it('bounds startup and validates credentials/audio before transmitting, while isolating consumer failures', async () => {
  vi.useFakeTimers();
  const socket = new Socket();
  const starting = startOpenAISpeechSession({ sessionId: 'slow', sampleRate: 24000 }, () => { throw new Error('consumer'); }, {
    apiKey: 'secret', createWebSocket: () => socket as unknown as WebSocket,
  });
  const failed = expect(starting).rejects.toThrow('too long to connect');
  await vi.advanceTimersByTimeAsync(15_000);
  await failed;
  expect(socket.closed).toBe(true);
  await expect(startOpenAISpeechSession({ sessionId: 'bad', sampleRate: 0 }, () => {}, { apiKey: 'secret' })).rejects.toThrow('sample rate');
  await expect(startOpenAISpeechSession({ sessionId: 'bad', sampleRate: 24000 }, () => {}, { apiKey: ' ' })).rejects.toThrow('API key');
  const h = recording();
  const session = await h.starting;
  cleanups.push(session.cancel);
  await expect(session.append(new ArrayBuffer(3))).rejects.toThrow('Invalid PCM');
  await expect(session.append(new Float32Array([NaN]).buffer)).rejects.toThrow('Invalid PCM');
  expect(h.socket.frames).toHaveLength(1);
  for (let i = 0; i < 100; i++) await session.append(new ArrayBuffer(256 * 1024));
  await expect(session.append(new ArrayBuffer(4))).rejects.toThrow('byte limit');
  expect((await session.stop()).error).toContain('byte limit');
});

it.each(['gpt-live-transcribe', 'gpt-transcribe'])('uses a real WebSocket upgrade and drains %s at commit', async model => {
  const { WebSocket: Client, WebSocketServer } = await import('ws');
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>(resolve => server.once('listening', resolve));
  let authorization: string | undefined;
  let audioBytes = 0;
  let configured: unknown;
  server.on('connection', (socket, request) => {
    authorization = request.headers.authorization;
    socket.on('message', data => {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'session.update') {
        configured = frame.session;
        socket.send(JSON.stringify({ type: 'session.updated' }));
      }
      if (frame.type === 'input_audio_buffer.append') {
        audioBytes += Buffer.from(frame.audio, 'base64').length;
        if (model === 'gpt-live-transcribe') socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'live', delta: 'Hello' }));
      }
      if (frame.type === 'input_audio_buffer.commit') {
        if (model === 'gpt-transcribe') socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'live', delta: 'Hello' }));
        socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'live' }));
        socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'live', transcript: 'Hello world.' }));
      }
    });
  });
  const events: CodexSpeechSessionEvent[] = [];
  let session: Awaited<ReturnType<typeof startOpenAISpeechSession>> | undefined;
  try {
    const address = server.address() as { port: number };
    session = await startOpenAISpeechSession({ sessionId: 'real', sampleRate: 16000 }, event => events.push(event), {
      apiKey: 'test-only', model, createWebSocket: (_url, options) => new Client(`ws://127.0.0.1:${address.port}`, options),
    });
    await session.append(new Float32Array(1600).buffer);
    if (model === 'gpt-live-transcribe') await vi.waitFor(() => expect(events).toHaveLength(1));
    else expect(events).toEqual([]);
    expect(await session.stop()).toEqual({ text: 'Hello world.' });
    expect(authorization).toBe('Bearer test-only');
    expect(configured).toMatchObject({ type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, turn_detection: null } } });
    expect(audioBytes).toBe(4800);
    expect(events).toContainEqual({ type: 'transcript', sessionId: 'real', finalText: '', partialText: 'Hello' });
    expect(events.at(-1)).toEqual({ type: 'transcript', sessionId: 'real', finalText: 'Hello world.', partialText: '' });
  } finally {
    await session?.cancel();
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


it('keeps model/language selection host-owned and handles sub-sample chunks without empty appends', async () => {
  const h = recording(96000, 'zh-CN', { model: 'gpt-4o-transcribe' });
  const session = await h.starting;
  cleanups.push(session.cancel);
  expect(h.socket.frames[0]).toMatchObject({ session: { audio: { input: {
    transcription: { model: 'gpt-4o-transcribe', language: 'zh-cn' },
  } } } });
  await session.append(new Float32Array([1]).buffer);
  await session.append(new Float32Array([1]).buffer);
  expect(h.socket.frames.filter(frame => frame.type === 'input_audio_buffer.append')).toHaveLength(1);
  const stopping = session.stop();
  // Duplicate configuration acknowledgements must not disable the finalization deadline.
  h.socket.event({ type: 'session.updated' });
  await session.cancel();
  expect((await stopping).error).toContain('cancelled');
});

it.each(['frame', 'transcript', 'failed'] as const)('bounds provider output and rejects transcription failures (%s)', async kind => {
  const h = recording();
  const session = await h.starting;
  if (kind === 'frame') h.socket.emit('message', Buffer.alloc(1024 * 1024 + 1));
  if (kind === 'transcript') {
    for (let i = 0; i < 3; i++) h.socket.event({ type: 'conversation.item.input_audio_transcription.delta', delta: 'a'.repeat(400_000) });
  }
  if (kind === 'failed') h.socket.event({ type: 'conversation.item.input_audio_transcription.failed', error: { message: 'private' } });
  expect((await session.stop()).error).toBeTruthy();
  expect(h.socket.closed).toBe(true);
  expect(h.events.at(-1)?.type).toBe('error');
});

it.each(['gpt-live-transcribe', 'gpt-transcribe'])('prepares %s without a source rate, activates once at the real rate, and cancels cleanly', async model => {
  const { prepareOpenAISpeechSession } = await import('../src/node/openai-speech-session');
  const socket = new Socket();
  const preparing = prepareOpenAISpeechSession({ sessionId: 'prepared', locale: 'fr-FR' }, () => {}, {
    apiKey: 'test-only', model, createWebSocket: () => socket as unknown as WebSocket,
  });
  socket.emit('open');
  socket.event({ type: 'session.updated' });
  const prepared = await preparing;
  cleanups.push(prepared.cancel);
  expect(socket.frames).toEqual([{ type: 'session.update', session: { type: 'transcription', audio: { input: {
    format: { type: 'audio/pcm', rate: 24000 },
    transcription: { model, ...(model === 'gpt-live-transcribe' ? { languages: ['fr'] } : { language: 'fr' }) },
    turn_detection: null,
  } } } }]);
  await expect(prepared.start(0)).rejects.toThrow('sample rate');
  const session = await prepared.start(48000);
  await expect(prepared.start(16000)).rejects.toThrow('already active');
  await session.append(new Float32Array(4800).buffer);
  expect(Buffer.from(socket.frames[1]!.audio, 'base64').length).toBe(4800);
  await prepared.cancel();
  expect((await session.stop()).error).toContain('cancelled');
  await expect(prepared.start(44100)).rejects.toThrow('no longer');
});
