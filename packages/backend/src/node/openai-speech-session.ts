import WebSocket from 'ws';
import type { CodexSpeechSessionEvent, CodexSpeechSessionOptions, CodexSpeechTranscriptionResult, CodexSpeechPreparationOptions, CodexPreparedSpeechSession } from '@codex-app-sdk/core/native';

export type OpenAISpeechSession = {
  append(audio: ArrayBuffer): Promise<void>;
  stop(): Promise<CodexSpeechTranscriptionResult>;
  cancel(): Promise<void>;
};
export type OpenAISpeechData = Uint8Array | ArrayBuffer | Uint8Array[];
/** Minimal trusted-process transport contract; does not require ws types in consumers. */
export type OpenAISpeechSocket = {
  readonly bufferedAmount: number;
  send(data: string): void;
  close(): void;
  on(event: 'open' | 'error' | 'close', listener: () => void): unknown;
  on(event: 'message', listener: (data: OpenAISpeechData) => void): unknown;
  removeListener(event: 'open', listener: () => void): unknown;
  removeListener(event: 'message', listener: (data: OpenAISpeechData) => void): unknown;
};
export type OpenAISpeechSessionConfiguration = {
  /** Supplied by the host in its trusted process. Never send this through renderer IPC. */
  apiKey: string;
  signal?: AbortSignal;
  /** A Realtime transcription model; defaults to gpt-live-transcribe. */
  model?: string;
  /** Optional WebSocket implementation for a host transport or test server. */
  createWebSocket?: (url: string, options: { headers: { Authorization: string } }) => OpenAISpeechSocket;
};

/** Main/server-process dictation. Consumes the same mono Float32 PCM as Apple speech. */
export async function startOpenAISpeechSession(
  input: CodexSpeechSessionOptions,
  onEvent: (event: CodexSpeechSessionEvent) => void,
  configuration: OpenAISpeechSessionConfiguration,
): Promise<OpenAISpeechSession> {
  validateSampleRate(input.sampleRate);
  const prepared = await prepareOpenAISpeechSession(input, onEvent, configuration);
  return prepared.start(input.sampleRate);
}

/** Connect without assuming the microphone's eventual sample rate. No audio is accepted yet. */
export async function prepareOpenAISpeechSession(
  input: CodexSpeechPreparationOptions,
  onEvent: (event: CodexSpeechSessionEvent) => void,
  configuration: OpenAISpeechSessionConfiguration,
): Promise<CodexPreparedSpeechSession> {
  configuration.signal?.throwIfAborted();
  if (!configuration.apiKey?.trim()) throw new Error('An OpenAI API key is required for dictation.');
  const model = configuration.model ?? 'gpt-live-transcribe';
  if (!model.trim()) throw new Error('An OpenAI transcription model is required.');
  const socket = (configuration.createWebSocket ?? ((url, options) => new WebSocket(url, { ...options, maxPayload: 1024 * 1024 })))(
    'wss://api.openai.com/v1/realtime?intent=transcription',
    { headers: { Authorization: `Bearer ${configuration.apiKey}` } },
  );
  let closed = false;
  let stopping = false;
  let rawBytes = 0;
  let sentSamples = 0;
  let partialText = '';
  let committedItem: string | undefined;
  let completed: { itemId: string; text: string } | undefined;
  let configured = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let resolveDone!: (value: CodexSpeechTranscriptionResult) => void;
  const done = new Promise<CodexSpeechTranscriptionResult>(resolve => { resolveDone = resolve; });
  let resample: ReturnType<typeof pcmEncoder>;
  let timer = setTimeout(() => fail('OpenAI dictation took too long to connect.'), 15_000);
  timer.unref?.();
  function publish(event: CodexSpeechSessionEvent): void {
    try { onEvent(event); } catch { /* Consumer failure must not prevent cleanup. */ }
  }
  function finish(value: CodexSpeechTranscriptionResult): void {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    configuration.signal?.removeEventListener('abort', abort);
    socket.removeListener('open', open);
    socket.removeListener('message', message);
    rejectReady(new Error(value.error ?? 'Speech session closed.'));
    // Keep error/close handlers until the socket closes, including cancellation during handshake.
    socket.close();
    resolveDone(value);
  }
  function fail(error: string): void {
    if (closed) return;
    publish({ type: 'error', sessionId: input.sessionId, error });
    finish({ text: '', error });
  }
  function abort(): void { finish({ text: '', error: 'Speech recording cancelled.' }); }
  function send(frame: object): void {
    if (socket.bufferedAmount > 1024 * 1024) throw new Error('OpenAI dictation audio backlog exceeds the limit.');
    socket.send(JSON.stringify(frame));
  }
  function appendPcm(bytes: Buffer): void {
    if (!bytes.length) return;
    send({ type: 'input_audio_buffer.append', audio: bytes.toString('base64') });
    sentSamples += bytes.length / 2;
  }
  function open(): void {
    if (closed) return;
    const locale = input.locale?.toLowerCase();
    const language = locale?.startsWith('zh-') ? locale : locale?.split(/[-_]/)[0];
    try {
      send({ type: 'session.update', session: { type: 'transcription', audio: { input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription: { model, ...(language ? model === 'gpt-live-transcribe' ? { languages: [language] } : { language } : {}) },
        turn_detection: null,
      } } } });
    } catch { fail('Unable to configure OpenAI dictation.'); }
  }
  function complete(): void {
    if (!stopping || !committedItem || completed?.itemId !== committedItem) return;
    publish({ type: 'transcript', sessionId: input.sessionId, finalText: completed.text, partialText: '' });
    finish({ text: completed.text });
  }
  function message(data: OpenAISpeechData): void {
    if (closed) return;
    try {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      if (bytes.length > 1024 * 1024) throw new Error('Oversized event');
      const event = JSON.parse(bytes.toString('utf8'));
      if (event.type === 'session.updated' && !configured) { configured = true; clearTimeout(timer); resolveReady(); }
      else if (event.type === 'input_audio_buffer.committed' && typeof event.item_id === 'string') {
        committedItem = event.item_id;
        complete();
      } else if (event.type === 'conversation.item.input_audio_transcription.delta' && typeof event.delta === 'string') {
        partialText += event.delta;
        if (partialText.length > 1024 * 1024) throw new Error('Oversized transcript');
        publish({ type: 'transcript', sessionId: input.sessionId, finalText: '', partialText });
      } else if (event.type === 'conversation.item.input_audio_transcription.completed'
        && typeof event.item_id === 'string' && typeof event.transcript === 'string') {
        completed = { itemId: event.item_id, text: event.transcript };
        complete();
      } else if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
        // Provider/transport messages can contain request details. Never forward arbitrary text or credentials.
        fail('OpenAI dictation failed. Check your API key, model access, and connection.');
      }
    } catch { fail('Invalid OpenAI dictation response.'); }
  }
  socket.on('open', open);
  socket.on('message', message);
  socket.on('error', () => fail('Unable to connect to OpenAI dictation.'));
  socket.on('close', () => fail('OpenAI dictation connection closed before completion.'));
  configuration.signal?.addEventListener('abort', abort, { once: true });
  if (configuration.signal?.aborted) abort();
  await ready;
  const session: OpenAISpeechSession = {
    append: async audio => {
      if (closed || stopping) throw new Error('Speech session is no longer recording.');
      if (!audio.byteLength || audio.byteLength % 4 || audio.byteLength > 256 * 1024) throw new Error('Invalid PCM audio chunk.');
      const samples = new Float32Array(audio);
      if (samples.some(value => !Number.isFinite(value))) throw new Error('Invalid PCM audio samples.');
      rawBytes += audio.byteLength;
      if (rawBytes > 25 * 1024 * 1024) { fail('Speech recording exceeds the audio byte limit.'); throw new Error('Speech recording exceeds the audio byte limit.'); }
      try { appendPcm(resample(samples)); }
      catch {
        const error = 'OpenAI dictation audio backlog or connection failed.';
        fail(error);
        throw new Error(error);
      }
    },
    stop: () => {
      if (!closed && !stopping) {
        stopping = true;
        if (!sentSamples) finish({ text: '' });
        else {
          timer = setTimeout(() => fail('OpenAI dictation took too long to finalize.'), 30_000);
          timer.unref?.();
          try {
            // The API requires at least 100 ms for a commit. Pad only very short captures.
            if (sentSamples < 2400) appendPcm(Buffer.alloc((2400 - sentSamples) * 2));
            send({ type: 'input_audio_buffer.commit' });
          } catch { fail('Unable to finalize OpenAI dictation.'); }
        }
      }
      return done;
    },
    cancel: async () => { abort(); await done; },
  };
  let activated = false;
  return {
    start: async sampleRate => {
      if (closed) throw new Error('Speech session is no longer recording.');
      if (activated) throw new Error('Speech session is already active.');
      validateSampleRate(sampleRate);
      resample = pcmEncoder(sampleRate);
      activated = true;
      return session;
    },
    cancel: session.cancel,
  };
}

function validateSampleRate(sampleRate: number): void {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    throw new Error('Unsupported speech sample rate.');
  }
}

/** Continuous linear resampling: chunk boundaries do not change the encoded audio. */
function pcmEncoder(sampleRate: number): (samples: Float32Array) => Buffer {
  let inputIndex = 0;
  let outputIndex = 0;
  let previous = 0;
  return samples => {
    const values: number[] = [];
    for (const sample of samples) {
      while (outputIndex * sampleRate / 24000 <= inputIndex) {
        const position = outputIndex * sampleRate / 24000;
        const value = inputIndex === 0 ? sample : previous + (sample - previous) * (position - inputIndex + 1);
        const clamped = Math.max(-1, Math.min(1, value));
        values.push(Math.round(clamped * (clamped < 0 ? 32768 : 32767)));
        outputIndex++;
      }
      previous = sample;
      inputIndex++;
    }
    const bytes = Buffer.allocUnsafe(values.length * 2);
    values.forEach((value, index) => bytes.writeInt16LE(value, index * 2));
    return bytes;
  };
}
