# History and performance

Conversation history has three independent policies:

1. **loading** decides how many turns enter SDK state;
2. **detail** decides whether completed turns initially include their Working content;
3. **rendering** decides how many supplied messages Vue mounts in the DOM.

Keeping these separate lets an application retain authoritative history without
paying the renderer cost of mounting every historical tool row.

## Defaults

| Layer | Option | Default | Initial batch | Older batch |
| --- | --- | --- | ---: | ---: |
| Node surface | `loadingStrategy` | `lazy` | 5 turns | 25 turns |
| Node surface | `historyItemsView` | `full` | Full details | Same policy |
| Vue list/pane | `renderStrategy` | `lazy` | 50 messages | 25 messages |

## Summary-first history

Use summaries to show the prompt and final answer before loading Working details:

```ts
const surface = createCodexSurface({
  loadingStrategy: 'lazy',
  historyItemsView: 'summary',
});
```

Completed turns show `Done · 1m 49s · View details` when a duration is available.
Opening the disclosure loads that turn's full items, including intermediate
steering messages, commentary, reasoning, and tools. Reopening uses the cached
details. Loading failures offer a retry. Active turns load full items and
continue streaming normally.

Surface-bound panes request details automatically. Controlled hosts supply
`turns` and `actions.loadTurnHistory(turnId)` through their pane controller, or
handle the pane's `loadTurnHistory` event:

```ts
await conversation.loadTurnHistory(turnId);
```

`turns[].itemsView === 'summary'` identifies partial turns; `detailsLoading`
and `detailsError` describe their request state. Missing `itemsView` means full.
Original-history tool screenshots enter after detail expansion; their image
bytes still load lazily through the existing content reader.

Override the policy per conversation with `load({ historyItemsView: 'summary' })`.
On an already loaded handle, a load containing only history policy options
preserves the current window, cursor, subscriptions, and active turn.
`load({ historyItemsView: 'full' })` also awaits details for every loaded summary
turn and makes future pages full. Switching back to summary keeps cached details.

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

`lazy` returns after the newest page in the selected detail policy. The conversation snapshot
reports:

```ts
type CodexConversationHistoryState = {
  loadingStrategy: 'lazy' | 'eager';
  itemsView?: 'full' | 'summary'; // omitted means full
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

Event-driven hosts should forward `conversation.historyStateChanged` as well
as history message events to `createCodexConversationReplica()`. It tracks
request start, completion, and failure, including empty pages; a finished page
must clear `loadingOlder` before the user can request another one. No thread
switch or full-snapshot refresh is needed between pages.

### Eager loading

`eager` also returns the initial page promptly, then hydrates older
pages in the background. It emits `conversation.historyPrepended` in bounded
message batches, nearest older messages first, yielding between batches so a
renderer can paint progressively.

The event payload is additive and contains only newly materialized messages in
chronological order. It is never the cumulative transcript, and eager hydration
does not end with a redundant full-history replacement.

### Authoritative reads

`readHistory()` and `readConversationHistory()` preserve the stronger contract:
they await exhaustive full-detail hydration and return the authoritative
history currently available from app-server, without changing the configured
detail policy for future UI pages. During an active turn, reads preserve the
current live window and fill its unloaded details.

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
- reveals older mounted batches and requests the next history page after
  genuine upward navigation comes within one viewport of the top;
- preserves the visible message anchor when older messages are prepended;
- keeps bottom-follow and the scroll-to-bottom control working;
- keeps the current tail/active streaming row mounted;
- does not let stale historical streaming markers expand the window;
- opens an unseen `conversationKey` at the newest batch and restores the
  mounted window and scroll position when returning to a previously viewed
  conversation.

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
only auto-follow when tailing is active. Submitting a prompt enables tailing;
each incoming message update follows the bottom until the user scrolls away.
The scroll-to-bottom control reflects actual overflow and re-enables tailing.

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

Text and tool details come from app-server history APIs. Some low-level
execution items may be absent after an app-server restart. The optional
`originalHistoryImages` reader recovers recorded image outputs from the
provider's original history without writing an archive or changing that history;
it does not reconstruct missing text or tool operations.

See [Concurrent conversations](/guide/conversations),
[Add a backend service](/guide/backend), and [Semantic events](/guide/events).
