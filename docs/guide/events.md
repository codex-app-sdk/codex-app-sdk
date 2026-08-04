# Semantic events

Snapshots make UI state reliable. Semantic events make integrations simple.

```ts
const unsubscribe = surface.onEvent((event) => {
  if (event.type === 'tool.completed') {
    refreshBusinessState(event.conversationId);
  }
});
```

## Event guarantees

Every event includes:

- `type`: a product-shaped discriminant;
- `seq`: a surface-local monotonic sequence number;
- `occurredAt`: an ISO timestamp;
- `origin`: `action`, `notification`, or `lifecycle`;
- `conversationId` when the event belongs to one conversation;
- event-specific serializable data.

The matching snapshot mutation is applied before the event is emitted.

## Event families

| Family | Examples |
| --- | --- |
| Surface | connection, ready/error, bootstrap, close |
| Authentication | account state, login progress/completion, logout |
| Catalogs | conversations, models, skills, plugins, permissions |
| Conversation | selection, settings, rename, archive/delete, history replacement and incremental prepends |
| Messages | add/update/complete/delete, generated media |
| Turns | start/complete/error, interruption, context compaction |
| Tools | start/progress/complete, confirmations, user input |
| File activity | read, edit, and create paths for host-owned navigation |
| Plans and goals | plan updates, goal set/clear/status |
| Queues and diffs | queued prompts, git diff updates |
| Usage | context usage and account rate limits |

## Conversation-scoped subscription

Node conversation handles filter the same stream by identity:

```ts
const conversation = surface.conversation(conversationId);

conversation.onEvent((event) => {
  console.log(event.type, event.conversationId);
});
```

## Vue controller

`useCodexSurface` exposes the last event and a local subscription API:

```ts
const surface = useCodexSurface(window.codexSurface);

const stop = surface.onEvent((event) => {
  if (event.type === 'turn.completed') celebrate();
});
```

Vue scope disposal automatically unregisters the underlying renderer listeners.

## When to use which

- Render from snapshots.
- Use `conversation.historyPrepended` for progressive background hydration;
  each event contains only the newly materialized chronological batch.
- Trigger business refreshes or analytics from semantic events.
- Use `file.activity` to reveal or focus the full path in an app-owned sidebar;
  the SDK reports the operation but does not own file navigation.
- Use `remoteControl.statusChanged` when app-owned native behavior depends on
  whether Codex remote control is disabled, connecting, connected, or errored.
- Never rebuild full conversation state by replaying events.
- Use `readConversationHistory` after a history-replacement event when an
  integration needs the full historical payload.

See the [event API](/api/events).
