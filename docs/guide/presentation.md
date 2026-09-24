# Presentation and theming

The default pane is complete, but products rarely want every control in every
surface. The public API separates behavior from visibility.

Use ordinary app-owned Vue components for sidebars, inspectors, dashboards,
and other product layout. This page covers the presentation seams inside the
conversation experience; see [Add app-owned panels](/guide/app-ui) for shell
composition.

## Capabilities

Capabilities describe which conversation behavior the host wants to offer:

```ts
import type { CodexCapabilities } from '@codex-app-sdk/vue';

export const capabilities: CodexCapabilities = {
  models: false,
  skills: false,
  reasoningEffort: false,
  planMode: false,
  goals: false,
  steerPrompt: false,
  interrupt: true,
  history: true,
  deleteTurn: false,
  editTurn: false,
  retryTurn: false,
  approvals: false,
  approvalPresets: [],
};
```

## Presentation controls

Presentation controls hide optional default UI without changing the operations
available on the controller:

```ts
import type { CodexConversationPresentation } from '@codex-app-sdk/vue';

export const presentation: CodexConversationPresentation = {
  composer: {
    actionMenu: false,
    contextUsage: false,
    voice: false,
  },
  messages: {
    actions: {
      copy: false,
      delete: false,
      edit: false,
      quote: false,
      retry: false,
    },
    toolBlocks: false,
  },
  shelf: {
    goal: false,
    queuedPrompts: false,
    turnGitDiff: false,
  },
};
```

```vue
<CodexConversationPane
  :surface="surface"
  :capabilities="capabilities"
  :presentation="presentation"
/>
```

Generated images remain available as rich media when technical tool blocks are
hidden. In phased turns they remain visible in chronological order outside the
shared `Working` / `Done · View details` disclosure. Disabled
attachment/transcription behavior does not leave dead controls.

::: warning Visibility is not authorization
Hiding a model, permission preset, tool block, or action is a presentation
choice. Enforce raw permission, approval, filesystem, network, command, and MCP
policy in the trusted Node host and app-server configuration.
:::

## Theme mode

Apply light, dark, or system behavior to an application-owned ancestor:

```ts
import { applyCodexTheme } from '@codex-app-sdk/vue';

const restore = applyCodexTheme(element, {
  mode: 'system',
  tokens: {
    primaryColor: '#3659d9',
    messageFontSize: '16px',
  },
});

// Restore the element's previous theme and tokens later.
restore();
```

You can also set `data-codex-theme="light|dark|system"` or use the provided
theme classes.

## Public semantic tokens

```css
.my-codex-surface {
  --codex-font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  --codex-mono-font-family: "JetBrains Mono", ui-monospace, monospace;
  --codex-primary-color: #3659d9;
  --codex-background-color: #fafbff;
  --codex-surface-color: #ffffff;
  --codex-text-color: #172033;
  --codex-muted-text-color: #687087;
  --codex-border-color: #dfe3ec;
  --codex-message-font-size: 16px;
  --codex-message-line-height: 24px;
  --codex-composer-font-size: 16px;
  --codex-composer-control-size: 42px;
  --codex-menu-font-size: 14px;
  --codex-menu-control-min-height: 34px;
  --codex-message-action-control-size: 30px;
}
```

Host classes applied to `CodexConversationPane` land on its root element. Use
those classes for semantic tokens and shell layout—not selectors into private
component internals.

Chat controls and menus do not select text during interaction. Message text
remains selectable for quoting and copying.

For app-owned message context, prefer the additive `message-header` slot over a
full message replacement. For app-owned tool titles/icons, use the scoped tool
presentation provider. See [Messages and tool calls](/guide/messages-tools).
