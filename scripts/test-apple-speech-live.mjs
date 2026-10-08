import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { startAppleSpeechSession } from '../packages/backend/dist/index.js';

// A supplied, non-sensitive mono 16 kHz f32le fixture is paced like a microphone.
// This exercises the real bundled native helper, not physical microphone capture.
const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/test-apple-speech-live.mjs <mono-16000-f32le.pcm> [max-first-text-ms]');
const maxFirstTextMs = process.argv[3] === undefined ? Infinity : Number(process.argv[3]);
assert.ok(maxFirstTextMs > 0, 'First-text budget must be a positive number');
const data = await readFile(file);
let stopped = false;
let beforeStop = 0;
const errors = [];
const startedAt = performance.now();
let firstTextAt;
const session = await startAppleSpeechSession({ sessionId: 'native-smoke', sampleRate: 16000, locale: 'en-US' }, (event) => {
  if (event.type === 'error') errors.push(event.error);
  if (!stopped && event.type === 'transcript' && event.partialText) beforeStop++;
  if (event.type === 'transcript' && (event.finalText || event.partialText)) firstTextAt ??= performance.now();
}, { assetsPath: new URL('../packages/backend/assets', import.meta.url).pathname });
const readyAt = performance.now();
try {
  for (let offset = 0; offset < data.length; offset += 8192) {
    const chunk = data.subarray(offset, offset + 8192);
    // Match the composer's 2048-sample capture blocks without accumulating timer drift.
    await setTimeout(Math.max(0, readyAt + (offset + chunk.length) / 64 - performance.now()));
    await session.append(Uint8Array.from(chunk).buffer);
  }
  await setTimeout(1000);
  assert.ok(beforeStop > 0, 'Must receive actual provisional speech before ending input');
  stopped = true;
  const result = await session.stop();
  assert.deepEqual(errors, []);
  assert.equal(result.error, undefined);
  assert.ok(result.text.length > 0, 'Finalization must return recognized text');
  const firstTextMs = Math.round(firstTextAt - readyAt);
  console.log(`Native streaming: startup ${Math.round(readyAt - startedAt)}ms; first text ${firstTextMs}ms after capture began; ${beforeStop} provisional results before stop; ${result.text.length} final characters.`);
  assert.ok(firstTextMs <= maxFirstTextMs, `First text took ${firstTextMs}ms, exceeding ${maxFirstTextMs}ms`);
} finally { await session.cancel(); }
