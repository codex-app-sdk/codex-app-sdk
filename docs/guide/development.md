# Development

## Install and verify

```bash
npm install
npm run check
```

The root quality commands are repository-wide: they cover the five SDK
packages, the compatibility facade, the scaffolder, and every sample workspace.
Use them independently while iterating:

```bash
npm test
npm run lint
npm run typecheck
npm run build:all
```

Each SDK workspace owns its source, tests, Vitest configuration, typecheck,
lint, coverage thresholds, and build commands. Run the complete gate for one
package with:

```bash
npm run check -w @codex-app-sdk/core
npm run check -w @codex-app-sdk/backend
npm run check -w @codex-app-sdk/vue
npm run check -w @codex-app-sdk/electron
npm run check -w @codex-app-sdk/web
```

`npm run check:sdk` runs those five coverage-enforcing package gates plus the
legacy `codex-app-sdk` compatibility facade. `npm run check:workspaces` first
builds the SDK, then checks the scaffolder and all sample workspaces.

The Basic Electron and Basic Web samples expose matching command families:

```bash
npm run dev:electron
npm run start:electron
npm run test:electron
npm run typecheck:electron
npm run build:electron
npm run check:electron

npm run dev:web
npm run start:web
npm run test:web
npm run typecheck:web
npm run build:web
npm run check:web
```

The `dev:*` commands use the SDK source tree directly; do not build the SDK
first. Vite keeps renderer SDK modules in its live module graph for HMR, while
the Basic Web server restarts when its backend or transport source changes.
Production `build:*` and `start:*` commands continue to consume package output.

Root shortcuts consistently use `verb:target`. The other sample applications
keep the same convention:

```bash
npm run test:spark
npm run typecheck:spark
npm run build:spark

npm run test:relay
npm run typecheck:relay
npm run build:relay
```

## Documentation

The docs use VitePress, the same stack as `multi-llm-ts`.

```bash
npm run dev:docs
npm run build:docs
npm run preview:docs
```

The GitHub Pages workflow runs `npm ci`, builds the site, uploads
`docs/.vitepress/dist`, and deploys it with the official Pages artifact flow.

Do not commit `.vitepress/cache` or `.vitepress/dist`.

## Generated app-server schema

Checked-in generated bindings currently target `codex-cli 0.146.0`.

```bash
npm run generate:schema
```

The generator records the source CLI version and recreates request/response,
notification, and server-request types. Do not hand-edit generated files.

After regeneration:

1. inspect the schema diff;
2. update method maps and surface projections where needed;
3. regenerate the [JSON-RPC coverage inventory](../api/json-rpc) with
   `npm run generate:rpc`;
4. add strict protocol and high-level behavior tests;
5. run the full SDK and sample gates;
6. update documentation for intentional public changes.

`npm run check:rpc` verifies that the committed inventory matches both the
generated protocol maps and the high-level SDK handlers. The documentation build
runs this check automatically.

## Package verification

```bash
npm pack --dry-run --json
```

The package should contain built entry points, declarations, source maps,
`codex-app-sdk.css`, native assets, README, and LICENSE—not samples, tests, or
the documentation build output.

## Architectural test philosophy

Tests should prove risky boundaries:

- complete protocol request shapes and event ordering;
- main/renderer policy separation;
- cleanup of every IPC handler and transport listener;
- concurrent conversation identity;
- restored/live message parity;
- auth lifecycle transitions;
- keyboard and interaction behavior in reusable components;
- package export and scoped-style completeness.

Avoid shallow coverage padding and brittle product-name scans.
