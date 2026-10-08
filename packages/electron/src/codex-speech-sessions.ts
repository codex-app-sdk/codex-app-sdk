import { startAppleSpeechSession, type AppleSpeechSession } from '@codex-app-sdk/backend';
import type { CodexSpeechSessionOptions, CodexSpeechTranscriptionResult } from '@codex-app-sdk/core/native';
import { codexNativeChannels as channels, codexSpeechEventChannel, type CodexNativeRequests } from './codex-native-renderer';
import type { IpcMainHandlers } from './typed-ipc';
import type { WebContentsDidStartNavigationEventParams } from 'electron';

type Owner = {
  sender: {
    on(name: string, listener: (...args: unknown[]) => void): unknown;
    removeListener(name: string, listener: (...args: unknown[]) => void): unknown;
  };
  senderFrame: { processId: number; routingId: number; send(name: string, event: unknown): void };
};
type Entry = {
  owner: Owner;
  abort: AbortController;
  session: Promise<AppleSpeechSession>;
  stopping?: Promise<CodexSpeechTranscriptionResult>;
  bytes: number;
  cleanup: () => void;
};
type SpeechChannels = typeof channels.startSpeech | typeof channels.appendSpeech | typeof channels.stopSpeech | typeof channels.cancelSpeech;

/** One bounded recording per renderer, owned by its invoking frame. */
export function createCodexSpeechSessions(options: {
  maxAudioBytes: number;
  appleSpeechAssetsPath?: string;
  startSpeechSession?: typeof startAppleSpeechSession;
}): { handlers: IpcMainHandlers<Pick<CodexNativeRequests, SpeechChannels>>; dispose(): void } {
  const sessions = new Map<string, Entry>();
  const start = options.startSpeechSession ?? startAppleSpeechSession;
  function owner(value: unknown): Owner {
    const event = value as Partial<Owner> | null;
    if (!event?.sender?.on || !event.sender.removeListener || !event.senderFrame?.send) {
      throw new Error('Speech requires an owning renderer frame.');
    }
    return event as Owner;
  }
  function get(event: unknown, id: string): Entry {
    const current = owner(event);
    const entry = sessions.get(id);
    if (!entry || entry.owner.sender !== current.sender || entry.owner.senderFrame !== current.senderFrame) {
      throw new Error('Speech session owner does not match.');
    }
    return entry;
  }
  async function cancel(id: string, entry: Entry): Promise<void> {
    if (sessions.get(id) !== entry) return;
    sessions.delete(id);
    entry.cleanup();
    entry.abort.abort();
    await entry.session.then((session) => session.cancel()).catch(() => undefined);
  }
  return {
    handlers: {
      [channels.startSpeech]: async (event, raw) => {
        const input = raw as CodexSpeechSessionOptions | null;
        if (!input || typeof input.sessionId !== 'string' || !/^[\w-]{1,128}$/.test(input.sessionId)
          || !Number.isInteger(input.sampleRate) || input.sampleRate < 8000 || input.sampleRate > 96000
          || (input.locale !== undefined && (typeof input.locale !== 'string' || input.locale.length > 128))) {
          throw new TypeError('Invalid speech session options.');
        }
        const current = owner(event);
        if (sessions.has(input.sessionId) || [...sessions.values()].some((entry) => entry.owner.sender === current.sender)) {
          throw new Error('A speech session is already active in this renderer.');
        }
        const id = input.sessionId;
        const abort = new AbortController();
        const teardown = () => { void cancel(id, entry); };
        const onNavigation = (details: unknown, _url: unknown, sameDocument: unknown, mainFrame: unknown, processId: unknown, routingId: unknown) => {
          const navigation = details as Partial<WebContentsDidStartNavigationEventParams>;
          const frame = navigation.frame ?? { processId, routingId };
          // Older Electron versions supply positional arguments instead of details.
          if (!(navigation.isSameDocument ?? sameDocument) && ((navigation.isMainFrame ?? mainFrame)
            || (frame.processId === current.senderFrame.processId && frame.routingId === current.senderFrame.routingId))) teardown();
        };
        const entry: Entry = {
          owner: current, abort, bytes: 0,
          // Defer startup until the entry exists, including synchronous custom adapters.
          session: Promise.resolve().then(() => start(input, (result) => {
            if (sessions.get(id) !== entry) return;
            try { current.senderFrame.send(codexSpeechEventChannel, result); }
            catch { teardown(); }
            if (result.type === 'error') teardown();
          }, { assetsPath: options.appleSpeechAssetsPath, signal: abort.signal })),
          cleanup: () => {
            for (const name of ['destroyed', 'render-process-gone']) current.sender.removeListener(name, teardown);
            current.sender.removeListener('did-start-navigation', onNavigation);
          },
        };
        sessions.set(id, entry);
        for (const name of ['destroyed', 'render-process-gone']) current.sender.on(name, teardown);
        current.sender.on('did-start-navigation', onNavigation);
        try { await entry.session; }
        catch (error) { await cancel(id, entry); throw error; }
        if (abort.signal.aborted) throw new Error('Speech recording cancelled.');
      },
      [channels.appendSpeech]: async (event, id, audio) => {
        const entry = get(event, id);
        if (entry.stopping) throw new Error('Speech session is finalizing.');
        if (!(audio instanceof ArrayBuffer) || !audio.byteLength || audio.byteLength % 4 || audio.byteLength > 256 * 1024) {
          throw new TypeError('Invalid PCM audio chunk.');
        }
        entry.bytes += audio.byteLength;
        if (entry.bytes > options.maxAudioBytes) {
          await cancel(id, entry);
          throw new RangeError('Speech recording exceeds the audio byte limit.');
        }
        await (await entry.session).append(audio);
      },
      [channels.stopSpeech]: async (event, id) => {
        const entry = get(event, id);
        entry.stopping ??= entry.session.then((session) => session.stop()).finally(() => {
          sessions.delete(id);
          entry.cleanup();
        });
        return entry.stopping;
      },
      [channels.cancelSpeech]: async (event, id) => {
        // A final result/error may already have removed this session.
        if (!sessions.has(id)) return;
        await cancel(id, get(event, id));
      },
    },
    dispose: () => { for (const [id, entry] of sessions) void cancel(id, entry); },
  };
}
