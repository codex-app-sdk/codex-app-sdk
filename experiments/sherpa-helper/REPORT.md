# Shared Sherpa SDK helper: result

Yes. A shared recognizer removes almost all repeated-session startup cost, while
idle **process termination** releases the helper's native memory. The tradeoff is
about **865 ms** of reload time after retirement. Memory remains substantial while
warm, so the service deliberately retains it only briefly rather than permanently.

The SDK implementation is opt-in through `createSherpaSpeechService` (backend)
and `sherpaSpeech` (Electron main bridge). It uses the existing streaming session
and transcript snapshot semantics. One lazy child process owns one recognizer;
recordings have independent native streams and private generation tokens. It
supports explicit anticipation with `preload()`, warm reuse, cold recreation,
cancellation, repeated-stop finalization, bounded IPC deadlines, helper-failure
recovery, and teardown. The idle default is 30 seconds, configurable by the host.
No recognizer loads just because the service was constructed.

Local encoder/decoder/joiner/token files are explicit absolute paths. The SDK
performs no model download or network transcription. CPU greedy decoding defaults
to two threads. The optional pinned `sherpa-onnx-node@1.13.8` dependency and owned
`assets/sherpa-speech-helper.cjs` ship with the backend; models do not. Existing
Apple speech, custom/batch transcribers, shared composer, drafts and attachments
retain their behavior. No Korus or other checkout was edited.

## Primary native measurements

Apple M2 Max, 12 logical CPUs, 64 GiB RAM; macOS arm64 Darwin 27.0.0;
Node 22.19.0. English Zipformer 2023-06-26 chunk16-left128, int8 encoder/joiner,
fp32 decoder, CPU two threads, greedy search. The model files total 73,440,167 bytes
including tokens. Exact file and fixture hashes are in `results/built-summary.json`.

Ten fresh helpers, each with a cold session and a warm session on the same PID.
Five fixed English recordings repeat twice per cohort: three human, two English
TTS. The exploratory French TTS is excluded. Audio is paced in 100 ms chunks;
500 ms padding is added at EOF. The 8 kHz clip uses native resampling to 16 kHz.
Each replay produced nonempty partials before EOF and the same authoritative
final result on repeated stops. Neither partials nor recognition were fabricated.

| Latency, ms | Cold mean | Cold median | Cold p90 | Warm mean | Warm median | Warm p90 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Start request to ready | 864.7 | 863.1 | 893.6 | 0.3 | 0.3 | 0.4 |
| Click/start request to first text | 2145.4 | 2105.6 | 2355.3 | 1280.0 | 1223.3 | 1522.3 |
| Capture start to first text | 1280.7 | 1223.6 | 1519.3 | 1279.6 | 1222.9 | 1521.9 |
| Stop to final result | 21.5 | 21.8 | 30.1 | 24.1 | 20.8 | 37.5 |

The click timer begins **before** `startSession`, including process creation,
native module loading and model initialization. Capture begins after readiness.
These are process-cold, filesystem-cache-warm measurements, not disk-cold boot
or a timer started after the model was ready. First text includes fixture silence.
p90 uses nearest rank. Cold/warm finals match per clip; each cohort has 16 errors
in 238 reference words (6.7% WER). This tiny corpus is insufficient to establish
production recognition quality. The supplied earlier Apple measurements on these
clips were 2.5% WER and about 1235 ms first text; they were not rerun here. Apple
also provides punctuation, whereas this Sherpa transducer returns model text.

| Memory, MiB | Physical footprint mean | Footprint range | RSS mean | RSS range |
| --- | ---: | ---: | ---: | ---: |
| Fresh Node runtime baseline, n=10 | 10.8 | 10.7–10.9 | 36.8 | 36.7–36.9 |
| Runtime plus native binding, n=10 | 13.4 | 13.3–13.7 | 46.4 | 46.3–46.7 |
| During cold recording | 195.2 | 190.4–197.6 | 376.7 | 327.3–392.0 |
| During warm recording | 189.4 | 160.4–198.1 | 378.2 | 328.5–393.0 |
| Warm idle after both recordings | 183.3 | 124.9–198.8 | 378.4 | 329.7–393.3 |
| Lifetime physical footprint peak | 248.2 | 203.2–261.3 | — | — |
| After helper termination | No process | PID absent, 10/10 | No process | `ps` absent, 10/10 |

These are whole-helper measurements, **not model-only RAM**. RSS and physical
footprint are different OS accounting metrics. The original demo's earlier
model-only measurements and this provider's whole-helper figures use different
setups; one is not substituted for the other. Allocation variability remains
unexplained; the full range is retained rather than selecting the smallest run.
The peak is vmmap's lifetime physical-footprint peak, not a sampled RSS peak.
Fresh runtime and binding baselines run in separate processes without models.

The experiment uses a 1.5-second idle timeout, while the SDK default is 30 seconds.
After each timeout the old PID failed `kill(pid, 0)` and had no `ps` entry/resident
memory. No vmmap address space remains for an exited process. A new session gets
a new PID and reloads the model. This proves removal of the helper's allocations;
it does not claim an equivalent rise in global free RAM, whose caches/accounting
are different. Parent footprint snapshots are preserved in the raw runs; the
parent does not load the native binding. Recording vmmap snapshots briefly pause
input after first text, so finalization/whole-replay timing is instrumented.

## Commands and artifacts

After `npm ci`, from this worktree root:

```sh
node experiments/sherpa-helper/run.mjs /tmp/sherpa-live-demo.TbsqwY
```

This runs native lifecycle acceptance and ten cold/warm pairs using the SDK's
built provider, writing raw runs and summary JSON. The input folder must retain
its `model-strong` and `fixtures` inputs; the command reads them without changing
the original demo/server or its native installation. Results are local to this
worktree. No microphone interaction or approval is needed.

- `run.mjs`: native acceptance plus latency/memory runner; `--source --quick` uses
  TypeScript source and `--quick` uses one built-output cold/warm pair.
- `results/built-runs.json`, `results/built-summary.json`: all primary ten-run
  observations, transcripts, accounting, hashes and summary statistics.
- `results/source-*`, `results/packed-*`, `results/electron-*`: separate native
  smoke measurements; these are not mixed into the primary statistics.
- `red-check.mjs`, `results/red-evidence.json`: intentional behavioral defects and
  their failing assertions, with exact restoration of the changed sources.
- `results/schema-baseline-failure.json`: unchanged HEAD schema-generator failure
  against the installed Codex CLI, separate from this feature.

## Validation completed

- Real native acceptance through SDK TypeScript source, built backend, separately
  packed/installed backend, and Electron 43.1.1 running its actual executable in
  Node mode. Each smoke run includes cancel/restart, partials before EOF, repeated
  stop sharing one final promise, native/helper error, unexpected process exit,
  idle retirement and cold recovery. Primary latency/memory statistics use only
  the separate ten-run Node cohort above.
- The packed backend, owned helper, wrapper and native binary all resolve inside
  the installed packed consumer; `results/packaged-assets.json` records this
  provenance. No workspace dependency fallback is used for that check.
- Backend `check`: 1007 passed, one existing skipped test; lint, coverage and build
  passed. Electron `check`: 51 passed; lint, coverage and build passed. Backend
  branch coverage is 95.63%; Electron branch coverage is 96.34%.
- All five package checks passed (core/backend/Vue/Electron/web). The full Vue
  suite includes existing composer dictation/draft/attachment coverage. Final
  backend/Electron checks were rerun after adding the finalization-cancel case.
- Compatibility lint/build, release metadata, RPC inventory, native asset checks,
  docs/VitePress build and basic Electron consumer build passed. JavaScript helper
  and experimental runner syntax checks passed; final `git diff --check` passed.
  VitePress impact: **Updated**, with Node/Electron API and composer guide changes.
- Five intentional mutations failed for their claimed behavior: disabled idle
  exit, stale token routing, reuse during process retirement, cancel-after-stop
  disrupting another stream, and bridge disposal leaving the helper alive.
  Exact source restoration is guaranteed in `finally`; final checks are green.
  Child-process transport fixtures assert lifecycle behavior, not ASR accuracy;
  all recognition and performance claims above use actual Sherpa recordings.
- `npm run check:sdk` stops at the unchanged schema generator. The exact HEAD
  script reproduces `No generated response type found for
  account/gatewayOAuth/read (undefined)` with installed `codex-cli 0.162.1`, before
  it compares repository generated files. `results/schema-baseline-failure.json`
  preserves the baseline evidence. Remaining SDK gates were run directly and
  passed; the unrelated generator/CLI mismatch was not modified.
- The original demo remains reachable on `127.0.0.1:60535` (HTTP 200). No unrelated
  worktree changes were present or introduced. No automatic review was launched.

The separate smoke commands, run serially to avoid competing ASR workloads, are:

```sh
node experiments/sherpa-helper/run.mjs --source --quick
# After packing backend/core and installing them into results/consumer:
node experiments/sherpa-helper/run.mjs --entry=/absolute/path/to/consumer/node_modules/@codex-app-sdk/backend/dist/index.js --label=packed --quick
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron experiments/sherpa-helper/run.mjs --quick --label=electron
node experiments/sherpa-helper/red-check.mjs
```

Generated tarballs, the installed consumer and check logs stay ignored in this
worktree. Only the compact measurement/evidence JSON files are in the intended
diff. The Electron check exercises an unpacked native runtime and child executable;
it is not a signed application's fuse/asar/platform verification.

## Delivery and next step

The diff contains the backend provider/helper/export, optional runtime manifest
and lockfile, Electron opt-in integration, process-boundary regression checks,
asset verification, API/guide documentation and this measurement folder. There
are no models, recordings, generated package tarballs, installed consumer files
or logs in the intended diff. Existing Apple native source/assets are unchanged.

The smallest next production step is to exercise the same provider and recordings
on a Windows x64 and Linux x64 host, then verify each host's local model
provisioning, microphone capture and packaged Electron asset/runtime layout.
No new UI or transcription contract is needed. The host must provision suitable
model files and expose the streaming capability only when its runtime/model are
available. Bundled applications must unpack the helper and Sherpa native packages;
Electron's RunAsNode fuse must permit the child runtime, or a separate Node
executable must be supplied.

Upstream [Sherpa runtime](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE)
and the selected [model card](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26)
identify Apache-2.0 licensing. The published wrapper's optional native package
manifest lists macOS arm64/x64, Linux arm64/x64 and Windows x64/ia32. Package
availability is not execution proof for those other platforms. No Windows/Linux
native run, physical microphone test, or signed/packaged host application is
claimed here. Model-specific redistribution/notices remain the host's concern.

All work remains uncommitted in `feat/sherpa-helper-lifecycle`. Nothing was
committed, pushed, merged, published, or automatically reviewed.
