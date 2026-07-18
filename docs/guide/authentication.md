# Authentication

Authentication state comes directly from app-server `account/read`; the SDK
does not infer it from filesystem contents or error strings.

## Read the state

```ts
await surface.connect();

const { authentication } = surface.getSnapshot();
```

Important fields:

| Field | Meaning |
| --- | --- |
| `status` | Account catalog state: `notLoaded`, `loading`, `loaded`, or `error` |
| `account` | Serializable app-server account information, or `null` |
| `requiresOpenaiAuth` | Whether a null account blocks normal Codex bootstrap |
| `login` | Current login state, login ID, browser URL, and error |

`account: null` and `requiresOpenaiAuth: true` is a normal signed-out state, not
a transport failure. It lets an application render a dedicated landing page.

## Start browser login

From the Node surface:

```ts
const { authUrl, loginId } = await surface.startChatGptLogin();
await shell.openExternal(authUrl);
```

From the renderer controller:

```ts
const login = await surface.startChatGptLogin();
await window.codexAppSdkNative.openExternal(login.authUrl);
```

The SDK tracks `account/login/completed`, refreshes account-dependent catalogs
and conversations, and keeps the same mounted surface usable. The application
does not need to restart after a successful login.

## Cancel or sign out

```ts
await surface.cancelLogin(loginId);
await surface.logout();
```

Logout resets account-dependent state and returns an auth-required surface to
the signed-out landing state.

## Isolated product identity

Give a surface its own `codexHome` when the product should not share the default
Codex identity or persisted threads:

```ts
const surface = createCodexSurface({
  codexHome: path.join(app.getPath('userData'), 'codex-home'),
});
```

`codexHome` is applied only to the spawned app-server child. It is main-process
configuration and never crosses the renderer IPC boundary.

::: warning Account replacement
If credentials are replaced underneath a running app-server and the reported
account payload has no identity change the SDK can observe, restart the surface
so app-server and surface state begin from the same session. The account switch
itself is an app-server lifecycle concern.
:::
