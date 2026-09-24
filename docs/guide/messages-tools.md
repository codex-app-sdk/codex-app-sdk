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

Terminal assistant messages also settle any stale running tool parts. This
keeps interrupted or restored turns from displaying activity indefinitely when
app-server history still reports an in-progress item.

Fenced code blocks in assistant messages include a top-right copy action. After
copying the exact plain-text code, the icon changes to a check for two seconds.

While a turn is accepted but no assistant row exists yet, the list renders a
`Thinking` shimmer. It disappears when the first assistant content is
materialized. A completed assistant message whose text is empty and which has
no other visible content renders a muted italic `Empty response` fallback.

## Phased assistant work

Codex assistant items can distinguish intermediate `commentary` from the
`final_answer`. The SDK preserves that phase on text parts and exposes completed
reasoning summaries as separate `reasoning` parts. It never exposes raw
reasoning content.

The stock Vue renderer groups commentary and tool calls under an expanded
`Working` section while the turn is active. Generated media remains visible
outside that fold in its chronological position. The latest reasoning summary
becomes the active tool-group title, for example
`Inspecting component contracts · 7 actions done`, instead of rendering as a
separate transcript row. A newer summary replaces that title. Normal assistant
text ends the activity group and removes its transient reasoning title, leaving
only `N actions done`. Work blocks retain their chronological order, and the
active section cannot be collapsed. When the final answer starts, the section becomes
`Done · View details` and collapses automatically; the reader can reopen it at
any time to inspect the commentary and tools. Generated media and the final
answer, including images embedded in `final_answer` text, remain visible. If structured
tool activity arrives before the first phased text or reasoning summary,
`CodexMessageList` opens the `Working` section immediately.

The accepted-but-not-yet-streaming gap is part of the active turn as well. The
stock `Thinking` placeholder inherits the latest visible `turnId`, keeping the
shared `Working` section open until the next assistant segment arrives.

Steering can split one active turn into multiple assistant message segments.
`CodexMessageList` correlates adjacent segments by `turnId` and renders one
shared disclosure for the logical turn. Steer bubbles stay in chronological
order while work is active. Answering an asynchronous question can similarly
resume the same turn after it was completed; the next streaming segment changes
the shared disclosure back to `Working` so new output is never hidden behind the
older `Done` state. Earlier and later work segments expand together, then fold
together with the steer bubbles when a final answer starts. Reopening
`Done · View details` reveals both the work and its steers. If a completed turn
has no final answer, its work stays visible directly without a disclosure
header, while its completed steer bubbles remain hidden. Work-only segments do
not show turn mutation actions; actions remain attached to the final answer. Lazy
history prepends preserve the disclosure state. Opening or closing turn details
also preserves the reader's viewport instead of forcing the transcript back to
the bottom.

An interrupted turn is labeled `Stopped`, and a failed turn is labeled
`Failed`; neither is presented as successfully `Done`. Work-only interrupted
or failed turns start expanded, while a partial final answer stays visible with
its earlier work behind the disclosure. Continuing an interrupted turn creates
a separate `Working` group under a new provider turn ID. The old stopped group
does not become active again and no empty user message is rendered.

Deleting a turn is intentionally non-optimistic. The turn stays visible while
the host or surface action runs, the Delete icon becomes a progress spinner,
and the other actions on that turn are disabled. Success removes the turn when
the backing state updates; failure restores the normal controls and surfaces
the existing pane error.

This presentation is capability-by-data rather than provider-specific. Messages
without explicit phases or reasoning summaries keep the existing flat layout,
so custom backends do not need to invent a final-answer boundary. Applications
using the `message-block` slot receive the rendered leaf blocks; the work-group
wrapper itself is not passed through that customization slot. Reasoning
summaries used as transient activity titles are represented by the tool-group
block rather than a separate reasoning block.

## Image previews

Clicking an image attachment or generated assistant image opens the SDK
fullscreen lightbox by default. The overlay closes from its close control, the
backdrop, or Escape. Generated-image footer controls open the same fullscreen
behavior, copy the rendered image to the clipboard, and download the
renderer-safe image source with a useful filename. Successful copy actions show
a check for 1.5 seconds before restoring the copy icon.

Controlled applications can replace that behavior with `actions.openImage`:

```ts
const actions: CodexConversationPaneActions = {
  async openImage(image, context) {
    if (context?.intent === 'fullscreen') {
      return false; // Keep the SDK fullscreen lightbox.
    }
    await imageTabs.open({
      id: `${context?.message?.id ?? context?.index}-${image.name ?? image.title}`,
      image,
    });
  },
};
```

The image value contains `kind`, `src`, `alt`, and optional `name`, `title`,
`path`, and `mimeType`. Context uses semantic `intent: 'open' | 'fullscreen'`:
clicking the inline image emits `open`, while the explicit maximize control
emits `fullscreen`. Pane handlers also receive the absolute message `index` and
the adapted `message`. Direct leaf-component handlers receive the intent
without message metadata. When the action is omitted, the SDK lightbox remains active.
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

## Host-controlled tool visibility

Pass `:tool-visibility="isToolVisible"` to `CodexConversationPane` or
`CodexMessageList` to hide selected tool calls from the transcript without
changing provider messages or events. The callback receives a
`CodexMessageToolCall` and returns `true` to render it or `false` to hide it.
If omitted, every tool remains visible. For example, a host can use the call's
`function` or `metadata` to keep its own lifecycle tools out of chat:

```ts
import type { CodexToolVisibility } from '@codex-app-sdk/vue';

const isToolVisible: CodexToolVisibility = (toolCall) =>
  toolCall.metadata?.visibility !== 'internal';
```

The decision is applied after `transformMessage` but before work grouping and
action counts, for both live and restored messages. Other text, media, and
tools in the same message remain visible. A message containing only hidden
tools leaves no empty row or work fold. This is presentation-only; the host
still receives the complete provider transcript and tool results.

## Tool grouping

Completed tool calls contribute to the `N actions done` counter. The group
behavior is:

| State | Collapsed | Expanded |
| --- | --- | --- |
| First tool is still running | Running tool rows; no `0 actions done` header | Same |
| Completed and running tools | Counter plus all running rows | Counter, completed rows, then running rows |
| All tools complete | Counter only | Counter plus completed rows |

While an activity group is current, its latest reasoning summary prefixes the
counter. A group with a summary but no tool yet shows only that summary. Once
normal assistant text follows the group, the title returns to the plain counter.

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
URLs. Completed assistant Markdown images that reference app-server-local image
files are also read through app-server, validated, bounded, and replaced with
renderer-safe data URLs. This keeps restored images working in both Electron
and Web surfaces without exposing a backend filesystem URL to the renderer.
Markdown, syntax highlighting, KaTeX, and Mermaid rendering share the same
message block pipeline.

Codex visualization annotations render as a titled visualization row instead
of leaking their private delimiters or JSON into assistant text. The SDK never
executes or embeds the referenced HTML. Selecting the row calls the dedicated
app-owned `openVisualization({ path, title })` action (or the equivalent direct
prop/event), so a trusted host can ingest the artifact without treating its
task-owned path as a generic conversation file link.

See [Vue providers](/guide/vue-providers),
[Presentation and theming](/guide/presentation), and [Event API](/api/events).
