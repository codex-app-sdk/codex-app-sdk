import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { CodexSpeechSessionEvent, CodexSpeechSessionOptions, CodexSpeechTranscriptionResult } from '@codex-app-sdk/core/native';
import { resolveAppleSpeechAnalyzerPath } from './apple-speech-transcription';

export type AppleSpeechSession = {
  append(audio: ArrayBuffer): Promise<void>;
  stop(): Promise<CodexSpeechTranscriptionResult>;
  cancel(): Promise<void>;
};

export async function startAppleSpeechSession(
  options: CodexSpeechSessionOptions,
  onEvent: (event: CodexSpeechSessionEvent) => void,
  dependencies: { assetsPath?: string; signal?: AbortSignal; spawn?: (command: string, args: string[]) => ChildProcessWithoutNullStreams } = {},
): Promise<AppleSpeechSession> {
  dependencies.signal?.throwIfAborted();
  if (!Number.isInteger(options.sampleRate) || options.sampleRate < 8000 || options.sampleRate > 96000) {
    throw new Error('Unsupported speech sample rate.');
  }
  const temp = await mkdtemp(path.join(tmpdir(), 'codex-sdk-live-speech-'));
  let child: ChildProcessWithoutNullStreams;
  try {
    const executable = path.join(temp, 'apple-speechanalyzer-cli');
    await copyFile(resolveAppleSpeechAnalyzerPath(dependencies.assetsPath), executable);
    await chmod(executable, 0o700);
    dependencies.signal?.throwIfAborted();
    child = (dependencies.spawn ?? spawn)(executable, ['--stream', '--sample-rate', String(options.sampleRate),
      ...(options.locale ? ['--locale', options.locale] : [])]);
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
  let closed = false;
  let stopping = false;
  let result: CodexSpeechTranscriptionResult | undefined;
  let line = '';
  const decoder = new StringDecoder('utf8');
  let stderr = '';
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  let resolveDone!: (result: CodexSpeechTranscriptionResult) => void;
  const done = new Promise<CodexSpeechTranscriptionResult>((resolve) => { resolveDone = resolve; });
  let timeout = setTimeout(() => fail('Speech recognition took too long to start.'), 120_000);
  const finish = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    dependencies.signal?.removeEventListener('abort', abort);
    const final = result ?? { text: '', error: stderr.trim() || 'Speech helper stopped without a final transcript.' };
    readyReject(new Error(final.error ?? 'Speech session closed.'));
    try { await rm(temp, { recursive: true, force: true }); }
    finally { resolveDone(final); }
  };
  function fail(message: string): void {
    if (closed || result?.error) return;
    result = { text: '', error: message };
    readyReject(new Error(message));
    publish({ type: 'error', sessionId: options.sessionId, error: message });
    child.kill('SIGKILL');
    void finish();
  }
  function publish(event: CodexSpeechSessionEvent): void {
    try { onEvent(event); } catch { /* A disconnected consumer cannot prevent process cleanup. */ }
  }
  function abort(): void {
    if (closed) return;
    result = { text: '', error: 'Speech recording cancelled.' };
    child.kill('SIGKILL');
    void finish();
  }
  dependencies.signal?.addEventListener('abort', abort, { once: true });
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096); });
  child.on('error', (error) => fail(error.message));
  child.stdin.on('error', (error) => fail(error.message));
  child.on('close', (code) => {
    if (code !== 0 && !result?.error) {
      fail(stderr.trim() || `Speech helper exited with code ${code}.`);
    }
    void finish();
  });
  child.stdout.on('data', (chunk: Buffer) => {
    if (closed) return;
    line += decoder.write(chunk);
    if (line.length > 1024 * 1024) { fail('Speech helper result exceeds the size limit.'); return; }
    let index: number;
    while ((index = line.indexOf('\n')) >= 0 && !closed) {
      const input = line.slice(0, index);
      line = line.slice(index + 1);
      try {
        const event = JSON.parse(input);
        if (event.type === 'ready') { clearTimeout(timeout); readyResolve(); }
        else if (event.type === 'transcript' && typeof event.finalText === 'string' && typeof event.partialText === 'string') {
          publish({ type: 'transcript', sessionId: options.sessionId, finalText: event.finalText, partialText: event.partialText });
        } else if (event.type === 'done' && typeof event.text === 'string') result = { text: event.text };
        else if (event.type === 'error' && typeof event.message === 'string') fail(event.message);
        else fail('Invalid speech helper event.');
      } catch { fail('Invalid speech helper output.'); }
    }
  });
  if (dependencies.signal?.aborted) abort();
  await ready;
  return {
    append: (audio) => new Promise<void>((resolve, reject) => {
      if (closed || stopping) { reject(new Error('Speech session is no longer recording.')); return; }
      if (audio.byteLength % 4 || audio.byteLength > 256 * 1024) { reject(new Error('Invalid PCM audio chunk.')); return; }
      child.stdin.write(Buffer.from(audio), (error) => error ? reject(error) : resolve());
    }),
    stop: () => {
      if (!closed && !stopping) {
        stopping = true;
        timeout = setTimeout(() => fail('Speech recognition took too long to finalize.'), 30_000);
        child.stdin.end();
      }
      return done;
    },
    cancel: async () => {
      if (!closed) {
        result = { text: '', error: 'Speech recording cancelled.' };
        child.kill('SIGKILL');
        await finish();
      }
    },
  };
}
