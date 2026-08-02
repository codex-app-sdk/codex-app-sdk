# Event API

## `CodexSurfaceEvent`

Discriminated union of ordered, serializable semantic events.

```ts
surface.onEvent((event) => {
  switch (event.type) {
    case 'conversation.historyReplaced':
      console.log(event.conversationId, event.payload.messages);
      break;
    case 'tool.completed':
      console.log(event.conversationId, event.payload.toolPart);
      break;
    case 'file.activity':
      // The host can reveal or focus the file in its own sidebar.
      console.log(event.payload.action, event.payload.path);
      break;
  }
});
```

Every variant carries `seq`, `occurredAt`, `origin`, `type`, and `payload`.
Conversation/turn variants additionally carry their identity.

Event families cover:

- `surface.*`
- `authentication.*`
- `catalog.*`
- `rateLimits.*`
- `conversation.*`
- `message.*`
- `turn.*`
- `tool.*`
- `file.activity`
- `approval.*`
- `clientRequest.*`

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

## `CodexConversationEvent`

Extracts only variants with a `conversationId`. Returned by conversation-handle
subscriptions.

## Event origin

```ts
type CodexSurfaceEventOrigin = 'action' | 'notification' | 'lifecycle';
```

- `action`: originated from a high-level SDK action;
- `notification`: originated from app-server;
- `lifecycle`: connection, cleanup, resynchronization, or other surface work.

## Generic event bus

`codex-app-sdk/events` exports:

```ts
import { TypedEventBus } from 'codex-app-sdk/events';

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
