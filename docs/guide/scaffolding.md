# Scaffold an application

`create-codex-app` generates a small, runnable Electron + Vue application that
uses the SDK's recommended runtime boundaries.

```bash
npm create codex-app@latest my-codex-app
cd my-codex-app
npm run dev
```

The equivalent direct executable form is:

```bash
npx create-codex-app@latest my-codex-app
```

::: warning Package publication pending
`create-codex-app` and `codex-app-sdk` are not yet published to npm. The command
above is the intended public workflow. From a checkout of this repository, use:

```bash
npm run create:app -- ../my-codex-app
cd ../my-codex-app
npm run dev
```
:::

## Scaffold, then update

The generated project is the default starting point for a Codex application:

1. Run it before making changes and confirm Codex discovery and authentication.
2. Update `src/renderer/App.vue` and `styles.css` with the product shell,
   navigation, and branding.
3. Configure the shared SDK backend in `src/main/index.ts`.
4. Add app-owned backend modules or MCP servers next to that backend when the
   product needs capabilities beyond the Codex conversation surface.
5. Keep the typed preload boundary narrow; expose additional host APIs only for
   deliberate product features.

This workflow preserves a runnable baseline while the application becomes its
own product. Do not copy a sample wholesale when the scaffold plus one focused
customization is enough.

The initializer installs dependencies by default. Use `--no-install` when a
package manager or automation system will install them later:

```bash
npm create codex-app@latest my-codex-app -- --no-install
```

## Command options

| Option | Behavior |
| --- | --- |
| `[directory]` | Target directory. The CLI prompts for it in an interactive terminal when omitted. |
| `--no-install` | Generate files without installing dependencies. |
| `--package-manager npm` | Select `npm`, `pnpm`, `yarn`, or `bun`. The invoking package manager is detected by default. |
| `--help` | Print usage and options. |
| `--version` | Print the initializer version. |

The target may be new or empty. The initializer refuses to overwrite a
non-empty directory and has no destructive force mode.

## Generated application

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

This gives a new application a credible working shell and conversation system
while leaving its navigation, branding, product data, and additional backend
modules app-owned.

## Next steps

- [Tour the generated application](/guide/quick-start)
- [Add an app-owned panel](/guide/app-ui)
- [Add a model-callable MCP server](/guide/mcp)
- [Add a trusted backend service](/guide/backend)
- [Review the security boundary](/guide/security)
