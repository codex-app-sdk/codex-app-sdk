import { createApp, h, nextTick, shallowRef } from 'vue';
import StreamingPane from './StreamingPane.vue';
import CodexMessageList from '../../../../packages/vue/src/components/CodexMessageList.vue';
import type { SurfaceMessage } from '@codex-app-sdk/core/surface';

let warmApp: ReturnType<typeof createApp> | undefined;
export function clearWarmStream() { warmApp?.unmount(); warmApp = undefined; }

export async function mountStream(historySize: number, lazy: boolean, warmOnly = false, sameTurn = false, pane = false) {
  const host = document.createElement('div');
  host.style.cssText = 'height:700px;display:flex;flex-direction:column';
  document.body.replaceChildren(host);
  const paragraph = 'A **finished paragraph** with `inline code` and [a link](https://example.com). '.repeat(6);
  const prefix = Array.from({ length: 100 }, (_, index) => `## Section ${index}\n\n${paragraph}\n\n`).join('');
  const code = '```ts\nconst stable = true;\n```\n\n';
  let content = code + prefix + 'Current tail';
  const history: SurfaceMessage[] = Array.from({ length: historySize }, (_, index) => ({
    id: `history-${index}`, turnId: sameTurn ? 'stream' : `turn-${index}`, role: 'assistant', status: 'complete',
    parts: [{ type: 'text', text: paragraph.repeat(3) }],
  }));
  const current = (): SurfaceMessage => ({
    id: 'stream', turnId: 'stream', role: 'assistant', status: 'streaming',
    parts: [{ type: 'text', text: content }],
  });
  const messages = shallowRef([...history, current()]);
  const app = createApp({ render: () => pane
    ? h(StreamingPane, { messages: messages.value, lazy })
    : h(CodexMessageList, { messages: messages.value, busy: true, renderStrategy: lazy ? 'lazy' : 'eager' }) });
  let actionUpdates = 0;
  let messageUpdates = 0;
  app.mixin({ updated() {
    if (this.$options.__name === 'ChatMessageActions') actionUpdates++;
    if (this.$options.__name === 'CodexMessage') messageUpdates++;
  } });
  const mountStarted = performance.now();
  app.mount(host);
  await nextTick();
  const mountMs = performance.now() - mountStarted;
  if (warmOnly) { warmApp = app; return; }
  const last = [...host.querySelectorAll('.chat-message')].at(-1)!;
  // Select a stable prefix after initial layout, then append tokens via the public message prop.
  const codeNode = last.querySelector('pre code')!;
  const paragraphNode = last.querySelector('p')!;
  const text = paragraphNode.firstChild!;
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(text);
  selection.addRange(range);
  const selected = selection.toString();
  const samples: number[] = [];
  for (let index = 0; index < 80; index++) {
    content += index % 12 === 0 ? '\n\nAnother paragraph ' : ' token';
    const started = performance.now();
    messages.value = [...history, current()];
    await nextTick();
    samples.push(performance.now() - started);
  }
  const result = {
    historySize, lazy, sameTurn, pane, mountMs, actionUpdates, messageUpdates, domNodes: host.querySelectorAll('*').length, svgRoots: host.querySelectorAll('svg').length, svgPaths: host.querySelectorAll('path').length, hiddenActionSvgs: [...host.querySelectorAll('.chat-message-actions')].filter(node => getComputedStyle(node).visibility === 'hidden').reduce((count, node) => count + node.querySelectorAll('svg').length, 0), chars: content.length,
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    medianMs: [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)],
    p95Ms: [...samples].sort((a, b) => a - b)[Math.floor(samples.length * .95)],
    sameParagraph: last.querySelector('p') === paragraphNode,
    sameCode: last.querySelector('pre code') === codeNode,
    selectionPreserved: selection.toString() === selected,
    renderedMessages: host.querySelectorAll('.chat-message').length,
  };
  if (historySize > 0) {
    const first = host.querySelector<HTMLElement>('.chat-message')!;
    const actions = first.querySelector<HTMLElement>('.chat-message-actions')!;
    const visible = () => getComputedStyle(actions).visibility === 'visible' && actions.querySelector('svg') !== null;
    first.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await nextTick();
    const hovered = visible();
    const button = actions.querySelector<HTMLButtonElement>('button')!;
    button.focus();
    first.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await nextTick();
    const focused = document.activeElement === button && visible();
    button.blur();
    await nextTick();
    const blurred = !visible();
    first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    await nextTick();
    const touched = visible();
    Object.assign(result, { actionVisibility: { hovered, focused, blurred, touched } });
  }
  app.unmount();
  return result;
}
