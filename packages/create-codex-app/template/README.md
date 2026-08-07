# {{displayName}}

Electron and Vue application powered by [Codex App SDK](https://github.com/nbonamy/codex-app-sdk).

```bash
npm install
npm run dev
```

The generated application uses the explicit backend, Electron, core, and Vue
packages. It keeps the Codex runtime in Electron main, exposes the SDK's typed
preload bridge, and renders the stock conversation pane in Vue.

Start by updating `src/renderer/App.vue` and `styles.css` with your product
shell. Add trusted backend modules or MCP servers from `src/main/index.ts` while
keeping renderer privileges behind the typed preload boundary.

Architecture and extension guidance lives in the [generated target
tour](https://nbonamy.github.io/codex-app-sdk/guide/quick-start) and [Electron
integration guide](https://nbonamy.github.io/codex-app-sdk/guide/electron).

## Commands

- `npm run dev` starts Vite and Electron with hot reload.
- `npm run build` creates production main, preload, and renderer bundles.
- `npm start` builds and launches the production application.
- `npm run typecheck` checks the TypeScript and Vue source.
