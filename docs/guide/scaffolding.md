# Scaffold an application

`create-codex-app` generates a small, runnable application using the SDK's
recommended modular boundaries. Electron + Vue is the backward-compatible
default; `--target web` generates an Express + `ws` + Vue application.

The scaffolder and generated application's SDK dependencies are public on npm
starting with 0.13.0. No package token is needed. Existing GitHub Packages users
should follow the [registry migration notes](/guide/installation#package-access).

```bash
npx @codex-app-sdk/create-codex-app@latest my-codex-app
cd my-codex-app
npm run dev
```

Generate the web target with:

```bash
npx @codex-app-sdk/create-codex-app@latest my-codex-web --target web
```

From a checkout of this repository, you can also run the scaffolder directly:

```bash
npm run create:app -- ../my-codex-app
cd ../my-codex-app
npm run dev
```

For a web target from the repository checkout, append `--target web`:

```bash
npm run create:app -- ../my-codex-web --target web
```

## Scaffold, then update

The generated project is the default starting point for a Codex application:

1. Run it before making changes and confirm Codex discovery and authentication.
2. Update `src/renderer/App.vue` (Electron) or `src/client/App.vue` (web) and
   `styles.css` with the product shell, navigation, and branding.
3. Configure the shared SDK backend in `src/main/index.ts` (Electron) or the
   session acquisition seam in `src/server/index.ts` (web).
4. Add app-owned backend modules or MCP servers next to that backend when the
   product needs capabilities beyond the Codex conversation surface.
5. Keep the host boundary narrow: typed preload APIs for Electron, or
   authenticated HTTP/WebSocket endpoints for web. Expose additional host
   capabilities only for deliberate product features.

This workflow preserves a runnable baseline while the application becomes its
own product. Do not copy a sample wholesale when the scaffold plus one focused
customization is enough.

The initializer installs dependencies by default. Use `--no-install` when a
package manager or automation system will install them later:

```bash
npx @codex-app-sdk/create-codex-app@latest my-codex-app --no-install
```

## Command options

| Option | Behavior |
| --- | --- |
| `[directory]` | Target directory. The CLI prompts for it in an interactive terminal when omitted. |
| `--no-install` | Generate files without installing dependencies. |
| `--package-manager npm` | Select `npm`, `pnpm`, `yarn`, or `bun`. The invoking package manager is detected by default. |
| `--target electron` | Generate `electron` (default) or `web`. |
| `--help` | Print usage and options. |
| `--version` | Print the initializer version. |

The target may be new or empty. The initializer refuses to overwrite a
non-empty directory and has no destructive force mode.

## Programmatic scaffolding

Builder applications and automation can call the same implementation through
the package root:

```ts
import { scaffoldProject } from '@codex-app-sdk/create-codex-app';

const project = await scaffoldProject({
  cwd: '/absolute/parent/directory',
  directory: 'my-codex-app',
  target: 'web',
});
```

The function applies the same naming, template substitution, and non-empty
directory protections as the CLI. Dependency installation remains the caller's
responsibility in this form.

## Generated Electron application

```text
my-codex-app/
├── src/
│   ├── main/
│   │   ├── index.ts
│   │   └── preload.ts
│   └── renderer/
│       ├── App.vue
│       ├── index.html
│       ├── main.ts
│       ├── styles.css
│       └── vite-env.d.ts
├── package.json
├── tsconfig.json
└── vite.config.ts
```

The main process creates `CodexAppBackend`, registers the SDK's Electron and
native-capability bridges, enforces context isolation and renderer sandboxing,
and blocks renderer navigation. The preload exposes only the typed SDK APIs.

The Vue renderer calls `useCodexSurface(window.codexSurface)`, renders an
app-owned translucent conversation sidebar, and passes the controller to
`CodexConversationPane`. Long conversation titles are truncated, the macOS
window uses native vibrancy, and other platforms receive an opaque fallback.
The renderer imports the scoped SDK stylesheet and includes a restrictive
Content Security Policy.

The generated renderer also owns the signed-out landing state. When app-server
reports `account: null` with `requiresOpenaiAuth: true`, it shows a Connect Codex
screen instead of a disabled conversation shell. Browser login uses
`startChatGptLogin()` plus the native external-link bridge, and the same mounted
surface becomes ready after `account/login/completed`. This is especially
important when a host configures a separate `codexHome` for the generated app.

This gives a new application a credible working shell and conversation system
while leaving its navigation, branding, product data, and additional backend
modules app-owned.

## Generated web application

```text
my-codex-web/
├── src/
│   ├── client/
│   │   ├── App.vue
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── styles.css
│   └── server/
│       └── index.ts
├── package.json
├── tsconfig.json
├── tsconfig.server.json
└── vite.config.ts
```

The web renderer contains only `createCodexWebSurfaceClient()`,
`useCodexSurface()`, the shared `CodexConversationSidebar`, and the stock pane.
Express serves the browser bundle and authenticates the upgrade; `ws` accepts
the socket; `@codex-app-sdk/web` owns framing, validation, action correlation,
snapshots, events, and reconnect.

The template's `authenticateSiteRequest()` returns one fixed local demo user,
and `acquireCodexSession()` returns the default backend. Replace those functions
with real website authentication and an isolated per-user backend/process pool.
See [Web integration](/guide/web) before deploying it.

## Next steps

- [Tour the generated targets](/guide/quick-start)
- [Integrate the Electron adapter](/guide/electron)
- [Integrate the web adapter](/guide/web)
- [Add an app-owned panel](/guide/app-ui)
- [Add a model-callable MCP server](/guide/mcp)
- [Add a trusted backend service](/guide/backend)
- [Review the security boundary](/guide/security)
