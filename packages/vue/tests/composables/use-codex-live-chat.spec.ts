import { effectScope, type EffectScope } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexRealtimeEvent, CodexSurfaceEvent } from '@codex-app-sdk/core/surface';
import { useCodexLiveChat, type CodexLiveChatOptions } from '../../src/use-codex-live-chat';

const scopes: EffectScope[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fixture(session: CodexLiveChatOptions['session'] = {}) {
  const track = { enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  const peers: Peer[] = [];
  class Peer {
    localDescription = { type: 'offer', sdp: 'browser-offer' };
    remoteDescription: unknown;
    connectionState = 'new';
    ontrack: ((event: unknown) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;
    tracks: unknown[] = [];
    channel: string | undefined;
    constructor() { peers.push(this); }
    addTrack(value: unknown) { this.tracks.push(value); }
    createDataChannel(name: string) { this.channel = name; }
    async createOffer() { return this.localDescription; }
    async setLocalDescription(value: typeof this.localDescription) { this.localDescription = value; }
    async setRemoteDescription(value: unknown) { this.remoteDescription = value; }
    close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
    state(value: string) { this.connectionState = value; this.onconnectionstatechange?.(); }
  }
  const audio = { autoplay: false, srcObject: null, play: vi.fn(async () => undefined), pause: vi.fn() };
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('RTCPeerConnection', Peer);
  vi.stubGlobal('Audio', class { constructor() { return audio; } });
  vi.stubGlobal('MediaStream', class { constructor() { return stream; } });
  const listeners = new Set<(event: CodexSurfaceEvent) => void>();
  const api = {
    startLiveChat: vi.fn(async (_id: string, _options: unknown) => ({ sdp: 'server-answer' })),
    stopLiveChat: vi.fn(async (_id: string) => undefined),
    onEvent(listener: (event: CodexSurfaceEvent) => void) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const scope = effectScope();
  scopes.push(scope);
  const chat = scope.run(() => useCodexLiveChat({ surface: api, conversationId: 'thread', session: { voice: 'marin', ...session } }))!;
  type Input<Event> = Event extends unknown ? Pick<Event, Extract<keyof Event, 'type' | 'payload'>> : never;
  function emit(event: Input<CodexRealtimeEvent>, conversationId = 'thread') {
    listeners.forEach((listener) => listener({ ...event, conversationId, seq: 1, occurredAt: '', origin: 'notification' } as CodexRealtimeEvent));
  }
  return { chat, scope, api, peers, track, stream, audio, getUserMedia, listeners, emit };
}

describe('useCodexLiveChat', () => {
  it('negotiates once, streams scoped transcripts, mutes media and releases the session on stop', async () => {
    const f = fixture();
    const first = f.chat.start();
    expect(f.chat.start()).toBe(first);
    expect(f.chat.status.value).toBe('connecting');
    await first;
    const peer = f.peers[0]!;
    expect(f.api.startLiveChat).toHaveBeenCalledExactlyOnceWith('thread', { sdp: 'browser-offer', voice: 'marin' });
    expect(peer.remoteDescription).toEqual({ type: 'answer', sdp: 'server-answer' });
    expect(peer.tracks).toEqual([f.track]);
    expect(peer.channel).toBe('oai-events');
    peer.state('connected');
    peer.ontrack?.({ streams: [f.stream] });
    expect(f.audio.srcObject).toBe(f.stream);
    expect(f.chat.status.value).toBe('connected');
    f.chat.setMuted(true);
    expect(f.track.enabled).toBe(false);
    f.chat.setMuted(false);
    expect(f.track.enabled).toBe(true);
    const item = { type: 'transcriptSegment', id: 'speech', role: 'user', text: '' };
    f.emit({ type: 'realtime.itemStarted', payload: { item } }, 'other-thread');
    f.emit({ type: 'realtime.itemStarted', payload: { item: { type: 'realtimeSessionStarted' } } });
    expect(f.chat.transcript.value).toEqual([]);
    f.emit({ type: 'realtime.itemStarted', payload: { item } });
    f.emit({ type: 'realtime.transcriptDelta', payload: { role: 'user', delta: 'Hello' } });
    f.emit({ type: 'realtime.itemTranscriptDelta', payload: { itemId: 'speech', delta: 'Hello' } });
    expect(f.chat.transcript.value).toEqual([{ id: 'speech', role: 'user', text: 'Hello', complete: false }]);
    f.emit({ type: 'realtime.itemCompleted', payload: { item: { ...item, text: 'Hello!' } } });
    f.emit({ type: 'realtime.transcriptCompleted', payload: { role: 'user', text: 'Hello!' } });
    f.emit({ type: 'realtime.itemTranscriptDelta', payload: { itemId: 'speech', delta: 'late' } });
    expect(f.chat.transcript.value[0]?.text).toBe('Hello!');
    expect(f.chat.transcript.value[0]?.complete).toBe(true);
    expect(f.chat.transcript.value).toHaveLength(1);
    const stop = f.chat.stop();
    expect(f.chat.stop()).toBe(stop);
    await stop;
    expect(f.api.stopLiveChat).toHaveBeenCalledExactlyOnceWith('thread');
    expect(f.track.readyState).toBe('ended');
    expect(peer.connectionState).toBe('closed');
    expect(f.audio.srcObject).toBeNull();
    expect(f.listeners.size).toBe(0);
    expect(f.chat.status.value).toBe('idle');
    await f.chat.stop();
    expect(f.api.stopLiveChat).toHaveBeenCalledTimes(1);
  });

  it('cancels pending microphone permission without opening a late session', async () => {
    const f = fixture();
    const media = deferred<typeof f.stream>();
    f.getUserMedia.mockReturnValueOnce(media.promise);
    const start = f.chat.start();
    await f.chat.stop();
    expect(f.chat.status.value).toBe('idle');
    media.resolve(f.stream);
    await start;
    expect(f.track.readyState).toBe('ended');
    expect(f.api.startLiveChat).not.toHaveBeenCalled();
  });

  it('stops a session whose answer arrives after disposal', async () => {
    const f = fixture();
    const answer = deferred<{ sdp: string }>();
    f.api.startLiveChat.mockReturnValueOnce(answer.promise);
    const start = f.chat.start();
    await vi.waitFor(() => expect(f.api.startLiveChat).toHaveBeenCalled());
    f.scope.stop();
    expect(f.track.readyState).toBe('ended');
    answer.resolve({ sdp: 'late-answer' });
    await start;
    await vi.waitFor(() => expect(f.chat.status.value).toBe('idle'));
    expect(f.peers[0]?.remoteDescription).toBeUndefined();
    expect(f.api.stopLiveChat).toHaveBeenCalledExactlyOnceWith('thread');
    await expect(f.chat.start()).rejects.toThrow('disposed');
  });

  it('cleans up failed signaling and allows a retry with legacy transcript delivery', async () => {
    const f = fixture({ version: 'v2' });
    f.api.startLiveChat.mockRejectedValueOnce(new Error('Realtime unavailable'));
    await expect(f.chat.start()).rejects.toThrow('Realtime unavailable');
    expect(f.chat.error.value).toBe('Realtime unavailable');
    expect(f.chat.status.value).toBe('error');
    expect(f.track.readyState).toBe('ended');
    expect(f.listeners.size).toBe(0);
    await f.chat.start();
    expect(f.chat.error.value).toBeNull();
    f.emit({ type: 'realtime.transcriptDelta', payload: { role: 'assistant', delta: 'Hi' } });
    f.emit({ type: 'realtime.transcriptDelta', payload: { role: 'assistant', delta: ' there' } });
    expect(f.chat.transcript.value[0]?.text).toBe('Hi there');
    f.emit({ type: 'realtime.transcriptCompleted', payload: { role: 'assistant', text: 'Hi there!' } });
    f.emit({ type: 'realtime.transcriptCompleted', payload: { role: 'user', text: 'Hello' } });
    expect(f.chat.transcript.value.map(({ text, complete }) => ({ text, complete }))).toEqual([
      { text: 'Hi there!', complete: true }, { text: 'Hello', complete: true },
    ]);
    f.emit({ type: 'realtime.closed', payload: { reason: 'requested' } });
    await vi.waitFor(() => expect(f.chat.status.value).toBe('idle'));
    expect(f.api.stopLiveChat).toHaveBeenCalledTimes(1); // Failed attempt only; server already closed the retry.
  });

  it.each(['connection', 'timeout', 'playback', 'server'] as const)('releases audio on %s failure and exposes the error', async (failure) => {
    const f = fixture();
    vi.useFakeTimers();
    await f.chat.start();
    if (failure === 'connection') f.peers[0]!.state('failed');
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
    if (failure === 'playback') {
      f.audio.play.mockRejectedValueOnce(new Error('Playback blocked'));
      f.peers[0]!.ontrack?.({ streams: [], track: f.track });
    }
    if (failure === 'server') f.emit({ type: 'realtime.error', payload: { message: 'Service stopped' } });
    await vi.waitFor(() => expect(f.chat.status.value).toBe('error'));
    expect(f.chat.error.value).toBeTruthy();
    expect(f.track.readyState).toBe('ended');
    expect(f.peers[0]?.connectionState).toBe('closed');
    expect(f.listeners.size).toBe(0);
    expect(f.api.stopLiveChat).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected stop without leaving the microphone or peer running', async () => {
    const f = fixture();
    await f.chat.start();
    f.api.stopLiveChat.mockRejectedValueOnce(new Error('Server disconnected'));
    await expect(f.chat.stop()).rejects.toThrow('Server disconnected');
    expect(f.chat.status.value).toBe('error');
    expect(f.chat.error.value).toBe('Server disconnected');
    expect(f.track.readyState).toBe('ended');
    expect(f.peers[0]?.connectionState).toBe('closed');
    expect(f.listeners.size).toBe(0);
  });

  it('reports denied microphone access without opening a backend session', async () => {
    const f = fixture();
    f.getUserMedia.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(f.chat.start()).rejects.toThrow('Permission denied');
    expect(f.chat.status.value).toBe('error');
    expect(f.chat.error.value).toBe('Permission denied');
    expect(f.api.startLiveChat).not.toHaveBeenCalled();
    expect(f.api.stopLiveChat).not.toHaveBeenCalled();
    expect(f.peers).toEqual([]);
  });

  it.each(['startLiveChat', 'stopLiveChat'])('rejects a host missing %s before requesting microphone access', async (method) => {
    const f = fixture();
    Reflect.deleteProperty(f.api, method);
    await expect(f.chat.start()).rejects.toThrow('This surface does not support live chat');
    expect(f.chat.status.value).toBe('error');
    expect(f.getUserMedia).not.toHaveBeenCalled();
  });

  it('ignores a late playback rejection after the session has stopped', async () => {
    const f = fixture();
    let rejectPlayback!: (error: Error) => void;
    const playback = new Promise<undefined>((_resolve, reject) => { rejectPlayback = reject; });
    f.audio.play.mockReturnValueOnce(playback);
    await f.chat.start();
    f.peers[0]!.ontrack?.({ streams: [f.stream] });
    await f.chat.stop();
    rejectPlayback(new Error('Playback aborted'));
    await playback.catch(() => undefined);
    expect(f.chat.status.value).toBe('idle');
    expect(f.chat.error.value).toBeNull();
  });
});
