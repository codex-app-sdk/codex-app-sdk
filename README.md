# codex-app-sdk

`codex-app-sdk` is a reusable foundation for building native Codex surfaces.
It packages the seams that a product should share without importing Codex
Claw's teams, persistence, loops, Git workflows, or product state.

The SDK is being built around four public layers:

- a bidirectional, strongly typed Codex app-server client;
- transport adapters, beginning with JSONL-over-stdio;
- a transport-neutral event bus and typed Electron IPC adapters;
- Vue components for composers, messages, and message lists.

## Generated app-server types

Codex app-server's schema is version-specific. The checked-in bindings are
generated from the local Codex CLI and include experimental APIs because rich
surfaces need goals, plans, approvals, and streamed item events.

```bash
npm run schema:generate
```

The generator records the source CLI version and creates method maps that pair
every generated request's parameter and response types. Applications consume
those maps through the typed client instead of assembling JSON-RPC envelopes.

## Development

```bash
npm install
npm test
npm run test:coverage
npm run typecheck
npm run build
```

The package targets Node 22 or newer and Vue 3.5. Vue is a peer dependency so
applications keep ownership of their renderer runtime.

