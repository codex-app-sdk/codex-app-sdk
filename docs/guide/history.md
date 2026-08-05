# History and performance

Conversation history has two independent policies:

1. **loading** decides how much full-detail history enters SDK state;
2. **rendering** decides how many supplied messages Vue mounts in the DOM.

Keeping these separate lets an application retain authoritative history without
paying the renderer cost of mounting every historical tool row.

## Defaults

| Layer | Option | Default | Initial batch | Older batch |
| --- | --- | --- | ---: | ---: |
| Node surface | `loadingStrategy` | `lazy` | 50 turns | 25 turns |
| Vue list/pane | `renderStrategy` | `lazy` | 50 messages | 25 messages |

All app-server history requests use `itemsView: 'full'`. The SDK does not show a
summary representation and later replace it with full tool calls.

## Loading strategy

Configure the default on the surface:

```ts
const surface = createCodexSurface({
  loadingStrategy: 'lazy',
});
```

Or override it for one conversation load:

```ts
await surface.conversation(threadId).load({ loadingStrategy: 'eager' });
```

### Lazy loading

`lazy` returns after the newest full-detail page. The conversation snapshot
reports:

```ts
type CodexConversationHistoryState = {
  loadingStrategy: 'lazy' | 'eager';
  hasOlder: boolean;
  loadingOlder: boolean;
  fullyLoaded: boolean;
};
```

Load one older page with:

```ts
const page = await conversation.loadOlderHistory();
```

`CodexConversationPane` wires this automatically when bound to
`useCodexSurface`. Controlled hosts provide `hasOlderHistory` and
`loadingOlderHistory`, then handle `loadOlderHistory`.

### Eager loading

`eager` also returns the initial full-detail page promptly, then hydrates older
pages in the background. It emits `conversation.historyPrepended` in bounded
message batches, nearest older messages first, yielding between batches so a
renderer can paint progressively.

The event payload is additive and contains only newly materialized messages in
chronological order. It is never the cumulative transcript, and eager hydration
does not end with a redundant full-history replacement.

### Authoritative reads

`readHistory()` and `readConversationHistory()` preserve the stronger contract:
they await exhaustive full-detail hydration and return the authoritative
history currently available from app-server.

Use these methods for export, persistence, or synchronization work that must not
observe a partial transcript. Use snapshots/events for responsive UI.

## Rendering strategy

Vue rendering is lazy by default even if the host supplies a long message array:

```vue
<CodexConversationPane
  :surface="surface"
  render-strategy="lazy"
  :initial-message-batch-size="50"
  :message-batch-size="25"
/>
```

Lazy rendering:

- mounts the newest batch first;
- reveals older mounted batches only after genuine upward navigation near the
  top;
- preserves the visible message anchor when older messages are prepended;
- keeps bottom-follow and the scroll-to-bottom control working;
- keeps the current tail/active streaming row mounted;
- does not let stale historical streaming markers expand the window;
- resets to the newest batch when `conversationKey` changes.

Set `render-strategy="eager"` to mount every supplied message. The deprecated
`lazyMessages` prop remains a compatibility alias; new code should use
`renderStrategy`.

## Progressive prepend behavior

When older messages arrive while the user is still at the newest tail, the list
anchors by message identity. Background prepends therefore do not expand the
mounted window or continually shrink the native scrollbar thumb. Explicit
upward navigation reveals the next batch.

When the user is already reading older content, the list preserves the visible
scroll position rather than jumping to the latest message. New tail messages
only auto-follow when the list was already at the bottom.

## Transform only visible messages

Hosts sometimes need to remove an envelope or adapt app-owned metadata before
rendering:

```ts
type CodexMessageTransform = (
  message: Message | SurfaceMessage,
  absoluteIndex: number,
) => Message | SurfaceMessage;
```

`transformMessage` runs after the lazy slice, so it does not touch unmounted
history. When an older batch becomes visible, only that newly mounted batch is
transformed. Absolute action indexes and original message IDs are preserved.

Avoid mapping the entire history in the host before passing it to the pane; that
defeats this memory boundary even when the SDK mounts only 50 rows.

## Releasing inactive conversations

For many active identities, release an idle runtime without deleting its
app-server thread:

```ts
surface.forgetConversation(threadId);
```

This forgets local runtime/controller/handle state and clears the active
projection only if it points at that thread. It emits no archive/delete action.
`conversation(threadId).load()` or `.readHistory()` recreates the runtime later.

Use `CodexAppBackendTtlCache` when the host needs a tested periodic policy for
calling this only after an identity is inactive and safe to evict. The host
still defines safety—for example, no active generation, queue, or approval.

## App-server history limits

The SDK can only render items materialized by app-server history APIs. Some
low-level execution items may be present in rollout files but absent after an
app-server restart. The SDK does not parse private rollout JSONL as a fallback;
that ownership remains with app-server.

See [Concurrent conversations](/guide/conversations),
[Application backend](/guide/backend), and [Semantic events](/guide/events).
