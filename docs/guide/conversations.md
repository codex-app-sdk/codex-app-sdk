# Concurrent conversations

The surface can keep several conversations loaded and streaming at the same
time. Selection controls the active UI projection; it does not suspend other
conversation runtimes.

## Global catalog

```ts
const current = await surface.listConversations();
const archived = await surface.listConversations({ archived: true });
const matches = await surface.listConversations({ searchTerm: 'release' });
```

The default bootstrap catalog contains global, non-archived app-server threads.
Cloud-only conversations that app-server cannot expose are outside the SDK's
data source.

## Create or select

```ts
await surface.createConversation({
  model: 'available-model-id',
  reasoningEffort: 'medium',
  serviceTier: 'priority',
});

await surface.selectConversation(existingId);
```

## Release inactive local state

Hosts that keep many conversations available can release an idle conversation's
in-memory runtime without archiving or deleting its app-server thread:

```ts
surface.forgetConversation(conversationId);
const conversation = surface.conversation(conversationId);
await conversation.load();
```

`forgetConversation()` keeps the conversation summary, removes the cached
runtime and handle, and clears the active projection only when that conversation
was selected. It performs no remote app-server action. `load()` or
`readHistory()` recreates the local runtime when the conversation is needed
again.

If there is no active conversation, `sendMessage`, `setGoal`, and `startReview`
create one automatically using host defaults.

## Stable conversation handles

In the Node runtime, use `conversation(id)` for background work that must not
change the selected thread:

```ts
const build = surface.conversation(buildThreadId);
const tests = surface.conversation(testThreadId);

await Promise.all([
  build.load({ extensionContext: { agentId: 'build' } }),
  tests.load({ extensionContext: { agentId: 'tests' } }),
]);

build.onStateChange(renderBuildState);
tests.onStateChange(renderTestState);

await Promise.all([
  build.sendMessage('Implement the feature'),
  tests.sendMessage('Exercise the risky boundaries'),
]);
```

Each handle exposes its own messages, active turn, turn IDs, approvals, queue,
goal, model/settings selection, history-loading state, and errors.

`load()` returns the newest 50 turns with full item details first. With the
default lazy loading strategy, older pages remain behind `loadOlderHistory()`;
with eager loading, older full-detail pages hydrate progressively in the
background. This keeps conversation switching responsive without showing a
second, less-detailed summary representation. See
[History and performance](/guide/history) for loading and rendering policies.

## Send rich input

```ts
await build.sendMessage('Review the design and the attached diagram', {
  attachments: [{
    type: 'image',
    path: '/absolute/path/architecture.png',
    detail: 'high',
  }],
  planMode: true,
  skills: [{ name: 'architecture-review', path: '/absolute/skill/path' }],
});
```

The Electron/Vue integration creates these attachment records through the
native picker, paste, and drag/drop pipeline.

## History

```ts
const history = await build.readHistory();
```

`readHistory()` waits for a complete full-detail refresh of the turns currently
available from app-server. History and live notifications are projected through
the same `SurfaceMessage` contract. Generated image results become media parts,
technical calls become tool parts, and restored messages use the same renderer
as new messages.

## Settings and turn actions

```ts
await build.updateSettings({
  planMode: true,
  reasoningEffort: 'high',
});

await build.interrupt();
await build.compact();
await build.rollbackToTurn(turnId);
```

Handles also expose edit, retry, delete-message, steering, reviews, goals,
queued-prompt actions, approval resolution, and app-server question responses.

`sendMessage('/review')` selects uncommitted changes. `/review instructions`
selects a custom review target. Both route through the official `review/start`
operation rather than submitting the slash text as a normal turn.

The app-server's returned review turn is authoritative for the visible user
message. For the default uncommitted target, app-server currently reports
`current changes`; the SDK expands that one exact placeholder to:

> Review the current code changes (staged, unstaged, and untracked files) and
> provide prioritized findings.

The message is therefore available immediately and remains consistent with
restored history; the SDK does not create a separate optimistic `/review`
bubble. `startReview()` uses the same turn materialization. Review output from
the canonical `exitedReviewMode` item is rendered once, while app-server's
derived duplicate `agentMessage` is ignored.

Programmatic targets also include `{ type: 'baseBranch', branch }`,
`{ type: 'commit', sha, title? }`, and `{ type: 'custom', instructions }`.

## Archive and delete

```ts
await surface.archiveConversation(conversationId);
await surface.unarchiveConversation(conversationId);
await surface.deleteConversation(conversationId);
```

Archive is reversible. Delete uses app-server's permanent thread deletion
method and should always be confirmed in product UI.
