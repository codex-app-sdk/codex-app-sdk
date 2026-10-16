# Shared Sherpa speech helper

Completed: opt-in SDK streaming provider with one lazy helper process, shared
recognizer, independent streams and bounded idle retention; packaged helper and
optional native runtime; Electron integration; explicit local model files;
existing Apple speech and UI contracts preserved. Process-boundary regressions
were demonstrated red/green. Real recordings passed through source, built,
packed and Electron runtime paths; ten cold/warm latency and macOS footprint runs
are captured in results. Package, compatibility, docs and consumer gates passed.
The unrelated baseline schema-generator failure is documented. Work is left
uncommitted for review. See REPORT.md for evidence, limits and the next step.
