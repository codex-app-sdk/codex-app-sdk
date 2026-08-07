# {{displayName}}

Express, `ws`, and Vue application powered by [Codex App SDK](https://github.com/nbonamy/codex-app-sdk).

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`. The starter uses the default Codex home and its
existing local authentication.

The generated renderer contains only the SDK web client and stock conversation
pane. Express owns HTTP and site authentication; `ws` owns the upgrade; the SDK
owns protocol framing and surface routing. Replace `authenticateSiteRequest()`
and `acquireCodexSession()` with your website's session lookup and per-user
backend/process pool. Stable `codexHome` directories, stored tokens, quotas,
and persistence remain host concerns.

## Commands

- `npm run dev` builds and starts the local server.
- `npm run build` creates the browser and server bundles.
- `npm start` builds and starts the application.
- `npm run typecheck` checks the TypeScript and Vue source.
