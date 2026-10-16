import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CodexSpeechSessionEvent, CodexSpeechSessionOptions, CodexSpeechTranscriptionResult } from '@codex-app-sdk/core/native';

export type SherpaSpeechSession = {
  append(audio: ArrayBuffer): Promise<void>;
  stop(): Promise<CodexSpeechTranscriptionResult>;
  cancel(): Promise<void>;
};

/** Local streaming transducer files; the SDK never downloads models. */
export type SherpaSpeechOptions = {
  model: { encoder: string; decoder: string; joiner: string; tokens: string; sampleRate?: number; language?: string };
  numThreads?: number;
  /** Retain the recognizer after the last stream closes. Default: 30 seconds. */
  idleTimeoutMs?: number;
  /** Deadline for model loading and individual IPC operations. Default: 120 seconds. */
  requestTimeoutMs?: number;
  /** Unpacked SDK helper path for custom Electron packaging. */
  helperPath?: string;
  /** Node-compatible executable. Electron uses ELECTRON_RUN_AS_NODE. */
  executablePath?: string;
};
export type SherpaSpeechService = {
  startSession(options: CodexSpeechSessionOptions, onEvent: (event: CodexSpeechSessionEvent) => void,
    dependencies?: { signal?: AbortSignal }): Promise<SherpaSpeechSession>;
  /** Optional anticipation of recording; never called by constructing the service. */
  preload(): Promise<void>;
  dispose(): Promise<void>;
  readonly processId: number | undefined;
};
type Reply = { requestId?: number; token?: string; type?: string; text?: string; error?: string; finalText?: string; partialText?: string };
type Worker = {
  child: ChildProcess; ready: Promise<void>; exit: Promise<void>; retiring: boolean;
  pending: Map<number, { resolve: (value: Reply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
};
type Entry = { id: string; token: string; worker?: Worker; closed: boolean; stopping: boolean;
  done: Promise<CodexSpeechTranscriptionResult>; complete: (result: CodexSpeechTranscriptionResult) => void;
  publish: (event: CodexSpeechSessionEvent) => void; cleanup: () => void };

/** One process/recognizer per service, independent streams per recording. */
export function createSherpaSpeechService(options: SherpaSpeechOptions): SherpaSpeechService {
  const idleMs = positive(options.idleTimeoutMs ?? 30_000, 'Idle timeout', true);
  const requestMs = positive(options.requestTimeoutMs ?? 120_000, 'Request timeout');
  const numThreads = positive(options.numThreads ?? 2, 'Thread count');
  const model = { ...options.model, sampleRate: options.model.sampleRate ?? 16000 };
  for (const key of ['encoder', 'decoder', 'joiner', 'tokens'] as const) {
    if (typeof model[key] !== 'string' || !path.isAbsolute(model[key])) throw new TypeError('Sherpa model paths must be absolute local paths.');
  }
  positive(model.sampleRate, 'Model sample rate');
  const helperPath = options.helperPath ?? resolveSherpaSpeechHelperPath();
  const sessions = new Map<string, Entry>();
  let worker: Worker | undefined;
  let disposed = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  function clearIdle() { clearTimeout(idle); idle = undefined; }
  function finish(entry: Entry, result: CodexSpeechTranscriptionResult) {
    if (entry.closed) return;
    entry.closed = true;
    sessions.delete(entry.id);
    entry.cleanup();
    entry.complete(result);
    armIdle();
  }
  function fail(current: Worker, error: Error) {
    current.retiring = true;
    for (const pending of current.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    current.pending.clear();
    for (const entry of sessions.values()) if (entry.worker === current) {
      entry.publish({ type: 'error', sessionId: entry.id, error: error.message });
      finish(entry, { text: '', error: error.message });
    }
    current.child.kill('SIGKILL');
  }
  function request(current: Worker, data: object): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const requestId = ++sequence;
      const timer = setTimeout(() => fail(current, new Error('Sherpa speech helper operation timed out.')), requestMs);
      current.pending.set(requestId, { resolve, reject, timer });
      current.child.send({ ...data, requestId }, (error) => { if (error) fail(current, error); });
    });
  }
  async function retire(current: Worker): Promise<void> {
    if (!current.retiring) {
      current.retiring = true;
      // Mark retirement before yielding: a new start waits for actual process exit.
      if (current.child.connected) current.child.send({ type: 'shutdown' }, () => {});
    }
    const kill = setTimeout(() => current.child.kill('SIGKILL'), 1000);
    await current.exit;
    clearTimeout(kill);
  }
  function armIdle() {
    clearIdle();
    if (disposed || sessions.size || !worker || worker.retiring) return;
    const current = worker;
    idle = setTimeout(() => { idle = undefined; void retire(current); }, idleMs);
  }
  async function ensureWorker(): Promise<Worker> {
    clearIdle();
    if (disposed) throw new Error('Sherpa speech service is disposed.');
    if (worker?.retiring) await worker.exit;
    if (disposed) throw new Error('Sherpa speech service is disposed.');
    if (!worker) {
      const child = fork(helperPath, [], { execPath: options.executablePath ?? process.execPath, execArgv: [],
        serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      let exited!: () => void;
      const current: Worker = { child, retiring: false, pending: new Map(), ready: Promise.resolve(),
        exit: new Promise<void>((resolve) => { exited = resolve; }) };
      worker = current;
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096); });
      child.on('message', (raw: unknown) => {
        if (current.retiring) return;
        if (!raw || typeof raw !== 'object') { fail(current, new Error('Invalid Sherpa speech helper output.')); return; }
        const reply = raw as Reply;
        if (Number.isInteger(reply.requestId)) {
          const pending = current.pending.get(reply.requestId!);
          if (!pending) return;
          current.pending.delete(reply.requestId!); clearTimeout(pending.timer);
          if (typeof reply.error === 'string') {
            const error = new Error(reply.error); pending.reject(error); fail(current, error);
          } else pending.resolve(reply);
        } else if (reply.type === 'transcript' && typeof reply.token === 'string'
          && typeof reply.finalText === 'string' && typeof reply.partialText === 'string') {
          const entry = [...sessions.values()].find((session) => session.token === reply.token && session.worker === current);
          if (entry && !entry.closed && !entry.stopping) entry.publish({ type: 'transcript', sessionId: entry.id,
            finalText: reply.finalText, partialText: reply.partialText });
        } else fail(current, new Error('Invalid Sherpa speech helper output.'));
      });
      child.on('error', (error) => fail(current, error));
      child.on('exit', (code, signal) => {
        if (!current.retiring || current.pending.size) fail(current, new Error(stderr.trim() || `Sherpa speech helper exited (${code ?? signal}).`));
        if (worker === current) worker = undefined;
        exited();
      });
      // A failed spawn has no exit event; close still releases waiters.
      child.on('close', () => { if (worker === current) worker = undefined; exited(); });
      current.ready = request(current, { type: 'load', model, numThreads }).then(() => {});
      // A concurrently cancelled starter may cease awaiting this promise.
      void current.ready.catch(() => {});
    }
    const current = worker;
    await current.ready;
    if (current.retiring) { await current.exit; return ensureWorker(); }
    return current;
  }
  async function startSession(input: CodexSpeechSessionOptions, onEvent: (event: CodexSpeechSessionEvent) => void,
    dependencies: { signal?: AbortSignal } = {}): Promise<SherpaSpeechSession> {
    if (!/^[\w-]{1,128}$/.test(input.sessionId)) throw new TypeError('Invalid speech session ID.');
    if (!Number.isInteger(input.sampleRate) || input.sampleRate < 8000 || input.sampleRate > 96000) throw new TypeError('Unsupported speech sample rate.');
    if (model.language && input.locale && input.locale.toLowerCase().split('-')[0] !== model.language.toLowerCase().split('-')[0]) {
      throw new Error(`Sherpa model language is ${model.language}.`);
    }
    if (sessions.has(input.sessionId)) throw new Error('Speech session is already active.');
    if (dependencies.signal?.aborted) throw new Error('Speech recording cancelled.');
    let complete!: Entry['complete'];
    const entry: Entry = { id: input.sessionId, token: String(++sequence), closed: false, stopping: false,
      done: new Promise((resolve) => { complete = resolve; }), complete: (value) => complete(value), cleanup: () => {},
      publish: (event) => { try { onEvent(event); } catch { /* Consumer failure cannot prevent cleanup. */ } } };
    sessions.set(entry.id, entry);
    clearIdle();
    async function cancel() {
      if (entry.closed) return;
      if (entry.stopping) {
        finish(entry, { text: '', error: 'Speech recording cancelled.' });
        return;
      }
      const current = entry.worker;
      // Hide events immediately, but retain the entry until the worker drops its stream.
      entry.stopping = true;
      try { if (current && !current.retiring) await request(current, { type: 'cancel', token: entry.token }); }
      catch { /* Process failure already completed the session. */ }
      finish(entry, { text: '', error: 'Speech recording cancelled.' });
    }
    const abort = () => { void cancel(); };
    entry.cleanup = () => dependencies.signal?.removeEventListener('abort', abort);
    dependencies.signal?.addEventListener('abort', abort, { once: true });
    try {
      const current = await ensureWorker();
      if (entry.closed || entry.stopping) throw new Error('Speech recording cancelled.');
      entry.worker = current;
      await request(current, { type: 'start', token: entry.token, sessionId: entry.id, sampleRate: input.sampleRate });
      if (entry.closed || entry.stopping) throw new Error('Speech recording cancelled.');
    } catch (error) {
      finish(entry, { text: '', error: error instanceof Error ? error.message : String(error) });
      armIdle();
      throw error;
    }
    return {
      append: async (audio) => {
        if (entry.closed || entry.stopping) throw new Error('Speech session is no longer recording.');
        if (!(audio instanceof ArrayBuffer) || !audio.byteLength || audio.byteLength % 4 || audio.byteLength > 256 * 1024) throw new TypeError('Invalid PCM audio chunk.');
        await request(entry.worker!, { type: 'append', token: entry.token, audio });
      },
      stop: () => {
        if (!entry.closed && !entry.stopping) {
          entry.stopping = true;
          void request(entry.worker!, { type: 'stop', token: entry.token }).then((result) => {
            if (typeof result.text !== 'string') { fail(entry.worker!, new Error('Invalid Sherpa final transcript.')); return; }
            finish(entry, { text: result.text });
          }).catch(() => {});
        }
        return entry.done;
      },
      cancel,
    };
  }
  return {
    startSession,
    preload: async () => { await ensureWorker(); armIdle(); },
    dispose: async () => {
      disposed = true; clearIdle();
      for (const entry of sessions.values()) finish(entry, { text: '', error: 'Sherpa speech service is disposed.' });
      if (worker) {
        const current = worker;
        fail(current, new Error('Sherpa speech service is disposed.'));
        await retire(current);
      }
    },
    get processId() { return worker?.child.pid; },
  };
}

export function resolveSherpaSpeechHelperPath(): string {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(directory, '../assets/sherpa-speech-helper.cjs'),
    path.resolve(directory, '../../assets/sherpa-speech-helper.cjs')];
  // Electron native modules and this child script must live outside the asar archive.
  const unpacked = candidates.map((candidate) => candidate.replace(/\.asar([/\\])/, '.asar.unpacked$1'));
  return [...unpacked, ...candidates].find(existsSync) ?? candidates[0]!;
}
function positive(value: number, label: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_647) throw new TypeError(`${label} must be a bounded ${allowZero ? 'nonnegative' : 'positive'} integer.`);
  return value;
}
