import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const exec = promisify(execFile);
const args = process.argv.slice(2);
const assets = path.resolve(args.find((arg) => !arg.startsWith('--')) ?? '/tmp/sherpa-live-demo.TbsqwY');
const source = args.includes('--source');
const quick = args.includes('--quick');
const entry = args.find((arg) => arg.startsWith('--entry='))?.slice(8);
const label = args.find((arg) => arg.startsWith('--label='))?.slice(8) ?? (source ? 'source' : 'built');
assert(/^[a-z-]+$/.test(label));
const { createSherpaSpeechService, resolveSherpaSpeechHelperPath } = await import(entry ?? (source
  ? '../../packages/backend/src/node/sherpa-speech-session.ts' : '../../packages/backend/dist/index.js'));
const runtimeRequire = createRequire(resolveSherpaSpeechHelperPath());
const runtimeVersion = runtimeRequire('sherpa-onnx-node/package.json').version;
assert.equal(runtimeVersion, '1.13.8', 'Benchmark uses the fixed runtime version');
const output = new URL('./results/', import.meta.url);
await mkdir(output, { recursive: true });
const model = Object.fromEntries(['encoder', 'decoder', 'joiner', 'tokens'].map((key) => [key, path.join(assets, 'model-strong', key === 'tokens' ? 'tokens.txt' : key + '.onnx')]));
const manifest = [];
for (const file of Object.values(model)) {
  const data = await readFile(file);
  manifest.push({ file: path.basename(file), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
const references = (await readFile(path.join(assets, 'fixtures/references.txt'), 'utf8')).trim().split('\n').map((line) => {
  const [name, ...text] = line.split(/\s+/); return { name: name.replace('.wav', ''), reference: text.join(' '), kind: 'human' };
});
const fixtures = [...references, { name: 'dictation', kind: 'English TTS', reference: 'Please check the latest changes and run the tests before committing. Keep the current draft and attachments when I stop recording.' },
  { name: 'accent-en', kind: 'Indian English TTS', reference: 'I want live speech recognition to be fast. The words should appear while I speak, and stopping should preserve my draft.' }];
function wave(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  let format, pcm;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4), chunk = buffer.subarray(offset + 8, offset + 8 + size);
    const tag = buffer.toString('ascii', offset, offset + 4);
    if (tag === 'fmt ') format = { type: chunk.readUInt16LE(0), channels: chunk.readUInt16LE(2), rate: chunk.readUInt32LE(4), bits: chunk.readUInt16LE(14) };
    if (tag === 'data') pcm = chunk;
    offset += 8 + size + (size % 2);
  }
  assert.equal(format.channels, 1); assert([8000, 16000].includes(format.rate)); assert.equal(format.type, 1); assert.equal(format.bits, 16);
  const samples = Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768);
  return { sampleRate: format.rate, samples };
}
for (const fixture of fixtures) {
  const data = await readFile(path.join(assets, 'fixtures', fixture.name + '.wav'));
  fixture.sha256 = createHash('sha256').update(data).digest('hex');
  fixture.audio = wave(data);
}
function errors(reference, hypothesis) {
  const words = (text) => text.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const a = words(reference), b = words(hypothesis);
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] !== b[j - 1]));
    row = next;
  }
  return { errors: row[b.length], words: a.length };
}
const round = (n) => Math.round(n * 10) / 10;
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    median: round((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2),
    p90: round(sorted[Math.ceil(sorted.length * .9) - 1]), min: round(sorted[0]), max: round(sorted.at(-1)) };
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function memory(pid) {
  if (process.platform !== 'darwin') return { pid, alive: alive(pid), unavailable: 'macOS vmmap accounting only' };
  const [{ stdout: ps }, { stdout: map }] = await Promise.all([
    exec('/bin/ps', ['-o', 'rss=', '-p', String(pid)]), exec('/usr/bin/vmmap', ['-summary', String(pid)], { maxBuffer: 4 * 1024 * 1024 }),
  ]);
  function number(label) {
    const value = map.match(new RegExp(label + ':\\s*([\\d.]+)([KMGT])'));
    assert(value, 'Missing vmmap ' + label);
    return Number(value[1]) * { K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024 }[value[2]];
  }
  return { pid, alive: true, rssMiB: round(Number(ps.trim()) / 1024), footprintMiB: number('Physical footprint'), peakFootprintMiB: number('Physical footprint \\(peak\\)') };
}
async function waitExit(host, pid, deadline = 5000) {
  const start = performance.now();
  while (host.processId !== undefined && performance.now() - start < deadline) await sleep(20);
  assert.equal(host.processId, undefined); assert.equal(alive(pid), false);
  const ps = await exec('/bin/ps', ['-o', 'rss=', '-p', String(pid)]).catch((error) => ({ stdout: error.stdout, code: error.code }));
  assert.equal(ps.stdout.trim(), '');
  return { pid, alive: false, psExitCode: ps.code, psOutput: ps.stdout.trim(), helperRssMiB: 0, helperFootprintMiB: 0,
    explanation: 'Exited PID has no vmmap address space or resident pages; zero is absent process, not a vmmap reading.' };
}
async function replay(host, fixture, sessionId, paced = true, steady) {
  const events = [];
  const clicked = performance.now();
  let first;
  const session = await host.startSession({ sessionId, sampleRate: fixture.audio.sampleRate, locale: 'en-US' }, (event) => {
    events.push(event);
    if (event.type === 'transcript' && (event.finalText || event.partialText)) first ??= performance.now();
  });
  const ready = performance.now();
  const { samples, sampleRate } = fixture.audio;
  let sampled = false;
  const chunkSize = Math.round(sampleRate * 0.1);
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const chunk = samples.slice(offset, offset + chunkSize);
    if (paced) await sleep(Math.max(0, ready + (offset + chunk.length) / sampleRate * 1000 - performance.now()));
    await session.append(chunk.buffer);
    if (!sampled && offset >= samples.length / 2 && steady) { sampled = true; await steady(); }
  }
  const eof = performance.now();
  assert(first < eof, 'Real partials must arrive before EOF');
  const stopped = session.stop();
  const repeated = session.stop();
  assert.equal(repeated, stopped, 'Repeated stop must share one final result promise');
  const [result, duplicate] = await Promise.all([stopped, repeated]);
  assert.deepEqual(duplicate, result); assert(result.text && !result.error);
  const finalized = performance.now();
  const atStop = events.length;
  await sleep(10);
  assert.equal(events.length, atStop, 'No late transcript may be inserted after stop');
  return { fixture: fixture.name, kind: fixture.kind, sessionId, pid: host.processId,
    startupMs: round(ready - clicked), clickToFirstTextMs: round(first - clicked), captureToFirstTextMs: round(first - ready),
    firstBeforeEof: true, sampleRate, durationMs: round(samples.length / sampleRate * 1000), finalizationMs: round(finalized - eof),
    transcriptEvents: events.length, finalResults: new Set([stopped, repeated]).size, ...errors(fixture.reference, result.text), text: result.text };
}
const checks = [];
async function lifecycle() {
  const host = createSherpaSpeechService({ model, idleTimeoutMs: 30 });
  try {
    await host.preload();
    const pid = host.processId;
    const events = [];
    const old = await host.startSession({ sessionId: 'reuse', sampleRate: 16000 }, (e) => events.push(e));
    for (let i = 0; i < 30; i++) await old.append(fixtures[0].audio.samples.slice(i * 1600, (i + 1) * 1600).buffer);
    assert(events.some((e) => e.partialText));
    await old.cancel();
    const cancelledCount = events.length;
    const fresh = await replay(host, fixtures[0], 'reuse', false);
    assert.equal(events.length, cancelledCount); assert.equal(fresh.pid, pid);
    checks.push({ name: 'cancel, immediate same-ID restart, no old events, one final', passed: true });
    await waitExit(host, pid);
    const racing = host.startSession({ sessionId: 'shutdown-race', sampleRate: 16000 }, () => {});
    const next = await racing;
    assert.notEqual(host.processId, pid);
    await next.cancel();
    checks.push({ name: 'idle exit and cold restart', passed: true });
    const brokenEvents = [];
    const broken = await host.startSession({ sessionId: 'exit', sampleRate: 16000 }, (e) => brokenEvents.push(e));
    process.kill(host.processId, 'SIGKILL');
    await sleep(50);
    assert((await broken.stop()).error);
    assert.equal(brokenEvents.filter((e) => e.type === 'error').length, 1);
    checks.push({ name: 'unexpected native process exit produces one error', passed: true });
    const recovered = await replay(host, fixtures[0], 'recovered', false);
    assert(recovered.text);
    const bad = await host.startSession({ sessionId: 'invalid-pcm', sampleRate: 16000 }, () => {});
    await assert.rejects(bad.append(new Float32Array([NaN]).buffer), /finite/);
    assert((await bad.stop()).error);
    checks.push({ name: 'native/helper input error and recovery', passed: true });
  } finally { await host.dispose(); }
}
await lifecycle();
const runs = [], baselines = [], bindingBaselines = [];
const passes = quick ? 1 : 10;
for (let pass = 0; pass < passes; pass++) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try { await sleep(100); baselines.push(await memory(child.pid)); }
  finally { child.kill('SIGKILL'); await new Promise((resolve) => child.once('exit', resolve)); }
  const binding = spawn(process.execPath, ['-e', 'require("sherpa-onnx-node");setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try { await sleep(100); bindingBaselines.push(await memory(binding.pid)); }
  finally { binding.kill('SIGKILL'); await new Promise((resolve) => binding.once('exit', resolve)); }
  // Enough retention for vmmap snapshots; production default is 30s.
  const host = createSherpaSpeechService({ model, idleTimeoutMs: 1500 });
  const fixture = fixtures[pass % fixtures.length];
  const snapshots = { parentBefore: await memory(process.pid) };
  try {
    const cold = await replay(host, fixture, 'cold-' + pass, true, async () => { snapshots.recordingCold = await memory(host.processId); });
    const warm = await replay(host, fixture, 'warm-' + pass, true, async () => { snapshots.recordingWarm = await memory(host.processId); });
    assert.equal(cold.pid, warm.pid, 'Warm sessions must reuse the exact helper process');
    snapshots.warmIdle = await memory(host.processId);
    snapshots.postTermination = await waitExit(host, cold.pid);
    snapshots.parentAfter = await memory(process.pid);
    const result = { pass: pass + 1, cold, warm, snapshots };
    runs.push(result);
    console.log(JSON.stringify({ pass: pass + 1, fixture: fixture.name, coldMs: cold.clickToFirstTextMs, warmMs: warm.clickToFirstTextMs,
      footprintMiB: snapshots.warmIdle.footprintMiB, exited: !snapshots.postTermination.alive }));
    await writeFile(new URL(label + '-runs.json', output), JSON.stringify({ runs, baselines, bindingBaselines, checks }, null, 2) + '\n');
  } finally { await host.dispose(); }
}
const summary = { measuredAt: new Date().toISOString(), platform: process.platform, arch: process.arch, release: os.release(), node: process.version,
  hardware: { cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemoryGiB: os.totalmem() / 2 ** 30 },
  entry: entry ?? (source ? 'SDK TypeScript source' : 'built SDK backend'), sherpaVersion: runtimeVersion,
  method: `${passes} fresh helper processes; ${quick ? 'one human fixture' : 'five fixed English fixtures twice each'} per cold/warm cohort. Capture begins after startSession resolves. Click timer begins before startSession and includes helper fork/native/model loading. Filesystem caches are not flushed. Mono PCM 8/16kHz with native resampling to 16kHz, paced 100ms chunks, 500ms EOF padding. vmmap physical footprint/peak, ps RSS. No parent-side Sherpa/native binding or GC tricks.`,
  config: { model: 'English Zipformer 2023-06-26 chunk16-left128, int8 encoder/joiner, fp32 decoder', numThreads: 2, provider: 'cpu', decodingMethod: 'greedy_search', idleTimeoutMs: 1500 },
  modelFiles: manifest, fixtures: fixtures.map(({ audio, ...fixture }) => fixture), checks,
  baseline: { runtime: Object.fromEntries(['rssMiB', 'footprintMiB'].map((key) => [key, stats(baselines.map((m) => m[key]))])),
    runtimeAndBinding: Object.fromEntries(['rssMiB', 'footprintMiB'].map((key) => [key, stats(bindingBaselines.map((m) => m[key]))])) },
  metrics: Object.fromEntries(['cold', 'warm'].map((mode) => [mode, Object.fromEntries(['startupMs', 'clickToFirstTextMs', 'captureToFirstTextMs', 'finalizationMs'].map((key) => [key, stats(runs.map((r) => r[mode][key]))]))])),
  memory: Object.fromEntries(['recordingCold', 'recordingWarm', 'warmIdle'].map((stage) => [stage, Object.fromEntries(['rssMiB', 'footprintMiB', 'peakFootprintMiB'].map((key) => [key, stats(runs.map((r) => r.snapshots[stage][key]))]))])),
  accuracy: Object.fromEntries(['cold', 'warm'].map((mode) => [mode, { errors: runs.reduce((n, r) => n + r[mode].errors, 0), words: runs.reduce((n, r) => n + r[mode].words, 0) }])),
  limitations: 'Prerecorded playback; no physical microphone/permissions or Windows/Linux execution. Process-cold, filesystem-warm. In-recording vmmap briefly perturbs pacing after first text. RSS and footprint are different accounting metrics; absent PID is process-memory reclamation, not global free-memory growth.' };
await writeFile(new URL(label + '-summary.json', output), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
