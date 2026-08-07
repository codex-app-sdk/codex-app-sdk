# create-codex-app

Scaffold a secure Electron or Express web Vue application powered by Codex App
SDK.

```bash
npx create-codex-app@latest my-codex-app
npx create-codex-app@latest my-codex-web --target web
```

See the canonical
[scaffolding guide](https://nbonamy.github.io/codex-app-sdk/guide/scaffolding)
for publication status, npm and `npx` usage, repository-checkout usage, and all
command options.

The default `electron` target includes the SDK backend, typed preload APIs, a
conversation sidebar, and the stock Vue conversation pane. `--target web`
generates a thin Express + `ws` host using the same backend, web transport, and
Vue pane. The command refuses to overwrite non-empty directories.
