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
- `approval.*`
- `clientRequest.*`

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
