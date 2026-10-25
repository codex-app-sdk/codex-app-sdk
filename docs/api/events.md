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
`conversation.historyStateChanged` carries `{ historyLoading, historyState,
error }` whenever loading or paging state changes, including completion and
failure without new messages. `createCodexConversationReplica()` applies these
events so `loadingOlder` clears after each request without another snapshot.

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

## Execution usage

`conversation.executionUsageChanged` carries `{ usage: CodexSurfaceExecutionUsage }`
with stable `conversationId` and `turnId`. Each observation includes:

- `last`: the provider's latest counters, without stable request identity or finality;
- `total`: provider thread counters, which may be replayed or reset;
- `observedStart`: whether this surface instance observed this turn starting;
- `execution`: cumulative counts since that start, or `null` when attribution is unknown;
- `model`: `null` without authoritative whole-execution model evidence.

`execution` is computed only from a known prior thread-counter baseline and an
observed start. A successful SDK `thread/start` establishes a zero baseline for
the new empty conversation, allowing its first turn to be attributed. Provider
counters already observed before that response are preserved. Resumed and
forked conversations do not assume a zero baseline.
Missing baselines, decreasing or synthetic context-only
counters, overlapping late turns, and history replacement leave attribution
unknown. Absent cache-write counts remain `null`, not zero. These observations
do not classify provider packets as independently verified live or replayed
traffic: `observedStart` describes SDK-local lifecycle evidence.

Replace stored usage by `(conversationId, turnId)`; never add successive
samples, `last`, or thread totals. `observedStart: false` observations should
not erase previously retained live usage. For observed executions, a later
`execution: null` invalidates earlier attribution. `turn.completed` includes
the latest `executionUsage` projection, and late usage replacements can still
arrive after completion. There is no immutable final-consumption guarantee;
these counters are unsuitable for irreversible positive-only telemetry.

`CodexSurfaceTokenUsage` contains `totalTokens`, `inputTokens`,
`cachedInputTokens`, nullable `cacheWriteInputTokens`, `outputTokens`, and
`reasoningOutputTokens`. Cached reads are included in input; reasoning is
included in output. Do not sum those subsets again. The app-server does not
guarantee how cache writes relate to input, so do not claim disjoint uncached
input by subtracting cache writes without additional provider evidence.

`CodexSurfaceTurn.executionUsage?` and conversation replicas retain the latest
projection for materialized turns. `turn.modelRerouted` separately carries
`{ fromModel, toModel, reason }`; a reroute is not evidence that one model owns
all of a turn's usage.

### Request usage capability

`CodexSurfaceExecutionUsage.requestUsage?: CodexSurfaceRequestUsage` reports
whether these counters establish independently billable requests. The current
public runtime projection is:

```ts
{
  status: 'unavailable',
  reason: 'public-runtime-request-evidence-unavailable',
  unavailableFields: [
    'requestIdentity', 'timestamp', 'actualModel', 'actualProvider', 'requestTokenUsage',
    'cacheWriteLifetimes', 'cacheWriteInputInclusion', 'pricingContext',
    'requestedModel', 'requestedServiceTier', 'reportedServiceTier', 'finality',
  ],
  requests: null,
}
```

`unavailableFields` contains `CodexSurfaceRequestUsageField` values. These
fields lack **public request-attributable evidence**; some have thread-level
counterparts described below. `requests: null` means unknown request coverage,
not zero requests or zero cost. Absence of `requestUsage` on an older SDK's
projection also means unknown support. No supported request DTO is promised
until a public protocol can establish its identity and update semantics.

The capability accompanies every `conversation.executionUsageChanged`
replacement and is retained in `CodexSurfaceTurn.executionUsage`, conversation
replicas, and `turn.completed.payload.executionUsage` when usage was observed.
Without an observed usage packet, terminal usage may remain `null`.
It never converts `last`, cumulative deltas, turn IDs, event sequence numbers,
or local observation times into requests. Duplicate packets, streaming updates,
retries, reroutes, overlapping turns, resume/fork, and reconnect/replay cannot
produce request observations through this projection. Completion does not make
request evidence final, and late counter replacements remain possible. Hosts
should retain unavailable coverage rather than charge counters as requests.

#### Public runtime field capability matrix

The SDK bindings target `codex-cli 0.154.0`. The same usage shapes and
internal-only marker were also inspected in `codex-cli 0.164.0`. This is schema
and protocol-fixture evidence, not a claim of measured live API billing.

| Evidence | Available public field | Request-pricing capability |
| --- | --- | --- |
| Parent identity | `threadId`, `turnId` on `thread/tokenUsage/updated` | Identifies a conversation/turn, not a billable request |
| Request identity | None on the public counter notification | Unavailable; identical `last` values cannot establish distinct requests |
| Timestamp | No upstream timestamp on the usage notification | Unavailable; event `occurredAt` is SDK observation time |
| Actual model/provider | No model/provider on the usage notification | Unavailable; thread settings and `model/rerouted` do not associate counts with each served request |
| Input/output | `last`/`total.inputTokens`, `outputTokens`, `totalTokens` | Counter evidence only; no stable request association |
| Cache reads | `cachedInputTokens` | Included in input; never add it again |
| Reasoning output | `reasoningOutputTokens` | Included in output; never add it again |
| Cache writes | `cacheWriteInputTokens` when supplied | Count preserved; legacy absence stays `null`; input inclusion and billable lifetimes are unspecified |
| Pricing context | `modelContextWindow` | Model capacity, not a request input/context pricing measure |
| Requested model/tier | Thread/turn configuration and selected settings | Selection evidence only; unavailable per request without request correlation |
| Reported service tier | None on the usage notification | Unavailable; never substitute the selected tier |
| Provisional/final | No request update/finality field | Unavailable; turn completion does not finalize each upstream request |
| Internal response completion | `rawResponse/completed` has `responseId` and nullable usage | Explicitly internal-only; not a supported public billing boundary |
| Internal metadata | `ResponseUsageMetadata.amount` and opaque `metadata` | No typed model, served tier, timestamp, context, or lifetime contract; not parsed as pricing evidence |

The generated schema includes internal-only notifications even without
`--experimental`; presence in generated TypeScript alone does not establish a
supported public capability. `ThreadStartParams.experimentalRawEvents` is also
explicitly for internal use. The SDK does not opt into raw events for pricing.

Reproduce the schema inspection outside the checkout (use either inspected
version):

```sh
npx --yes --package @openai/codex@0.154.0 codex app-server generate-ts --out /tmp/codex-usage-public
```

Inspect `v2/ThreadTokenUsageUpdatedNotification.ts`, `ThreadTokenUsage.ts`,
`TokenUsageBreakdown.ts`, `RawResponseCompletedNotification.ts`,
`ResponseUsageMetadata.ts`, and `ThreadStartParams.ts` in that output. Add
`--experimental` to compare the full generated surface. `npm run check:schema`
checks the committed full bindings against the installed CLI; use 0.154.0 for
that repository check.

#### Numeric protocol fixtures

`packages/backend/tests/codex-surface-execution-usage.spec.ts` drives the
schema-typed `MockCodexAppServer` through the real client and surface. All data
is synthetic and contains no recorded prompts or secrets.

| Counter fixture | Total | Input | Cache read | Cache write | Output | Reasoning |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 100 | 60 | 20 | 5 | 40 | 10 |
| Updated thread total | 160 | 100 | 30 | 8 | 60 | 15 |
| Latest counters (`last`) | 20 | 15 | 5 | 1 | 5 | 1 |
| Attributable execution delta with known baseline | 60 | 40 | 10 | 3 | 20 | 5 |

These fixtures prove preservation of supported numeric evidence and explicit
absence of request evidence. Repeated `last = 20` is never emitted as another
billable request. A late total of 170 replaces the execution delta with 70;
legacy packets keep cache writes unknown. Internal completion IDs and opaque
model/tier metadata leave request usage unavailable. The workflows also cover
new conversations, fork/resume, overlapping turns, reroutes, duplicate packets,
terminal updates, and semantic replica replay.

Run them with:

```sh
npm test -w @codex-app-sdk/backend -- codex-surface-execution-usage.spec.ts
```

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
