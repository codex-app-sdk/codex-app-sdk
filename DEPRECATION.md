# Proposed npm deprecation notices

These are draft registry messages for the six `@codex-app-sdk/*` packages.
They have not been applied to npm. Preparing this file does not change package
versions, dist-tags, ownership, publication workflows or installability.

Publish the [migration guide](docs/guide/migration.md) at the linked URL before
applying any message. Verify the replacement package set with a published-package
consumer and finish the intended application cutover before registry deprecation.
Published legacy versions should remain available for existing consumers.

## Copy-ready messages

### `@codex-app-sdk/core`

```text
Superseded by @korus-dev/multi-agent-sdk for agent/session contracts and @korus-dev/agent-ui-sdk/host.js for UI host contracts. Migration: https://codex-app-sdk.github.io/codex-app-sdk/guide/migration.html
```

### `@codex-app-sdk/backend`

```text
Superseded by @korus-dev/codex-sdk for the raw Codex protocol and @korus-dev/multi-agent-sdk for harnesses and sessions. Migration: https://codex-app-sdk.github.io/codex-app-sdk/guide/migration.html
```

### `@codex-app-sdk/vue`

```text
Superseded by @korus-dev/agent-ui-sdk. Migrate the conversation controller and stylesheet imports: https://codex-app-sdk.github.io/codex-app-sdk/guide/migration.html
```

### `@codex-app-sdk/electron`

```text
Use @korus-dev/agent-ui-sdk/electron.js and /electron/preload.js for native capabilities, with an application-owned session bridge. Migration: https://codex-app-sdk.github.io/codex-app-sdk/guide/migration.html
```

### `@codex-app-sdk/web`

```text
Legacy browser-to-host surface transport. Migrate to an application-owned session bridge using @korus-dev/multi-agent-sdk and @korus-dev/agent-ui-sdk. Migration: https://codex-app-sdk.github.io/codex-app-sdk/guide/migration.html#browser-to-host-websocket-bridge
```

### `@codex-app-sdk/create-codex-app`

```text
Use the Agent UI SDK application samples for new projects. Existing generated apps can migrate to the @korus-dev SDKs: https://codex-app-sdk.github.io/codex-app-sdk/guide/migration.html#generated-applications
```

## Published-package qualification

The migration guide targets published Codex SDK `0.167.1`, Multi Agent SDK
`0.26.0` and Agent UI SDK `0.25.0`. At this baseline, use `createHarnessDriver`
and `/renderer`; newer source-tree APIs such as `createHarness` and `/contracts`
are not part of the installed Multi Agent SDK contract. Agent UI SDK still
retains native IPC and surface compatibility names.

Before applying notices, recheck the examples against the intended published
versions and qualify the consuming application's build and runtime. Successful
source-linked builds alone do not establish registry readiness.

## Application of the notices

Registry deprecation is a separate action. When authorized, apply the agreed
messages to the published versions of each package, then read the registry
metadata back to confirm the exact text. There is no need to publish replacement
runtime code just to attach a registry warning. Keep legacy tarballs and their
reference documentation available.

See [npm's deprecation guidance](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/).
