# Codex App SDK: open-source readiness review

**Verdict:** The engineering is strong: input validation at the bridges is strict, HTML sanitization holds, test coverage is heavy and there's mutation testing. Three things still block a public launch: the **web scaffold is open to drive-by exploitation**, **Electron's navigation guard was removed**, and **packaging/licensing still assumes a private package**. After those, the biggest quality issue is that **every streamed token sends a full state snapshot** to the renderer.

Validation on `main` (93057bd): lint passes. Tests pass for backend (977), core (148), web (116) and electron (34). The one Vue failure came from uncommitted work someone has in progress (`CodexConversationPane.vue`, etc.), not from `main`.

---

## P0: fix before going public

### 1. Web scaffold: any website can drive Codex (cross-site WebSocket hijacking)
`packages/create-codex-app/template-web/src/server/index.ts:28-45` (and `samples/web/basic/src/server/index.ts`)
- The upgrade handler never checks `Origin`, and `authenticateSiteRequest` always returns the demo user. Browsers don't apply same-origin rules to WebSockets, so any page the user visits can open `new WebSocket('ws://127.0.0.1:3000/codex')`. From there it can call `sendMessage`, `resolveApproval`, or `updateConversationSettings` (including the `full-access` preset if the profile offers it). That means commands run on the user's machine.
- `docs/guide/security.md:78` tells hosts to check origin, but the code people will copy doesn't do it.
- **Fix:** add an Origin allowlist to the template and the sample. Better still, give `bindCodexWebSocket` an `allowedOrigins` option that rejects anything not listed.

### 2. Electron: navigation guard removed, IPC sender never validated
- `c878f74` removed the `will-navigate` handler from the samples and the scaffold. `packages/create-codex-app/tests/cli.test.mjs` even asserts it's absent. That contradicts `docs/guide/security.md:105` and `docs/guide/electron.md:74`. If it got in the way of Vite reloads, the fix is to allow same-origin and dev-server navigations, not to delete the guard.
- `typed-ipc.ts` `registerIpcMainHandlers` ignores `event`, so any frame can call `sendMessage`, `openExternal`, `readImagePreview`, etc. Add a sender check (an `isTrustedSender(event)` option, checking `senderFrame.url`).

### 3. Packaging and licensing
- Every package has `publishConfig: { access: "restricted", registry: npm.pkg.github.com }`. The workflow is named "Publish private packages", and `installation.md:34` and `scaffolding.md:19` say the packages are private.
- **No LICENSE in the published sub-packages.** `files` lists `dist` and `README.md`. npm only adds a LICENSE automatically if it exists in the package directory, and none of `packages/*` has one.
- **A prebuilt Mach-O binary with no source:** `packages/backend/assets/apple-speechanalyzer-cli`. It ships to npm, and the SDK copies it to tmp and runs it. Commit the Swift source plus a reproducible build before publishing.
- The repo URL differs between files: package.json uses `codex-app-sdk/codex-app-sdk`, the README uses `nbonamy/codex-app-sdk`.
- `README.md:144` says protocol `codex-cli 0.151.0`. The schema and CI use **0.154.0**.
- Missing: `CONTRIBUTING.md`, `SECURITY.md` (important for a project that executes code), `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, issue/PR templates. `plans/modular-packages.md` is an internal planning doc.
- Template deps are hardcoded to `^0.12.5` and will drift. Inject the scaffolder's own version at scaffold time.
- The name "Codex" is an OpenAI brand. Get naming sign-off before launch.

---

## Correctness bugs

### 4. Any listener exception is reported as "malformed JSON" and fails every in-flight request (confirmed)
`codex-stdio-transport.ts:193-205`: the `try` wraps the listener dispatch, not just `JSON.parse`. A throw from the surface or from a host `onStateChange` (for example `webContents.send` on a destroyed window) becomes `RpcTransportProtocolError` with no requestId. Then `client.ts:376` → `rejectAll()` rejects everything pending.
Probe result: a throwing notification listener made an unrelated pending `thread/list` reject with `"Codex app-server sent malformed JSON"`.
**Fix:** wrap only the parse, and isolate listeners (also in `CodexSurface.patch`/`emitEvent`).

### 5. Executable discovery blocks the Electron main thread on every connect
`codex-stdio-transport.ts:52-54` → `codex-executable.ts:79-126`
- Each `start()` spawns **4 synchronous login shells** with **no timeout** (`withCodexRuntimePath` and `discoverCodexExecutable` each run `codexRuntimePathEntries`). It still spawns 2 when `command` is set explicitly.
- Each shell takes ~0.5 s here, so that's about 2 s of main-thread freeze per connect and reconnect. A blocking rc file hangs it forever.
- `/Applications/ChatGPT.app`'s bundled codex comes before the user's `PATH`.
- The nvm lookup sorts as plain strings, so `v22.9.0` beats `v22.11.0`.
- **Fix:** run discovery async with a timeout, cache the result, skip it when `command` is set, and check `PATH` first.

### 6. Attachment temp files are never deleted
`codex-native-ipc.ts:99`: each paste/drop does `mkdtemp` + write, and nothing ever removes the files. `attachments.clear()` only clears the map, so pasted screenshots stay in `$TMPDIR`.

### 7. The web transport handles requests one at a time
`web/src/server.ts:179`: `interrupt` waits behind any slow operation (history load, 15 s RPC timeout). Electron doesn't queue, so the same API behaves differently per transport.

---

## Performance: a full snapshot for every token

`CodexSurface.patch` (`codex-surface.ts:1188`) deep-clones the whole state for every listener. Electron (`codex-surface-ipc.ts:213`) and web (`server.ts:136`) forward it. `useCodexSurface` then runs `Object.assign(state, snapshot)`, which replaces `messages` with brand-new objects.

Measured per streamed delta (active conversation, JSON-serialized the way IPC/WS would):

| History | Snapshot/token | Cost/token |
|---|---|---|
| 10 turns | 29 KB | 0.12 ms |
| 200 turns | **524 KB** | 1.24 ms |
| 1000 turns | **2.6 MB** | 6.05 ms |

At ~50 tok/s and 200 turns, that's about 26 MB/s over IPC, and Vue re-renders every message. `ChatMessageBlock.vue:16,23` also re-parses markdown inline on every render.
The fix already exists: `core/conversation-replica.ts` (622 lines) applies the small event stream, but none of the SDK's own transports or `useCodexSurface` use it. Wire it in, or at least coalesce snapshots per frame, and cache rendered markdown per block.

---

## API and design (cheapest now, permanent after launch)

8. **Remove compatibility baggage before anyone depends on it.** That's the root `codex-app-sdk` facade plus `src/`, the `@deprecated` aliases (`core/native.ts:23-51`, `vue/native-capabilities.ts:44`), and the `lazyMessages` prop. There are no external users yet, so nothing needs a migration path.
9. **`CodexConversationPane` has about 75 props and three state sources** (controller > "legacy props" > surface), in a 1,920-line SFC. Keep two modes (surface or controller) and delete the props mode.
10. **The renderer API depends on a server-side "active conversation."** `selectConversation` changes the shared surface. In the web template every socket gets the same `backend.surface`, so two tabs fight over it. `startLiveChat` already takes a `conversationId`, so the API is inconsistent. A per-conversation bridge already exists; build the public API on it.
11. **`CodexSurface` constructor:** 17 controllers wired with hand-written callback bags (~300 lines, `codex-surface.ts:169-477`). Closures point at controllers that don't exist yet (line 173 uses `this.lifecycle`, which is assigned at line 329). A shared host-context object would remove most of this and the ordering trap.
12. **The bridge operation list is repeated in about 6 places:** core list + arities + switch, and Electron channels + `SurfaceRequests` + handlers + renderer API (`codex-surface-ipc.ts:40-268`). Derive the Electron channels as `codex-surface:${op}` from core: about 200 fewer lines and no drift.
13. **i18n is half-done:** `provideCodexChatTranslate` exists, but 11 SFCs hardcode English (`ChatMermaidBlock.vue:66-69`, `ChatMediaBlock.vue:73-78`), and so does `'Add Files & Photos'` (`codex-native-ipc.ts:116`).
14. **No runtime protocol check:** `codexSchemaCliVersion` is exported but never compared against the binary that discovery picked (which may be the ChatGPT.app one).

---

## What's already good
- The bridges validate input strictly: plain-object checks, `onlyKeys`, arity tables, size limits.
- Markdown is safe: scheme allowlist, raw HTML escaped, KaTeX `trust: false`. I fed mermaid XSS payloads through `beautiful-mermaid` and they were escaped.
- The attachment registry keeps filesystem paths out of the renderer. Buffers are bounded. Renderer options can't set `cwd`.
- 95% coverage thresholds, Stryker mutation testing, benchmarks. No TODO or `console.log` in `src`.

## Suggested order
1. P0 #1–#3 (security + packaging)
2. Bugs #4, #5
3. Remove compat baggage (#8)
4. Snapshot→replica streaming
5. Pane API cleanup (#9, #10), then the internal refactors (#11, #12)
