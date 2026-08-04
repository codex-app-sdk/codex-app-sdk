# Development

## Install and verify

```bash
npm install
npm test
npm run typecheck
npm run build
```

Sample gates:

```bash
npm run sample:test
npm run sample:build
npm run typecheck -w @codex-app-sdk/basic-sample

npm run spark:test
npm run spark:typecheck
npm run spark:build

npm run relay:test
npm run relay:typecheck
npm run relay:build
```

## Documentation

The docs use VitePress, the same stack as `multi-llm-ts`.

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

The GitHub Pages workflow runs `npm ci`, builds the site, uploads
`docs/.vitepress/dist`, and deploys it with the official Pages artifact flow.

Do not commit `.vitepress/cache` or `.vitepress/dist`.

## Generated app-server schema

Checked-in generated bindings currently target `codex-cli 0.144.1`.

```bash
npm run schema:generate
```

The generator records the source CLI version and recreates request/response,
notification, and server-request types. Do not hand-edit generated files.

After regeneration:

1. inspect the schema diff;
2. update method maps and surface projections where needed;
3. regenerate the [JSON-RPC coverage inventory](../api/json-rpc) with
   `npm run rpc:generate`;
4. add strict protocol and high-level behavior tests;
5. run the full SDK and sample gates;
6. update documentation for intentional public changes.

`npm run rpc:check` verifies that the committed inventory matches both the
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
