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
| `login` | Current login state, login ID, actionable login URL, and error |

`account: null` and `requiresOpenaiAuth: true` is a normal signed-out state, not
a transport failure. It lets an application render a dedicated landing page.

## Start browser login

From the Node surface:

```ts
const { authUrl, loginId } = await surface.startChatGptLogin();
await shell.openExternal(authUrl);
```

From an Electron renderer controller:

```ts
const login = await surface.startChatGptLogin();
await window.codexAppSdkNative.openExternal(login.authUrl);
```

From a browser surface, opening the URL is website UI policy:

```ts
const login = await surface.startChatGptLogin();
window.open(login.authUrl, '_blank', 'noopener,noreferrer');
```

The web transport carries the authentication action and state but does not own
the popup, redirect, or website session. A multi-user host must grant the
socket a surface whose `codexHome` belongs to the already authenticated site
user; never select that identity from a browser-supplied user ID.

The SDK tracks `account/login/completed`, refreshes account-dependent catalogs
and conversations, and keeps the same mounted surface usable. The application
does not need to restart after a successful login.

## Start device-code login

Headless hosts can keep authentication inside the SDK-managed app-server and
show the user a code and URL through their own UI:

```ts
const { loginId, verificationUrl, userCode } =
  await surface.startChatGptDeviceCodeLogin();

showDeviceLogin({ verificationUrl, userCode });
```

The method sends app-server's `chatgptDeviceCode` login request and returns:

```ts
type CodexSurfaceChatGptDeviceCodeLogin = {
  loginId: string;
  verificationUrl: string;
  userCode: string;
};
```

The host displays those values but never receives or persists ChatGPT tokens.
The pending URL is also reflected in `authentication.login.authUrl`. Completion,
errors, cancellation through `cancelLogin(loginId)`, credential persistence in
the surface's existing `codexHome`, and account-dependent refreshes use the same
managed lifecycle as browser login. Repeating the operation while its device
code is pending returns that same login rather than starting another attempt.

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

`codexHome` is applied only to the spawned app-server child. It is trusted Node
host configuration and never crosses Electron IPC or the web transport.

::: warning Account replacement
If credentials are replaced underneath a running app-server and the reported
account payload has no identity change the SDK can observe, restart the surface
so app-server and surface state begin from the same session. The account switch
itself is an app-server lifecycle concern.
:::
