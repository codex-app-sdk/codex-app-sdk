# Messages and tool calls

The Vue kit renders restored and live `SurfaceMessage` values through one
message system. Hosts can customize presentation without recreating attachment,
tool, action, streaming, and link behavior.

## Message layout

User attachments render above the message bubble. Message parts then render in
their canonical order: text, media, status, and tool content. The latest
completed assistant message keeps its actions visible; older messages use the
normal hover/focus treatment. A currently streaming assistant message does not
show actions.

While a turn is accepted but no assistant row exists yet, the list renders a
`Thinking` shimmer. It disappears when the first assistant content is
materialized. A completed assistant message whose text is empty and which has
no other visible content renders a muted italic `Empty response` fallback.

## Image previews

Clicking an image attachment or generated assistant image opens the SDK
fullscreen lightbox by default. The overlay closes from its close control, the
backdrop, or Escape.

Controlled applications can replace that behavior with `actions.openImage`:

```ts
const actions: CodexConversationPaneActions = {
  async openImage(image, context) {
    await imageTabs.open({
      id: `${context?.message.id ?? context?.index}-${image.name ?? image.title}`,
      image,
    });
  },
};
```

The image value contains `kind`, `src`, `alt`, and optional `name`, `title`,
`path`, and `mimeType`. Context contains the absolute message `index` and the
adapted `message`. When the action is omitted, the SDK lightbox remains active.
A configured action owns the click when it returns `void` or `true`; return
`false` to deliberately fall back to the SDK lightbox. Non-controller hosts can
pass the same callback through the `openImage` pane prop.

`CodexImageLightbox` is also exported for custom message renderers that want the
stock overlay without the stock attachment or media block.

## Additive message headers

Use `message-header` to add host context without replacing SDK rendering:

```vue
<CodexConversationPane :surface="surface">
  <template #message-header="{ message, index }">
    <AppMessageHeader
      v-if="headers[message.id]"
      :label="headers[message.id]"
    />
  </template>
</CodexConversationPane>
```

The header renders once inside the message body, immediately before attachments
and the normal message stack. Default content, actions, approvals, tool calls,
streaming, and scrolling remain SDK-owned. When omitted, it adds no wrapper or
spacing.

Use `transformMessage` for data adaptation and `message-header` for additive
presentation. Use the full `message` slot only when the host intentionally owns
all rendering and action wiring.

## Tool grouping

Completed tool calls contribute to the `N actions done` counter. The group
behavior is:

| State | Collapsed | Expanded |
| --- | --- | --- |
| First tool is still running | Running tool rows; no `0 actions done` header | Same |
| Completed and running tools | Counter plus all running rows | Counter, completed rows, then running rows |
| All tools complete | Counter only | Counter plus completed rows |

A tool that completes while the group is collapsed remains visible for about
3 seconds before joining the hidden completed count. This prevents very fast
tools from flashing in and disappearing before the user can identify them.

Completed rows retain original chronological order. Running rows are always
displayed after completed rows in an expanded group.

## Icons and titles

Every tool gets an icon through a consistent fallback chain:

1. host-provided tool presentation;
2. built-in Codex action icon;
3. stable tool-kind icon;
4. generic unknown-tool icon.

Command-shaped tools use the terminal icon whether their title says `Running`,
`Ran`, or a localized equivalent. Explore/search tools use a folder or search
icon and include a useful target when the app-server supplies one.
Image generation uses the photo icon and activity labels such as
`Generating image` and `Generated image`. A host presentation resolver can
still replace either default.

Customize app-owned MCP or dynamic tools once for a Vue subtree:

```ts
provideCodexToolPresentation(({ kind, metadata }) => {
  if (kind !== 'mcp' || metadata?.server !== 'my_app') return undefined;
  if (metadata.tool === 'browser_open') {
    return { icon: BrowserIcon, title: 'Opened in-app browser' };
  }
  return undefined;
});
```

Returning `undefined`, `null`, or a presentation without an icon keeps SDK
fallback behavior. Only `{ icon: null }` explicitly suppresses the icon.

## File targets

Read, create, and edit tool titles show comma-separated basenames when canonical
paths are available. Each filename is an independent target; the SDK never
turns a multi-file title into one ambiguous clickable block.

Clicking a file emits `openLink` with:

```ts
type FileLink = {
  href: string;
  kind: 'file';
  path: string;
  filepath?: string;
  action?: 'read' | 'edit' | 'create';
  turnId?: string;
  messageId?: string;
  itemId?: string;
  line?: number;
  column?: number;
};
```

`filepath` is the canonical full path; the title only displays the basename.
Context IDs let a host open a turn-specific diff. The click does not toggle the
tool disclosure. Targets are not underlined by default because the SDK cannot
know whether the host has installed navigation behavior.

`file.activity` is different: it is a live semantic event emitted when the tool
reports activity. A click occurs only after an explicit user gesture. Hosts can
use activity to reveal a sidebar and clicks to focus/open a file.

## Raw details are secure by default

Tool input and output are not placed in the DOM by default. Enable disclosure
for a trusted subtree only:

```ts
provideCodexToolCallDetails(true);
```

Or use `show-tool-details` for one pane/list/message/group/tool component.
Component props override the provided policy.

## Attachments and media

Renderer-safe image previews may survive live history rematerialization while
the host still recognizes the opaque reference. Raw `file://` URLs are never
used as renderer image sources. Electron can read a bounded preview through its
native registry; a web host can provide its own authorized preview/upload flow.
When no safe preview survives—for example after an app restart—the renderer
falls back to a file chip instead of attempting a blocked local-resource load.

Generated images are validated, MIME-sniffed, and bounded before becoming data
URLs. Markdown, syntax highlighting, KaTeX, and Mermaid rendering share the
same message block pipeline.

See [Vue providers](/guide/vue-providers),
[Presentation and theming](/guide/presentation), and [Event API](/api/events).
