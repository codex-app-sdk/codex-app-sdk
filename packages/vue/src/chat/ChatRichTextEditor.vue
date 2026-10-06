<template>
  <div
    ref="editor"
    class="chat-rich-text-editor"
    :aria-disabled="disabled"
    :aria-label="ariaLabel"
    :contenteditable="disabled ? 'false' : 'true'"
    :data-placeholder="placeholder"
    role="textbox"
    @input="onInput"
  />
</template>

<script setup lang="ts">
import { Fragment, h, nextTick, onBeforeUnmount, onMounted, ref, render, useSlots, watch } from 'vue';
import type { CodexFileSearchItem, CodexSkillSummary } from './contracts';
import type { CodexSurfacePlugin } from '@codex-app-sdk/core/surface';
import ChatMentionChip from './ChatMentionChip.vue';
import { skillMatchesMention } from './composer-skills';
import { pluginMatchesMention } from './composer-plugins';
import {
  findComposerMention,
  type CodexComposerMentionGroup,
  type CodexComposerMentionItem,
} from './composer-mentions-custom';

export type CodexRichTextEditorExpose = {
  autoResize: () => void;
  focusEnd: () => void;
  getSelectionRange: () => { end: number; start: number; valid: boolean };
  insertTextAtSelection: (value: string) => void;
  readText: () => string;
  setCaret: (position: number, options?: { focus?: boolean }) => void;
  setSelection: (start: number, end: number, options?: { focus?: boolean }) => void;
  setText: (value: string, caret?: number, options?: { focus?: boolean }) => void;
};

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = withDefaults(defineProps<{
  ariaLabel?: string;
  disabled?: boolean;
  files?: readonly CodexFileSearchItem[];
  maxHeight?: number;
  mentionGroups?: readonly CodexComposerMentionGroup[];
  modelValue: string;
  placeholder?: string;
  plugins?: readonly CodexSurfacePlugin[];
  skills?: readonly CodexSkillSummary[];
}>(), {
  ariaLabel: 'Prompt',
  disabled: false,
  files: () => [],
  maxHeight: 304,
  mentionGroups: () => [],
  placeholder: '',
  plugins: () => [],
  skills: () => [],
});
// Stryker restore all

const slots = useSlots();

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const emit = defineEmits<{
  input: [];
  'caret-change': [range: { end: number; start: number; valid: boolean }];
  'update:modelValue': [value: string];
}>();
// Stryker restore all

const editor = ref<HTMLElement | null>(null);
const caretPosition = ref(0);
const catalogRevision = ref(0);
const inlineTokenPattern = /(`[^`]+`)|(^|[^\w.%+-])([@$/])([^\s@$]+)/g;

watch(() => [props.files, props.mentionGroups, props.plugins, props.skills], () => {
  catalogRevision.value += 1;
}, { deep: true, flush: 'sync' });

watch(() => [props.modelValue, catalogRevision.value] as const, ([value, revision], previous) => {
  if (!editor.value || (revision === previous[1] && readText() === value)) return;
  renderText(value, Math.min(caretPosition.value, value.length));
});

onMounted(() => {
  renderText(props.modelValue, props.modelValue.length, { focus: false });
  document.addEventListener('selectionchange', handleDocumentSelectionChange);
});
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', handleDocumentSelectionChange);
  unmountChipHosts();
});

function handleDocumentSelectionChange(): void {
  const selection = getSelectionRange();
  if (!selection.valid) return;
  caretPosition.value = selection.end;
  emit('caret-change', selection);
}

function onInput(): void {
  normalizeTrailingBrowserLineBreak();
  const selection = getSelectionRange();
  const value = readText();
  caretPosition.value = selection.valid ? selection.end : value.length;
  emit('update:modelValue', value);
  emit('caret-change', selection.valid
    ? selection
    : { end: caretPosition.value, start: caretPosition.value, valid: false });
  emit('input');
  if (!value.endsWith('\n')) {
    const placeholders = editor.value?.querySelectorAll('br[data-trailing-line-break]');
    if (placeholders?.length) {
      placeholders.forEach((placeholder) => placeholder.remove());
      setCaret(caretPosition.value, { focus: true });
    }
  }
  autoResize();
}

function normalizeTrailingBrowserLineBreak(): void {
  const lastChild = editor.value!.lastChild;
  if (!(lastChild instanceof HTMLBRElement) || lastChild.dataset.trailingLineBreak !== undefined) return;

  // Chromium keeps a terminal BR as a visual caret placeholder after native
  // deletion. Intentional trailing newlines already have an SDK sentinel, so
  // this unmarked terminal BR is browser-owned and must not enter the model.
  lastChild.dataset.trailingLineBreak = '';
}

function autoResize(): void {
  const element = editor.value;
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, props.maxHeight)}px`;
}

function scrollCaretIntoView(element: HTMLElement): void {
  // A collapsed range after a trailing BR does not consistently expose a box
  // in Chromium. At the end of the draft, scrolling to the content bottom is
  // both exact and avoids waiting for the next native input event.
  if (caretPosition.value >= readText().length) {
    element.scrollTop = element.scrollHeight;
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || typeof range.getBoundingClientRect !== 'function') return;
  const caretRect = range.getBoundingClientRect();
  const editorRect = element.getBoundingClientRect();
  if (caretRect.bottom > editorRect.bottom) {
    element.scrollTop += caretRect.bottom - editorRect.bottom;
  } else if (caretRect.top < editorRect.top) {
    element.scrollTop -= editorRect.top - caretRect.top;
  }
}

function readText(): string {
  return editor.value
    ? Array.from(editor.value.childNodes).map(canonicalNodeText).join('')
    : props.modelValue;
}

function canonicalNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent!;
  if (!(node instanceof HTMLElement)) return '';
  if (node.tagName === 'CODE') return `\`${node.textContent!}\``;
  if (node.dataset.pluginName) return `@${node.dataset.pluginName}`;
  if (node.dataset.fileMention) return `@${node.dataset.fileMention}`;
  if (node.dataset.mentionValue) return `@${node.dataset.mentionValue}`;
  if (node.dataset.skillName) return `${node.dataset.skillTrigger || '$'}${node.dataset.skillName}`;
  if (node.tagName === 'BR') return node.dataset.trailingLineBreak === undefined ? '\n' : '';
  return Array.from(node.childNodes).map(canonicalNodeText).join('');
}

function canonicalNodeLength(node: Node): number {
  return canonicalNodeText(node).length;
}

function getSelectionRange(): { end: number; start: number; valid: boolean } {
  const element = editor.value;
  const selection = window.getSelection();
  if (!element || !selection || selection.rangeCount === 0) {
    return { end: caretPosition.value, start: caretPosition.value, valid: false };
  }
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
    return { end: caretPosition.value, start: caretPosition.value, valid: false };
  }
  const start = canonicalOffsetForDomPosition(element, range.startContainer, range.startOffset);
  const end = canonicalOffsetForDomPosition(element, range.endContainer, range.endOffset);
  return { end: Math.max(start, end), start: Math.min(start, end), valid: true };
}

function canonicalOffsetForDomPosition(root: HTMLElement, target: Node, offset: number): number {
  if (target === root) {
    return Array.from(root.childNodes).slice(0, offset)
      .reduce((total, node) => total + canonicalNodeLength(node), 0);
  }
  let position = 0;
  let found = false;
  const walk = (node: Node): void => {
    if (found) return;
    if (node === target) {
      position += node.nodeType === Node.TEXT_NODE
        ? offset
        : Array.from(node.childNodes).slice(0, offset)
          .reduce((total, child) => total + canonicalNodeLength(child), 0);
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE || node instanceof HTMLBRElement || isChipHost(node)) {
      position += canonicalNodeLength(node);
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }
  };
  for (const child of Array.from(root.childNodes)) {
    walk(child);
  }
  return position;
}

function domPositionForCanonicalOffset(root: HTMLElement, position: number): { node: Node; offset: number } {
  let remaining = Math.max(0, position);
  const children = Array.from(root.childNodes);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const length = canonicalNodeLength(child);
    if (child.nodeType === Node.TEXT_NODE) {
      if (remaining <= length) return { node: child, offset: remaining };
      remaining -= length;
      continue;
    }
    if (isChipHost(child)) {
      if (remaining <= length) return { node: root, offset: remaining <= length / 2 ? index : index + 1 };
      remaining -= length;
      continue;
    }
    if (child instanceof HTMLBRElement) {
      // A real BR consumes one canonical character, so its two DOM sides map
      // to distinct offsets. This matters for a leading empty line: offset 0
      // is before the BR, while offset 1 is after it. The zero-length trailing
      // sentinel exists only to give Chromium a caret box, so its valid side
      // remains after the element.
      if (length === 0) return { node: root, offset: index + 1 };
      if (remaining === 0) return { node: root, offset: index };
      if (remaining <= length) return { node: root, offset: index + 1 };
      remaining -= length;
      continue;
    }
    if (remaining <= length && child instanceof HTMLElement) {
      return domPositionForCanonicalOffset(child, remaining);
    }
    remaining -= length;
  }
  return { node: root, offset: root.childNodes.length };
}

function isChipHost(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && Boolean(
    node.dataset.pluginName || node.dataset.fileMention || node.dataset.mentionValue || node.dataset.skillName,
  );
}

function setCaret(position: number, options: { focus?: boolean } = {}): void {
  setSelection(position, position, options);
}

function setSelection(start: number, end: number, options: { focus?: boolean } = {}): void {
  const element = editor.value;
  if (!element) return;
  const shouldUpdateDocumentSelection = options.focus !== false || document.activeElement === element;
  if (options.focus !== false) element.focus();
  const length = readText().length;
  const nextStart = Math.max(0, Math.min(start, length));
  const nextEnd = Math.max(nextStart, Math.min(end, length));
  if (shouldUpdateDocumentSelection) {
    const startTarget = domPositionForCanonicalOffset(element, nextStart);
    const endTarget = domPositionForCanonicalOffset(element, nextEnd);
    const range = document.createRange();
    range.setStart(startTarget.node, startTarget.offset);
    range.setEnd(endTarget.node, endTarget.offset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  caretPosition.value = nextEnd;
  emit('caret-change', { end: nextEnd, start: nextStart, valid: true });
}

function setText(value: string, caret = value.length, options: { focus?: boolean } = {}): void {
  emit('update:modelValue', value);
  renderText(value, caret, options);
}

function insertTextAtSelection(value: string): void {
  const selection = getSelectionRange();
  // Native editing records an undo transaction; replacing the DOM does not.
  if (typeof document.execCommand === 'function') {
    setSelection(selection.start, selection.end);
    const text = document.createElement('span');
    appendTextNode(text, value);
    if (value.endsWith('\n') && selection.end === readText().length) {
      const placeholder = document.createElement('br');
      placeholder.dataset.trailingLineBreak = '';
      text.append(placeholder);
    }
    if (document.execCommand('insertHTML', false, text.innerHTML)) {
      setCaret(selection.start + value.length);
      scrollCaretIntoView(editor.value!);
      return;
    }
  }
  const current = readText();
  const next = `${current.slice(0, selection.start)}${value}${current.slice(selection.end)}`;
  const nextCaret = selection.start + value.length;
  emit('update:modelValue', next);
  renderText(next, nextCaret, { focus: true });
}

function focusEnd(): void {
  void nextTick(() => setCaret(readText().length));
}

function renderText(value: string, caret = caretPosition.value, options: { focus?: boolean } = {}): void {
  const element = editor.value;
  if (!element) return;
  const shouldFocus = options.focus ?? document.activeElement === element;
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  inlineTokenPattern.lastIndex = 0;
  while ((match = inlineTokenPattern.exec(value)) !== null) {
    if (match[1]) continue;
    const prefix = match[2]!;
    const trigger = match[3];
    const tokenText = match[4]!;
    const tokenStart = match.index + prefix.length;
    const tokenEnd = tokenStart + tokenText.length + 1;
    const mention = trigger === '$'
      ? findSkill(tokenText)
      : trigger === '@'
        ? findAtMention(tokenText)
        : undefined;
    if (!mention) continue;
    appendTextNode(fragment, value.slice(lastIndex, tokenStart));
    if (trigger === '$') {
      fragment.append(createSkillChip(tokenText, mention as CodexSkillSummary));
    } else {
      const atMention = mention as Exclude<ReturnType<typeof findAtMention>, undefined>;
      fragment.append(atMention.kind === 'plugin'
        ? createPluginChip(tokenText, atMention.value)
        : atMention.kind === 'file'
          ? createFileChip(tokenText, atMention.value)
          : createCustomMentionChip(tokenText, atMention.group, atMention.item));
    }
    lastIndex = tokenEnd;
  }
  appendTextNode(fragment, value.slice(lastIndex));
  if (value.endsWith('\n')) {
    const trailingLineBreak = document.createElement('br');
    trailingLineBreak.dataset.trailingLineBreak = '';
    fragment.append(trailingLineBreak);
  }
  unmountChipHosts();
  element.replaceChildren(fragment);
  setCaret(Math.min(caret, value.length), { focus: shouldFocus });
  autoResize();
  scrollCaretIntoView(element);
}

function appendTextNode(parent: Node, value: string): void {
  const lines = value.split('\n');
  lines.forEach((line, index) => {
    if (line) parent.appendChild(document.createTextNode(line));
    if (index < lines.length - 1) parent.appendChild(document.createElement('br'));
  });
}

function findPlugin(name: string): CodexSurfacePlugin | undefined {
  return props.plugins.find((plugin) => pluginMatchesMention(plugin, name));
}

function findAtMention(name: string):
  | { kind: 'plugin'; value: CodexSurfacePlugin }
  | { kind: 'file'; value: CodexFileSearchItem }
  | { kind: 'custom'; group: CodexComposerMentionGroup; item: CodexComposerMentionItem }
  | undefined {
  const leadingMention = findComposerMention(
    props.mentionGroups.filter((group) => group.placement !== 'after'),
    name,
  );
  if (leadingMention) return { kind: 'custom', ...leadingMention };
  const plugin = findPlugin(name);
  if (plugin) return { kind: 'plugin', value: plugin };
  const file = findFile(name);
  if (file) return { kind: 'file', value: file };
  // Non-after groups were already exhausted by the leading lookup above.
  const trailingMention = findComposerMention(
    props.mentionGroups,
    name,
  );
  return trailingMention ? { kind: 'custom', ...trailingMention } : undefined;
}

function findFile(path: string): CodexFileSearchItem | undefined {
  return props.files.find((file) => file.path === path || file.name === path);
}

function findSkill(name: string): CodexSkillSummary | undefined {
  return props.skills.find((skill) => skillMatchesMention(skill, name));
}

function createChip(dataset: Record<string, string>, properties: {
  iconUrl?: string;
  kind: 'file' | 'plugin' | 'skill';
  name: string;
}): HTMLElement {
  const host = document.createElement('span');
  host.className = 'chat-rich-text-editor__chip-token-host';
  host.contentEditable = 'false';
  Object.assign(host.dataset, dataset);
  host.setAttribute('aria-label', properties.name);
  render(h(ChatMentionChip, properties), host);
  return host;
}

function createPluginChip(name: string, plugin: CodexSurfacePlugin): HTMLElement {
  return createChip({ pluginName: name }, {
    iconUrl: plugin.iconUrl,
    kind: 'plugin',
    name: plugin.displayName || plugin.name,
  });
}

function createFileChip(path: string, file: CodexFileSearchItem): HTMLElement {
  return createChip({ fileMention: path }, { kind: 'file', name: file.name });
}

function createSkillChip(name: string, skill: CodexSkillSummary): HTMLElement {
  return createChip({ skillName: name, skillTrigger: '$' }, {
    iconUrl: skill.iconSmall,
    kind: 'skill',
    name: skill.displayName || skill.name,
  });
}

function createCustomMentionChip(
  value: string,
  group: CodexComposerMentionGroup,
  item: CodexComposerMentionItem,
): HTMLElement {
  const host = document.createElement('span');
  host.className = 'chat-rich-text-editor__chip-token-host';
  host.contentEditable = 'false';
  host.dataset.mentionGroup = group.id;
  host.dataset.mentionValue = value;
  host.setAttribute('aria-label', item.label);
  render(slots.mention
    ? h(Fragment, null, slots.mention({ group, item, surface: 'composer' }))
    : h(ChatMentionChip, { kind: 'plugin', name: item.label }), host);
  return host;
}

function unmountChipHosts(): void {
  // A parent update can remove this editor before its post-render ref is assigned.
  if (!editor.value) return;
  for (const chip of editor.value.querySelectorAll('.chat-rich-text-editor__chip-token-host')) {
    render(null, chip as HTMLElement);
  }
}

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
defineExpose<CodexRichTextEditorExpose>({
  autoResize,
  focusEnd,
  getSelectionRange,
  insertTextAtSelection,
  readText,
  setCaret,
  setSelection,
  setText,
});
// Stryker restore all
</script>

<style scoped>
.chat-rich-text-editor {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  min-height: var(--chat-composer-line-height, var(--line-height-24));
  max-height: var(--chat-composer-input-max-height, 304px);
  padding: var(--space-4) 0;
  overflow-y: auto;
  scrollbar-width: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--chat-composer-font-size, var(--font-size-15));
  line-height: var(--chat-composer-line-height, var(--line-height-24));
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.chat-rich-text-editor::-webkit-scrollbar {
  display: none;
}

.chat-rich-text-editor:empty::before {
  color: color-mix(in srgb, var(--color-text-muted) 50%, transparent);
  content: attr(data-placeholder);
  pointer-events: none;
}

.chat-rich-text-editor[aria-disabled="true"] {
  cursor: not-allowed;
}

.chat-rich-text-editor :deep(.chat-rich-text-editor__chip-token-host) {
  display: inline-block;
  max-width: 220px;
  margin: 0 var(--space-1);
  vertical-align: -2px;
}
</style>
