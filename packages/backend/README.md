# `@codex-app-sdk/backend`

The trusted Node.js runtime for Codex applications. It owns app-server protocol
handling, process and socket transports, `CodexSurface`, and `CodexAppBackend`.

Renderer code should depend on `@codex-app-sdk/core` and a host adapter instead
of importing this package.
