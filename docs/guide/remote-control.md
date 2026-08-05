# Remote control and device pairing

`CodexSurface` exposes app-server's official remote-control RPCs as a narrow,
state-neutral Node facade. The host owns whether to expose the feature, pairing
UI, QR rendering, polling, and device-management screens.

These methods belong in trusted Node or Electron main code. They are not part of
the default renderer-safe `CodexSurfaceApi`.

## Check managed policy

Read app-server configuration requirements before presenting the feature:

```ts
const requirements = await surface.readConfigRequirements();
if (requirements?.allowRemoteControl === false) {
  // Hide or explain the managed restriction.
}
```

`null` means app-server did not return managed requirements. The host should not
interpret it as an explicit allow or deny.

## Read and change status

```ts
const status = await surface.readRemoteControlStatus();

await surface.enableRemoteControl();
await surface.disableRemoteControl();
```

Status values are `disabled`, `connecting`, `connected`, and `errored`, with
server, installation, and optional environment identity.

The methods also accept app-server's optional `{ ephemeral: boolean }` flag.
They return RPC results without mutating the surface snapshot, which keeps the
facade usable by hosts with their own settings state.

Subscribe to semantic changes instead of polling connection status:

```ts
surface.onEvent((event) => {
  if (event.type === 'remoteControl.statusChanged') {
    updateNativeConnectionState(event.payload.status);
  }
});
```

## Start pairing

```ts
const pairing = await surface.startRemoteControlPairing({ manualCode: true });
```

The result contains:

- `pairingCode`: opaque app-server pairing identity;
- `manualPairingCode`: optional human-entered code;
- `environmentId`: environment that will own the client;
- `expiresAt`: app-server timestamp represented as `bigint`.

For the official QR flow, encode this URL:

```ts
const url = new URL('https://chatgpt.com/codex/pair');
url.searchParams.set('pairing_code', pairing.pairingCode);
```

Do not encode the raw pairing code alone as the QR payload. Keep the raw value
for status polling:

```ts
const result = await surface.readRemoteControlPairingStatus({
  pairingCode: pairing.pairingCode,
});

if (result.claimed) finishPairing();
```

Treat pairing codes as opaque and avoid logging them. Stop polling on claim,
expiry, cancellation, or application shutdown.

::: warning IPC serialization
The Node response uses `bigint` for timestamps such as `expiresAt` and client
`lastSeenAt`. Convert those values to an application-owned serializable form
before sending them through JSON or custom IPC.
:::

## List and revoke clients

```ts
let cursor: string | null = null;

do {
  const page = await surface.listRemoteControlClients({
    environmentId,
    cursor,
    limit: 50,
    order: 'desc',
  });

  renderClients(page.data);
  cursor = page.nextCursor;
} while (cursor);

await surface.revokeRemoteControlClient({
  environmentId,
  clientId,
});
```

Revocation is a remote destructive action for that pairing and should be
confirmed by product UI. It does not archive or delete Codex conversations.

## Host responsibilities

The SDK deliberately does not own:

- account/product eligibility and settings copy;
- QR and manual-code presentation;
- polling cadence, cancellation, or expiry countdowns;
- device naming and revoke confirmation;
- sleep-prevention or other native reactions to connection status;
- a relay, authentication protocol, or alternative remote-control service.

Use the official app-server methods for Codex remote control. A product-specific
relay or non-Codex backend remains outside this SDK.

See [Node API](/api/node), [Semantic events](/guide/events), and
[Security boundary](/guide/security).
