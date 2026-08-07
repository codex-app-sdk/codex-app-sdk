# Modular packages and web host

Status: implementation in progress

## Goal

Turn the existing subpath architecture into explicit packages that support both
Electron and browser renderers without duplicating the Codex surface contract or
leaking Node/Electron assumptions into the UI.

The SDK remains Codex-specific. Authentication systems, user/workspace
provisioning, product orchestration, and deployment infrastructure remain owned
by host applications.

## Target architecture

Use five publishable packages representing four logical layers:

| Package | Responsibility | Runtime dependencies |
| --- | --- | --- |
| `@codex-app-sdk/core` | Renderer-safe surface contracts, snapshots, events, bridge operation definitions, and host-capability interfaces | None |
| `@codex-app-sdk/backend` | App-server protocol/client, transports, `CodexSurface`, and `CodexAppBackend` | Node.js |
| `@codex-app-sdk/vue` | Vue composables, conversation UI, and styles | Vue and browser APIs |
| `@codex-app-sdk/electron` | Main/preload/renderer bindings and Electron host-capability implementations | Electron, backend, core |
| `@codex-app-sdk/web` | Browser client and server-side surface binding | Core on the client; backend on the server |

The dependency direction is:

```text
                         +-- Vue UI
Core contracts ----------+-- Electron adapter ---- Backend
                         +-- Web client ----------- Web server adapter ---- Backend
```

The existing `codex-app-sdk` package remains as a compatibility facade during
migration. Its current subpaths re-export from the new packages:

- `codex-app-sdk/surface` -> `@codex-app-sdk/core`
- `codex-app-sdk/node` and `codex-app-sdk/codex` -> `@codex-app-sdk/backend`
- `codex-app-sdk/vue` and `codex-app-sdk/styles.css` -> `@codex-app-sdk/vue`
- `codex-app-sdk/electron` and `codex-app-sdk/electron/preload` -> `@codex-app-sdk/electron`

Package names are working names. Confirm npm scope/publication naming before the
first release; do not let that decision block the internal dependency split.

## Boundary decisions

### Core contract

- Keep generated app-server protocol types out of `core`.
- Keep Node values, Electron objects, raw commands, environment variables,
  trusted workspace paths, and MCP configuration out of renderer-safe APIs.
- Move the allowlisted renderer operation definitions and transport-independent
  validation into `core` so Electron and web use one contract.
- Keep snapshots authoritative. Incremental events remain an optimization and
  integration signal; reconnecting clients resynchronize from a snapshot.

### Host capabilities

Replace direct reads of `window.codexAppSdkNative` in the Vue kit with an
injected `CodexHostCapabilities` interface. It covers attachment selection and
ingestion, clipboard, external links, image previews, and transcription.

- Electron supplies IPC-backed capabilities.
- Web supplies browser-native or server-backed capabilities.
- Optional capabilities have safe defaults so leaf components remain usable in
  ordinary browser and component-test environments.

### Attachments

Separate renderer attachment identity from trusted backend paths.

- The renderer works with metadata plus an opaque attachment reference.
- Electron may resolve the reference to an approved local path.
- Web uploads bytes through a host-authorized endpoint and resolves the returned
  reference inside the server-owned workspace.
- Never accept an arbitrary browser-provided path as a trusted backend path.

### Web transport

Expose two entrypoints from the web package:

- `@codex-app-sdk/web/client` implements `CodexSurfaceRendererApi` over a
  versioned authenticated WebSocket connection.
- `@codex-app-sdk/web/server` binds an already-authorized surface/session to the
  shared renderer operation contract.

Use request IDs for actions and push snapshots/events over the same connection.
On reconnect, fetch a fresh snapshot instead of requiring durable event replay.
Use HTTP only where it is a better fit, initially attachment upload and optional
session bootstrap.

The host application owns authentication and maps a connection to a user and
workspace. The SDK accepts an authorized session/surface factory; it does not
introduce a provider-neutral account or tenancy abstraction. A surface must not
be accidentally shared between unrelated users. Renderer selection and pending
approvals are scoped to the authorized session.

For a multi-user website, the web server binder receives host-authenticated
context and requires the host to return a connection-scoped session lease. The
lease contains the authorized surface, attachment resolver, and release hook.
The browser never selects a user or surface by identifier, and the SDK never
keeps a global user registry. The host owns user sessions, encrypted credential
storage, runner acquisition, quotas, idle eviction, and persistence.

The simplest OpenAI-auth persistence model is a stable, isolated `codexHome`
for each user: the normal `startChatGptLogin()` surface action returns the URL to
the browser and the user's app-server persists its credential state there. A
host-managed token provider may be added to the backend boundary independently;
database and vault policy do not belong in the web transport.

A deployed web app operates on a server-side workspace or runner. Controlling a
user's local repository from a browser requires a separately secured local
companion process and is not implicit in the web adapter.

## Implementation phases

### Phase 1: Establish package infrastructure and extract core

Status: complete

- Add workspace build/test/typecheck conventions shared by SDK packages.
- Extract `surface`, typed events needed by public contracts, and renderer-safe
  host types into `@codex-app-sdk/core`.
- Add explicit package export maps and browser-safe import tests.
- Keep root compatibility exports working throughout the extraction.
- Add a dependency-boundary test preventing `core` from importing Node,
  Electron, Vue, or generated protocol modules.

Validation:

- Focused core contract and package-export tests.
- `npm run typecheck`.
- `npm run build`.

Commit: `feat: extract renderer-safe core package`

### Phase 2: Extract the backend runtime

Status: complete

- Move the app-server protocol/client and Node runtime into
  `@codex-app-sdk/backend`.
- Preserve the low-level protocol API through a backend subpath and the legacy
  `codex-app-sdk/codex` facade.
- Make backend dependencies on `core` explicit.
- Keep process, socket, filesystem, Apple speech, and trusted configuration code
  entirely in backend-side packages.

Validation:

- Existing client, transport, surface, conversation, and backend module tests.
- Backend package typecheck and build.
- Root compatibility import tests.

Commit: `feat: extract backend runtime package`

### Phase 3: Extract and make the Vue kit host-agnostic

Status: complete

- Move Vue components, composables, assets, and CSS into
  `@codex-app-sdk/vue`.
- Add `provideCodexHostCapabilities` and `useCodexHostCapabilities` following
  the repository's Vue provider conventions.
- Replace direct native-global access in composer attachments, image previews,
  clipboard actions, external links, and voice transcription.
- Preserve existing prop-level overrides and safe browser fallbacks.
- Keep the compatibility CSS path and ensure CSS side effects are declared only
  by the Vue package.

Validation:

- Focused provider and affected Vue component/composable tests.
- Vue package typecheck and build.
- Component lab tests/typecheck only where capability scenarios are represented.

Commit: `feat: make vue kit host agnostic`

### Phase 4: Extract the Electron adapter

Status: complete

- Move typed IPC, surface IPC, preload, native operations, and Electron
  integration into `@codex-app-sdk/electron`.
- Rebuild Electron bindings on the shared operation definitions and validation.
- Implement the Vue host-capability contract from the preload API.
- Keep Electron as an appropriate peer dependency rather than a dependency of
  core, backend, or Vue.
- Move the Electron samples under `samples/electron` and update them to consume
  explicit packages while retaining compatibility coverage.

Validation:

- Electron IPC/preload/native tests.
- Basic, Spark, and Relay sample typechecks/tests/builds affected by import
  changes.

Commit: `feat: extract electron adapter package`

### Phase 5: Add the web adapter

- Define the versioned WebSocket envelope using the shared renderer operations.
- Implement request correlation, cancellation/closure behavior, snapshot and
  event subscriptions, reconnect resynchronization, and bounded payload errors.
- Implement the server binder around a host-authorized surface/session factory.
- Add origin/authentication hooks and conservative defaults; never silently
  expose a surface to an unauthenticated connection.
- Implement opaque attachment upload/reference resolution as a narrow host
  extension point.
- Add transport tests covering malformed requests, unauthorized sessions,
  reconnects, concurrent actions, events, and session isolation.

Validation:

- Focused web client/server integration tests.
- Web client browser-safe bundle test.
- Web package typecheck and build.

Commit: `feat: add web surface adapter`

### Phase 6: Add a web application target

- Extend `create-codex-app` with an explicit `electron` or `web` target.
- Update the existing Electron scaffold to consume explicit packages while
  retaining compatibility coverage.
- Keep web host policy minimal: show where the application supplies session
  authorization and workspace creation without embedding product-specific auth
  or infrastructure.
- Add a small runnable web sample demonstrating the stock Vue pane against the
  web adapter.
- Ensure generated applications depend only on the packages required by their
  target.

Validation:

- Scaffolder tests for both targets.
- Build and typecheck one freshly generated application per target.
- Web sample tests/typecheck/build.

Commit: `feat: add web application scaffold`

### Phase 7: Documentation, compatibility, and release hardening

- Update README package discovery and desktop/web starting paths.
- Update architecture, installation, scaffolding, backend, Vue provider, and API
  documentation.
- Document the remote-workspace model and the security boundary around web
  sessions and attachments.
- Verify package file lists, declarations, CSS/assets, export maps, and clean
  consumer installs.
- Decide whether legacy facade exports are merely documented as compatibility or
  formally deprecated for a later major release.

Validation:

- `npm test`.
- `npm run typecheck`.
- `npm run build`.
- Relevant sample, lab, scaffold, and documentation builds.
- `git diff --check`.

Commit: `docs: document modular application targets`

## Review checkpoints

Pause for review after:

1. Core and backend dependency boundaries are established.
2. The host-capability and opaque-attachment contracts are proposed, before
   migrating all Vue components.
3. The web wire envelope and host authorization/session interfaces are proposed,
   before implementing the transport.
4. Both scaffold targets build, before compatibility/deprecation decisions.

## Definition of done

- No browser-safe package imports Node or Electron runtime code.
- Vue can run with Electron capabilities, web capabilities, or safe defaults.
- Electron applications retain current behavior through explicit packages and
  compatibility exports.
- A generated web application can connect to an authorized backend session,
  stream a conversation, handle approvals, reconnect, and upload attachments
  without exposing arbitrary paths.
- Public APIs and security boundaries are documented.
- Full selected repository validation passes with no unexplained failures.
- Work is committed incrementally on `feat/modular-packages`; it is not merged
  back without explicit approval.

## Key learnings

Append durable lessons here as phases complete. Focus on dependency-boundary,
transport, packaging, testing, and migration patterns rather than a list of
files changed.
