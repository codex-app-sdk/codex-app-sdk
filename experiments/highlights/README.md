# Highlights prototype

This isolated experiment compares the SDK's existing Shiki JavaScript renderer with `@pierre/highlights` 0.2.0. The benchmark retains its standalone adapter so it can compare the original Shiki path with Highlights. The prototype converts themed tokens into escaped HTML with per-line wrappers, which the SDK's message-copy path requires. The direct HTML measurement is a lower bound; that output does not contain those wrappers.

From the repository root, after installing its dependencies:

```sh
npm install --prefix experiments/highlights --workspaces=false --ignore-scripts
./node_modules/.bin/tsx experiments/highlights/benchmark.ts
```

The benchmark uses excerpts of the SDK's own Markdown renderer as TypeScript input. It measures warmed Node execution, including token-to-HTML conversion and UTF-8 decoding, and simulates 40 full re-renders of growing code. It does not measure Vue, Markdown parsing, DOM construction, paint, initialization, browser bundling, or incremental tokenization. Results are not end-to-end UI timings. The script checks line text, escaping, and dual-theme variables in the prototype output.

The benchmark's adapter uses the SDK renderer as its fallback for unsupported languages.

To check the production renderer in an isolated Electron window, including a CSP that blocks Wasm:

```sh
node experiments/highlights/electron-validation.mjs
```

This fixture verifies that the Vue view switches to Highlights after initialization and that blocked Wasm leaves the Shiki rendering intact. It does not launch a host application.

## Example result

On an Apple M2 Max, Node 26.12.1, using the median of seven warmed batches:

| TypeScript input | Shiki JS | Highlights tokens + line HTML | Highlights HTML |
| --- | ---: | ---: | ---: |
| 1,061 bytes | 4.138 ms | 0.089 ms | 0.009 ms |
| 4,926 bytes | 16.369 ms | 0.431 ms | 0.037 ms |
| 8,158 bytes | 27.259 ms | 0.681 ms | 0.058 ms |

Forty full re-renders of the growing 4,926-byte input took 364.29 ms with Shiki and 9.13 ms with the Highlights prototype. This does not exercise Highlights' streaming tokenizer.
