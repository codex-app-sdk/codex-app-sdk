# Troubleshooting

## No conversations appear

Check which `CODEX_HOME` the app-server child is using. A configured `codexHome`
creates an intentionally isolated catalog; the default surface uses the normal
Codex home.

Do not pass `cwd` just to list conversations. The SDK loads the global catalog
by default. Use `listConversations({ cwd })` only for an explicit product filter.

Cloud-only ChatGPT conversations do not appear when app-server cannot expose
them.

## A conversation times out while resuming

Inspect the app-server thread itself before increasing request timeouts. Resume
loads the real persisted history and may expose protocol/runtime failures that a
summary list does not.

The surface keeps resume host options per thread and rejects mismatched thread
IDs returned by app-server.

## Signed out is shown as an error

Treat `account: null` with `requiresOpenaiAuth: true` as a normal landing state.
The surface can be `ready` while authentication is required.

Use `startChatGptLogin()`, open `authUrl`, and let the mounted surface process
the completion event.

## Models, permissions, or threads are empty after login

Use the current SDK auth lifecycle. It refreshes auth-dependent bootstrap state
after `account/login/completed`. Do not cache the initial signed-out catalogs in
application code.

## Permission selection has no effect

Render presets from `state.approvalPresets` and call
`updateConversationSettings({ approvalPreset })`. The main surface validates the
selection against app-server's current permission profiles.

Raw `approvalMode` and `permissionMode` are host configuration, not renderer
settings.

## Recording stops without transcription

Check `window.codexAppSdkNative.capabilities.transcription`. Default
transcription is available on supported macOS hosts and depends on the packaged
Apple speech helper. Other platforms need a custom main-process transcriber.

The stock presentation omits the voice control when it is unavailable or
explicitly hidden.

## Generated images disappear when tool blocks are hidden

Use a current SDK. Generated image completions are projected into media parts
for both live notifications and restored history. Media remains renderable when
`presentation.messages.toolBlocks` is `false`.

## File mentions show no results

File mentions require the host to provide `CodexConversationPane`'s `files`
prop. Native picker, paste, and drag/drop are separate attachment capabilities.

## The app cannot find Codex

Verify the executable from the same environment that launches Electron. GUI
applications do not always inherit terminal `PATH`.

The SDK searches common GUI/login-shell locations. As a last resort, set an
explicit trusted `transport.command` in main.

## GitHub Pages is blank or assets 404

The VitePress config uses `base: '/codex-app-sdk/'`. In repository settings,
select **Settings → Pages → Build and deployment → GitHub Actions**. The deploy
workflow uploads `docs/.vitepress/dist`; it does not commit generated output.
