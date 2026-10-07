# @codex-app-sdk/create-codex-app

Scaffold a secure Electron or Express web Vue application powered by Codex App
SDK.

The source is open under Apache-2.0. The scaffolder and SDK packages are public
on npm; no package token is required. See the
[installation guide](https://codex-app-sdk.github.io/codex-app-sdk/guide/installation.html#package-access)
if migrating from older GitHub Packages releases.

```bash
npx @codex-app-sdk/create-codex-app@latest my-codex-app
npx @codex-app-sdk/create-codex-app@latest my-codex-web --target web
```

See the canonical
[scaffolding guide](https://codex-app-sdk.github.io/codex-app-sdk/guide/scaffolding.html)
for publication status, npm and `npx` usage, repository-checkout usage, and all
command options.

The default `electron` target includes the SDK backend, typed preload APIs, a
conversation sidebar, and the stock Vue conversation pane. `--target web`
generates a thin Express + `ws` host using the same backend, web transport, and
Vue pane. The command refuses to overwrite non-empty directories.
