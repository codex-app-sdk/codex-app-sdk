import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { startAppleSpeechSession } from '../packages/backend/dist/index.js';

// A supplied, non-sensitive mono 16 kHz f32le fixture is paced like a microphone.
// This exercises the real bundled native helper, not physical microphone capture.
const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/test-apple-speech-live.mjs <mono-16000-f32le.pcm>');
const data = await readFile(file);
let stopped = false;
let beforeStop = 0;
const errors = [];
const session = await startAppleSpeechSession({ sessionId: 'native-smoke', sampleRate: 16000, locale: 'en-US' }, (event) => {
  if (event.type === 'error') errors.push(event.error);
  if (!stopped && event.type === 'transcript' && event.partialText) beforeStop++;
}, { assetsPath: new URL('../packages/backend/assets', import.meta.url).pathname });
try {
  for (let offset = 0; offset < data.length; offset += 6400) {
    const chunk = data.subarray(offset, offset + 6400);
    await session.append(Uint8Array.from(chunk).buffer);
    await setTimeout(100);
  }
  await setTimeout(1000);
  assert.ok(beforeStop > 0, 'Must receive actual provisional speech before ending input');
  stopped = true;
  const result = await session.stop();
  assert.deepEqual(errors, []);
  assert.equal(result.error, undefined);
  assert.ok(result.text.length > 0, 'Finalization must return recognized text');
  console.log(`Native streaming passed: ${beforeStop} provisional results before stop; ${result.text.length} final characters.`);
} finally { await session.cancel(); }
