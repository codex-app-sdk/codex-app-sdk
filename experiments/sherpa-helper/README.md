# Shared Sherpa helper measurement

The SDK implementation is `createSherpaSpeechService` in the backend, with an
opt-in `sherpaSpeech` Electron bridge option. This folder exercises that provider;
it is not an alternate recognizer implementation. Apple speech is unchanged.

From the worktree root, after `npm ci`:

```sh
node experiments/sherpa-helper/run.mjs /tmp/sherpa-live-demo.TbsqwY
```

This runs native lifecycle acceptance, then ten fresh helpers with one cold and
one warm recording each. The five clips (three human, two English TTS) repeat
twice per cohort. It writes raw runs and summary JSON under `results/`. Model,
configuration, fixture hashes, transcripts, per-run latency and OS accounting are
recorded. The original demo server, inputs, models and binding installation are
read only. The SDK's own installed optional Sherpa runtime is used.

`--source --quick` checks the TypeScript source with one fixture on Node 22.19+;
`--quick` checks one cold/warm pair through built output. To check a separately
installed packed backend, pass `--entry=/absolute/path/to/dist/index.js --label=packed --quick`.
Run these separately from the primary benchmark to avoid competing native loads.
`red-check.mjs` demonstrates five specific process lifecycle regressions by intentional
mutations and restores the original source in `finally`. Do not run it while
other checks are using the source.

The benchmark uses English Zipformer 2023-06-26 chunk16-left128, int8
encoder/joiner, fp32 decoder, CPU two threads and greedy search. Input is paced
100ms PCM; the helper adds 500ms EOF padding. The 8kHz fixture is resampled by the
native recognizer, like the original benchmark. No model download or hosted
transcription occurs. The exploratory French TTS fixture is excluded.

The cold user timer starts before `startSession`, including process/native/model
loading. Capture starts after readiness; capture-to-first-text is reported
separately. Warm startup and click-to-first-text measure reuse of the same PID.
These are process-cold, filesystem-cache-warm measurements, not disk-cold boot or
physical microphone acceptance.

Memory uses macOS `vmmap -summary` physical footprint and lifetime peak,
plus `ps` RSS, with separate fresh Node/runtime-binding baselines. Footprint and
RSS remain distinct. In-recording snapshots briefly perturb pacing after first
text. Idle timeout is 1.5 seconds in this experiment, versus the SDK default of
30 seconds. After retirement, liveness and `ps` must show that the old PID is
absent. Reported zero post-exit helper memory means no process/address space
remains; it is not a fabricated vmmap reading or a claim about global free RAM.
No JS GC or dropped-reference experiment is used to infer reclamation.

Windows/Linux execution, packaged Electron runtime/fuses, physical microphone
permissions and broader accuracy/accents need their own validation. The small
corpus does not establish production recognition quality.
