// Intentionally break one owner invariant at a time, run the corresponding
// process-boundary check, then restore the exact file even if validation fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const file = new URL('../../packages/backend/src/node/sherpa-speech-session.ts', import.meta.url);
const original = readFileSync(file, 'utf8');
const mutations = [
  { name: 'idle helper never exits', from: '}, idleMs);', to: '}, 1_000_000);', test: 'reuses one preloaded helper' },
  { name: 'old tokens routed to the new stream', from: 'session.token === reply.token && session.worker === current', to: 'session.worker === current', test: 'isolates simultaneous streams' },
  { name: 'start reuses a retiring helper', from: '// Mark retirement before yielding:', to: 'current.retiring = false; // Broken retirement barrier:', test: 'waits for idle retirement' },
  { name: 'cancel sends a command to an already finalizing stream', from: 'if (entry.stopping) {', to: 'if (false) {', test: 'discards a finalizing session' },
];
const evidence = [];
try {
  for (const mutation of mutations) {
    assert(original.includes(mutation.from));
    writeFileSync(file, original.replace(mutation.from, mutation.to));
    const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'packages/backend/vitest.config.ts',
      'packages/backend/tests/sherpa-speech-session.spec.ts', '-t', mutation.test], { encoding: 'utf8' });
    const output = run.stdout + run.stderr;
    assert.notEqual(run.status, 0, mutation.name + ' was not detected');
    assert(output.includes('AssertionError'), 'Expected a behavioral assertion failure');
    evidence.push({ defect: mutation.name, test: mutation.test, status: run.status,
      failure: output.slice(output.indexOf(' FAIL ')).replace(/\x1b\[[0-9;]*m/g, '').slice(0, 1600) });
    console.log(mutation.name + ': demonstrated red');
    writeFileSync(file, original);
  }
} finally { writeFileSync(file, original); }
const bridgeFile = new URL('../../packages/electron/src/codex-speech-sessions.ts', import.meta.url);
const originalBridge = readFileSync(bridgeFile, 'utf8');
try {
  assert(originalBridge.includes('void sherpa?.dispose();'));
  writeFileSync(bridgeFile, originalBridge.replace('void sherpa?.dispose();', 'void sherpa;'));
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'packages/electron/vitest.config.ts',
    'packages/electron/tests/streaming-speech.spec.ts', '-t', 'selects the configured shared Sherpa provider'], { encoding: 'utf8' });
  const output = run.stdout + run.stderr;
  assert.notEqual(run.status, 0, 'Bridge teardown defect was not detected');
  assert(output.includes('AssertionError'));
  evidence.push({ defect: 'bridge disposal leaves the shared helper alive', status: run.status,
    failure: output.slice(output.indexOf(' FAIL ')).slice(0, 1600) });
  console.log('bridge helper teardown: demonstrated red');
} finally { writeFileSync(bridgeFile, originalBridge); }
writeFileSync(new URL('./results/red-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
