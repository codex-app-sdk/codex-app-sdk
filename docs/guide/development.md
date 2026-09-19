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

For a concise repository-wide test run intended for agent workflows, use
`npm run test:ai`. It covers the same test workspaces with compact output and
stops on the first failing suite. It does not replace the lint, build, or
documentation gates in `npm run check`.

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

The Basic Electron sample exposes the full command family:

```bash
npm run dev:electron
npm run start:electron
npm run test:electron
npm run typecheck:electron
npm run build:electron
npm run check:electron
```

The Basic Web sample has no separate unit-test suite; its transport behavior is
covered by `@codex-app-sdk/web`, while its own check typechecks and builds the
real sample:

```bash
npm run dev:web
npm run start:web
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
npm run dev:lab
npm run dev:spark
npm run dev:relay

npm run build:lab
npm run build:spark
npm run build:relay

npm run test:lab
npm run test:spark
npm run test:relay

npm run typecheck:lab
npm run typecheck:spark
npm run typecheck:relay
```

For a single compile-only sweep across all five samples, run
`npm run build:workspaces`. `npm run check:workspaces` also verifies the
scaffolder and executes each sample's owned lint, test, and build gate.

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

Checked-in generated bindings record their exact source CLI version in
`packages/backend/src/codex/schema-version.ts`.

```bash
npm run generate:schema
```

The generator records the source CLI version and recreates request/response,
notification, and server-request types. Do not hand-edit generated files.

`npm run check:schema` regenerates the complete protocol into a temporary
directory using the installed real app-server and fails on any difference. It
does not modify the checkout. This is the compatibility gate: when app-server
changes, refresh the generated schema and make the SDK compile and pass its
behavior tests against the new contract before updating the pinned CI CLI.

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

## Private package publication

The six scoped SDK workspaces publish privately to GitHub Packages. Their
package manifests pin `https://npm.pkg.github.com` as the registry and link each
package to this repository so package permissions follow repository access.

All six packages release in lockstep. While the SDK is pre-1.0, versions use
`0.x.y`: increment `x` for a significant new capability generation, such as a
new supported host architecture, conversation-state model, or authentication
workflow; increment `y` for a compatible minor feature or bug-fix release.
Tests, documentation, internal refactors, and publishing infrastructure do not
require a package version by themselves. The first published baseline is
`0.12.2`, reconstructed from the repository's feature history.

Publishing is intentionally CI-owned. Update all six package versions and
their internal dependency versions together, commit the generated lockfile,
let CI pass, then run the **Publish private packages** workflow on `main`. The
workflow authenticates with its short-lived `GITHUB_TOKEN`; no long-lived
publishing token or repository secret is required.

Package versions are immutable. Re-running the workflow for an already
published version fails instead of overwriting it.

## Architectural test philosophy

Tests should prove risky boundaries:

- app-server behavior through the strict, schema-typed
  `MockCodexAppServer`, driving real `CodexAppServerClient` and `CodexSurface`
  instances rather than mocking SDK controllers;
- complete protocol request shapes and event ordering;
- main/renderer policy separation;
- cleanup of every IPC handler and transport listener;
- concurrent conversation identity;
- restored/live message parity;
- auth lifecycle transitions;
- keyboard and interaction behavior in reusable components;
- package export and scoped-style completeness.

Avoid shallow coverage padding and brittle product-name scans. Do not unit-test
manifest text, npm script strings, or implementation source. Exercise the
behavior instead; keep release invariants in executable release validation.

## Mutation testing

The five SDK packages own independent StrykerJS/Vitest campaigns. Run a whole
package from the repository root with the verb-first shortcuts:

```bash
npm run mutation:core
npm run mutation:web
npm run mutation:electron
npm run mutation:backend
npm run mutation:vue
npm run mutation:all
```

Each package check enforces at least 95% statement, branch, function, and line
coverage. That conventional floor is necessary but not sufficient: mutation
campaigns must also leave no unclassified mutant and no meaningful survivor in
critical behavior.

Backend and Vue are large enough that local investigation should normally use
exact `--mutate` shards through the authoritative workspace command:

```bash
npm run test:mutation -w @codex-app-sdk/backend -- \
  --mutate 'packages/backend/src/node/codex-surface-message-state.ts'
```

Incremental results and HTML reports live under
`reports/mutation/<package>/`. Those local artifacts, including sandboxes and
campaign notes, are ignored by Git. Core, Web, Electron, and Backend use
incremental mode. Vue runs fresh because incremental per-test attribution
misclassifies exercised SFC and API-boundary paths as uncovered. After a test
change, force the exact affected source range so cached mutant results do not
hide the result:

```bash
npm run test:mutation -w @codex-app-sdk/core -- \
  --force --mutate 'packages/core/src/surface-bridge.ts:167-185'
```

Treat every survivor as work to classify, not merely a score penalty. Inspect
the production contract and tests, then record one of: genuine test gap,
equivalent behavior, dead or unreachable code, generated/type-only or
out-of-contract code, or tool limitation. Add the smallest externally
observable regression test for every genuine gap and prove that it kills the
exact mutant with a forced run. Explain equivalent mutants in the campaign log;
prefer a separately committed production simplification when the code is truly
redundant. Timeouts and errors are harness failures, never kills.

The cleaned package break thresholds are Core 99%, Web 91%, Electron 99%,
Backend 98%, and Vue 95%. Ratchet them only upward after a fresh forced package
run and complete survivor classification. Web, Electron, Backend, and Vue run
with related-test discovery disabled because focused validation found false
NoCoverage or survivor results at their API/component boundaries; Core retains
related discovery.

Generated protocol bindings, declarations, fixtures, type-only files, and pure
re-export barrels are outside mutation scope. Any further exclusion requires a
written reason. Mutation testing is intentionally on-demand in GitHub Actions
so normal pull-request CI remains fast.
