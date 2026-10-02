import { onScopeDispose, readonly, ref } from 'vue';
import type { CodexSurfaceEvent, CodexSurfaceRendererApi, StartCodexLiveChatOptions } from '@codex-app-sdk/core/surface';

export type CodexLiveChatStatus = 'idle' | 'connecting' | 'connected' | 'stopping' | 'error';
export type CodexLiveChatTranscript = { id: string; role: string; text: string; complete: boolean };
export type CodexLiveChatOptions = {
  surface: Pick<CodexSurfaceRendererApi, 'startLiveChat' | 'stopLiveChat' | 'onEvent'>;
  conversationId: string;
  session?: Omit<StartCodexLiveChatOptions, 'sdp'>;
};

type LiveChatAttempt = {
  cancelled: boolean;
  requested: boolean;
  ended: boolean;
  stream?: MediaStream;
  peer?: RTCPeerConnection;
  audio?: HTMLAudioElement;
  unsubscribe?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  done?: Promise<void>;
  stopping?: Promise<void>;
};

/** Call start from a user gesture. Each instance belongs to one conversation. */
export function useCodexLiveChat(options: CodexLiveChatOptions) {
  const status = ref<CodexLiveChatStatus>('idle');
  const error = ref<string | null>(null);
  const muted = ref(false);
  const transcript = ref<CodexLiveChatTranscript[]>([]);
  let attempt: LiveChatAttempt | undefined;
  let disposed = false;

  function onEvent(event: CodexSurfaceEvent): void {
    if (!('conversationId' in event) || event.conversationId !== options.conversationId) return;
    if (event.type === 'realtime.error') {
      error.value = event.payload.message;
      void stop().catch(() => undefined);
    } else if (event.type === 'realtime.closed') {
      if (attempt) attempt.ended = true;
      void stop().catch(() => undefined);
    } else if (event.type === 'realtime.itemStarted' || event.type === 'realtime.itemCompleted') {
      const item = event.payload.item;
      if (!item || typeof item !== 'object' || Array.isArray(item) || item.type !== 'transcriptSegment'
        || typeof item.id !== 'string' || typeof item.role !== 'string' || typeof item.text !== 'string') return;
      const row = { id: item.id, role: item.role, text: item.text, complete: event.type === 'realtime.itemCompleted' };
      const index = transcript.value.findIndex((entry) => entry.id === row.id);
      if (index === -1) transcript.value.push(row);
      else transcript.value[index] = row;
    } else if (event.type === 'realtime.itemTranscriptDelta') {
      const row = transcript.value.find((entry) => entry.id === event.payload.itemId);
      if (row && !row.complete) row.text += event.payload.delta;
    } else if (event.type === 'realtime.transcriptDelta' || event.type === 'realtime.transcriptCompleted') {
      // V3 also emits legacy notifications; consuming both duplicates every word.
      if ((options.session?.version ?? 'v3') === 'v3') return;
      let row = transcript.value.at(-1);
      if (!row || row.complete || row.role !== event.payload.role) {
        row = { id: `legacy-${transcript.value.length}`, role: event.payload.role, text: '', complete: false };
        transcript.value.push(row);
        row = transcript.value.at(-1)!;
      }
      if (event.type === 'realtime.transcriptDelta') row.text += event.payload.delta;
      else { row.text = event.payload.text; row.complete = true; }
    }
  }

  function release(current: LiveChatAttempt): void {
    clearTimeout(current.timer);
    current.unsubscribe?.();
    current.unsubscribe = undefined;
    if (current.peer) {
      current.peer.onconnectionstatechange = null;
      current.peer.ontrack = null;
      current.peer.close();
    }
    current.stream?.getTracks().forEach((track) => track.stop());
    if (current.audio) {
      current.audio.pause();
      current.audio.srcObject = null;
    }
  }

  async function stopBackend(current: LiveChatAttempt): Promise<void> {
    if (current.requested && !current.ended) {
      current.ended = true;
      await options.surface.stopLiveChat!(options.conversationId);
    }
  }

  function start(): Promise<void> {
    if (disposed) return Promise.reject(new Error('Live chat has been disposed'));
    if (attempt) return attempt.done ?? Promise.resolve();
    status.value = 'connecting';
    error.value = null;
    muted.value = false;
    transcript.value = [];
    const current: LiveChatAttempt = { cancelled: false, requested: false, ended: false };
    attempt = current;
    current.done = (async () => {
      try {
        if (!options.surface.startLiveChat || !options.surface.stopLiveChat) throw new Error('This surface does not support live chat');
        current.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        if (current.cancelled) return;
        const peer = new RTCPeerConnection();
        current.peer = peer;
        const audio = new Audio();
        audio.autoplay = true;
        current.audio = audio;
        peer.ontrack = (event) => {
          audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
          void audio.play().catch((cause: unknown) => {
            if (current.cancelled) return;
            error.value = message(cause);
            void stop().catch(() => undefined);
          });
        };
        peer.onconnectionstatechange = () => {
          if (current.cancelled) return;
          if (peer.connectionState === 'connected') {
            clearTimeout(current.timer);
            status.value = 'connected';
          }
          if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
            error.value = 'Live chat connection ended';
            void stop().catch(() => undefined);
          }
        };
        current.stream.getTracks().forEach((track) => { track.enabled = !muted.value; peer.addTrack(track, current.stream!); });
        peer.createDataChannel('oai-events');
        current.unsubscribe = options.surface.onEvent(onEvent);
        await peer.setLocalDescription(await peer.createOffer());
        if (current.cancelled) return;
        current.requested = true;
        const answer = await options.surface.startLiveChat(options.conversationId, {
          ...options.session, sdp: peer.localDescription!.sdp,
        });
        if (current.cancelled) return;
        await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
        if (!current.cancelled && peer.connectionState !== 'connected') {
          current.timer = setTimeout(() => {
            error.value = 'Timed out connecting live chat';
            void stop().catch(() => undefined);
          }, 30_000);
        }
      } catch (cause) {
        if (!current.cancelled) {
          error.value = message(cause);
          status.value = 'error';
          release(current);
          await stopBackend(current).catch(() => undefined);
          if (attempt === current) attempt = undefined;
          throw cause;
        }
      } finally {
        if (current.cancelled) release(current);
      }
    })();
    return current.done;
  }

  function stop(): Promise<void> {
    const current = attempt;
    if (!current) return Promise.resolve();
    if (current.stopping) return current.stopping;
    current.cancelled = true;
    status.value = 'stopping';
    release(current);
    current.stopping = (async () => {
      try {
        if (current.requested) await current.done?.catch(() => undefined);
        await stopBackend(current);
      } catch (cause) {
        error.value = message(cause);
        throw cause;
      } finally {
        if (attempt === current) attempt = undefined;
        status.value = error.value ? 'error' : 'idle';
      }
    })();
    return current.stopping;
  }

  function setMuted(value: boolean): void {
    muted.value = value;
    attempt?.stream?.getAudioTracks().forEach((track) => { track.enabled = !value; });
  }

  onScopeDispose(() => { disposed = true; void stop().catch(() => undefined); });
  return { status: readonly(status), error: readonly(error), muted: readonly(muted), transcript: readonly(transcript), start, stop, setMuted };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
