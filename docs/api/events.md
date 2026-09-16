# Event API

## `CodexSurfaceEvent`

Discriminated union of ordered, serializable semantic events.

```ts
surface.onEvent((event) => {
  switch (event.type) {
    case 'conversation.historyReplaced':
      console.log(event.conversationId, event.payload.messages);
      break;
    case 'conversation.historyPrepended':
      console.log(event.conversationId, event.payload.messages);
      break;
    case 'tool.completed':
      console.log(event.conversationId, event.payload.toolPart);
      break;
    case 'file.activity':
      // The host can reveal or focus the file in its own sidebar.
      console.log(event.payload.action, event.payload.path);
      break;
    case 'remoteControl.statusChanged':
      console.log(event.payload.status.status);
      break;
  }
});
```

Every variant carries `seq`, `occurredAt`, `origin`, `type`, and `payload`.
Conversation/turn variants additionally carry their identity.

`conversation.historyPrepended` is emitted during background history
hydration. Its payload contains only the newly materialized messages in
chronological order; it is never a cumulative transcript. Consumers can append
or prepend that batch into a rendered history without replacing the current
snapshot. `readConversationHistory()` / `readHistory()` still waits for all
pages and returns the authoritative complete history.

For demand-paged hosts, `CodexConversationSnapshot.historyState` reports the
selected `loadingStrategy`, `hasOlder`, `loadingOlder`, and `fullyLoaded` state while
`CodexConversation.loadOlderHistory()` advances one opaque server cursor.

Event families cover:

- `surface.*`
- `authentication.*`
- `catalog.*`
- `rateLimits.*`
- `remoteControl.statusChanged`
- `conversation.*`
- `message.*`
- `turn.*`
- `tool.*`
- `plan.*`
- `file.activity`
- `subagent.*`
- `approval.*`
- `clientRequest.*`

`message.delta` includes `messageId`, `itemId`, `delta`, and an optional
`phase: 'commentary' | 'final_answer'`. Completed reasoning summaries arrive
through the full message carried by `message.updated`, avoiding a second
streaming protocol for reasoning content.

`plan.updated` carries the structured execution-plan explanation and steps.
Applying it to a `CodexConversationReplica` also refreshes the snapshot's
`executionPlan`; `plan.delta` and `plan.completed` continue to represent the
separate plan-document tool stream. Plan-mode final answers wrapped in
`<proposed_plan>` are normalized into that same plan-document lifecycle rather
than exposed as tagged assistant text.

A locally submitted prompt is first published optimistically through
`message.appended`. After `turn/start` returns, `message.updated` republishes
that same message ID with its authoritative `turnId`; event-replicating hosts
should replace the optimistic message so turn actions remain available.

`clientRequest.requested` covers blocking tool questions and non-blocking
questions carried by asynchronous agent messages. Both use the same
`respondToClientRequest()` action. Async questions additionally arrive as a
`question` part on `message.appended` or `message.updated`, keeping the prompt
and its interaction colocated in replicated message state.

`remoteControl.statusChanged` projects app-server remote-control connection
notifications into the surface event stream. Its payload contains the current
typed status so hosts can update native behavior such as sleep prevention
without polling or depending on app-server protocol types.

## File activity

`file.activity` is a host-facing notification emitted when a live Codex tool
identifies a file operation. It is intentionally additive: the SDK does not
open, edit, or display the file, so an application can use it to reveal a file
in its own sidebar or editor.

```ts
type FileActivityEvent = {
  type: 'file.activity';
  conversationId: string;
  turnId: string;
  payload: {
    messageId: string;
    itemId: string;
    path: string;
    action: 'read' | 'edit' | 'create';
    status: 'running' | 'completed' | 'failed';
  };
};
```

`path` is an absolute path whenever the app-server provides a working
directory. `action` describes the operation, and `status` can be emitted more
than once as a tool progresses. Delete operations do not produce this event;
hosts that need delete notifications should use the underlying tool events.

## Sub-agent events

`subagent.toolCallChanged` and `subagent.activity` expose app-server collaboration
items to hosts without adding a standard SDK rendering. This keeps agent-tree and
workspace presentation application-owned while avoiding generated protocol types
in host UI code.

Tool-call events include the operation, lifecycle/status, sender and receiver
conversation IDs, spawn options, and last-known agent states. Activity events
include the activity kind, agent conversation ID, and agent path. Conversation
summaries additionally expose `sessionId`, `parentConversationId`,
`agentNickname`, and `agentRole` when app-server supplies them.

`CodexSubagentEvent` extracts these variants for app-owned routing:

```ts
const handleSubagentEvent = (event: CodexSubagentEvent) => {
  if (event.type === 'subagent.toolCallChanged') {
    updateAgentTree(event.payload.toolCall, event.payload.lifecycle);
  }
};
```

## `CodexConversationEvent`

Extracts only variants with a `conversationId`. Returned by conversation-handle
subscriptions.

`conversation.queueChanged` carries the current bounded queued-prompt list.
`conversation.historyReplaced` and `conversation.historyPrepended` include the
turn and paging metadata needed by `createCodexConversationReplica()` to remain
authoritative across rollback and lazy history loading. See the
[conversation-targeted bridge](/api/surface#conversation-targeted-bridge) for
the one-snapshot-then-events transport pattern.

## Event origin

```ts
type CodexSurfaceEventOrigin = 'action' | 'notification' | 'lifecycle';
```

- `action`: originated from a high-level SDK action;
- `notification`: originated from app-server;
- `lifecycle`: connection, cleanup, resynchronization, or other surface work.

## Generic event bus

`@codex-app-sdk/core/events` exports:

```ts
import { TypedEventBus } from '@codex-app-sdk/core/events';

type AppEvents = {
  refreshed: { source: string };
};

const bus = new TypedEventBus<AppEvents>();
const stop = bus.on('refreshed', ({ source }) => console.log(source));

bus.emit('refreshed', { source: 'codex' });
stop();
```

Use the generic bus for app-owned typed events. Surface semantic events already
provide their own subscription API.

See the [semantic events guide](/guide/events).
