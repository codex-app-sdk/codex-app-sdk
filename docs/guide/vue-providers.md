# Vue providers

Vue providers configure SDK behavior once for a component subtree. Use them for
cross-cutting policy or presentation that should apply to several conversation
panes and leaf components without forwarding the same prop through every layer.

Call provider helpers during a component's `setup` phase. Descendants use the
nearest provider, so separate Vue roots or nested product areas can have
different configuration.

## Provider conventions

Every SDK provider follows the same contract:

- public helpers are named `provideCodex*` and `useCodex*`;
- injection-key descriptions begin with `codex-app-sdk-`;
- optional configuration has a safe SDK default;
- providers are scoped to the current Vue tree, never global mutable state;
- public provider types are exported from `codex-app-sdk/vue`;
- an explicit component prop takes precedence when the component exposes one.

Use a provider for app-wide or subtree-wide configuration. Use a prop for a
single component instance and a scoped slot when the host must render arbitrary
markup in a specific location.

## Chat translation

```ts
import {
  provideCodexChatTranslate,
  type CodexChatTranslate,
} from 'codex-app-sdk/vue';

const translate: CodexChatTranslate = (key, params) =>
  productI18n.t(key, params);

provideCodexChatTranslate(translate);
```

`useCodexChatTranslate()` reads the nearest translation function. Without a
provider, SDK English strings are used.

## Raw tool details

Raw tool input and output remain inaccessible by default. Enable the disclosure
UI for one trusted component tree:

```ts
import { provideCodexToolCallDetails } from 'codex-app-sdk/vue';

provideCodexToolCallDetails(true);
```

`useCodexToolCallDetails()` returns the effective reactive policy. An explicit
`show-tool-details` prop overrides the provided value for that component.

## Tool icons and titles

App-owned MCP and dynamic tools retain their `kind` and renderer-safe metadata
when converted into `CodexMessageToolCall`. Install a presentation resolver once
to customize their icon or title while leaving grouping, diffs, actions,
streaming, and detail disclosure SDK-owned:

```ts
import { provideCodexToolPresentation } from 'codex-app-sdk/vue';
import BrowserIcon from './BrowserIcon.vue';

provideCodexToolPresentation(({ kind, metadata }) => {
  if (kind !== 'mcp' || metadata?.server !== 'codex_claw') return undefined;

  const tool = String(metadata.tool ?? '');
  if (tool.startsWith('browser_')) {
    return {
      icon: BrowserIcon,
      title: tool === 'browser_open' ? 'Opened in-app browser' : 'Used in-app browser',
    };
  }

  return undefined;
});
```

The resolver receives the complete `toolCall`, parsed status `descriptor`,
`kind`, and `metadata`. For MCP calls, metadata includes the app-server `server`
and `tool` identity.

Resolution order is:

1. an icon returned by the nearest host resolver;
2. the SDK's built-in Codex action icon;
3. a stable tool-kind icon, such as the terminal for commands;
4. the generic tool icon.

Return `undefined` to keep SDK presentation. Return `{ icon: null }` to suppress
the icon explicitly. An omitted or `undefined` `icon` also keeps the SDK
fallback. A resolver can provide only an icon or only a title.

`registerCodexToolTitlePresenter` remains available for compatibility, but Vue
applications should prefer the scoped provider because it cannot leak between
Vue roots, tests, or server-rendered requests.

## Available providers

| Provider | Consumer | Default |
| --- | --- | --- |
| `provideCodexChatTranslate` | `useCodexChatTranslate` | SDK English translation |
| `provideCodexToolCallDetails` | `useCodexToolCallDetails` | Raw details disabled |
| `provideCodexToolPresentation` | `useCodexToolPresentation` | Built-in or generic presentation |

See the [Vue API reference](/api/vue) for exported types and the
[MCP guide](/guide/mcp) for registering app-owned servers. The complete fallback,
grouping, file-link, and raw-detail behavior is documented in
[Messages and tool calls](/guide/messages-tools).
