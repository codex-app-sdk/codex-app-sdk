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
import { h, nextTick, onBeforeUnmount, onMounted, ref, render, watch } from 'vue';
import type { CodexFileSearchItem, CodexSkillSummary } from './contracts';
import type { CodexSurfacePlugin } from '../../surface/types';
import ChatMentionChip from './ChatMentionChip.vue';
import { skillMatchesMention } from './composer-skills';
import { pluginMatchesMention } from './composer-plugins';

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

const props = withDefaults(defineProps<{
  ariaLabel?: string;
  disabled?: boolean;
  files?: readonly CodexFileSearchItem[];
  maxHeight?: number;
  modelValue: string;
  placeholder?: string;
  plugins?: readonly CodexSurfacePlugin[];
  skills?: readonly CodexSkillSummary[];
}>(), {
  ariaLabel: 'Prompt',
  disabled: false,
  files: () => [],
  maxHeight: 88,
  placeholder: '',
  plugins: () => [],
  skills: () => [],
});

const emit = defineEmits<{
  input: [];
  'caret-change': [range: { end: number; start: number; valid: boolean }];
  'update:modelValue': [value: string];
}>();

const editor = ref<HTMLElement | null>(null);
const caretPosition = ref(0);
const inlineTokenPattern = /(`[^`]+`)|(^|[^\w.%+-])([@$/])([^\s@$]+)/g;

watch(() => props.modelValue, (value) => {
  if (!editor.value || readText() === value) return;
  renderText(value, Math.min(caretPosition.value, value.length));
});

watch(() => [props.files, props.plugins, props.skills], () => {
  renderText(props.modelValue, Math.min(caretPosition.value, props.modelValue.length));
}, { deep: true });

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
  if (!value.endsWith('\n') && editor.value?.querySelector('br[data-trailing-line-break]')) {
    renderText(value, caretPosition.value, { focus: true });
  } else {
    autoResize();
  }
}

function normalizeTrailingBrowserLineBreak(): void {
  const lastChild = editor.value?.lastChild;
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

function scrollCaretIntoView(): void {
  const element = editor.value;
  if (!element) return;

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
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  if (node.tagName === 'CODE') return `\`${node.textContent ?? ''}\``;
  if (node.dataset.pluginName) return `@${node.dataset.pluginName}`;
  if (node.dataset.fileMention) return `@${node.dataset.fileMention}`;
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
      if (found) return;
    }
  };
  for (const child of Array.from(root.childNodes)) {
    walk(child);
    if (found) break;
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
    node.dataset.pluginName || node.dataset.fileMention || node.dataset.skillName,
  );
}

function setCaret(position: number, options: { focus?: boolean } = {}): void {
  setSelection(position, position, options);
}

function setSelection(start: number, end: number, options: { focus?: boolean } = {}): void {
  const element = editor.value;
  if (!element) return;
  if (options.focus !== false) element.focus();
  const length = readText().length;
  const nextStart = Math.max(0, Math.min(start, length));
  const nextEnd = Math.max(nextStart, Math.min(end, length));
  const startTarget = domPositionForCanonicalOffset(element, nextStart);
  const endTarget = domPositionForCanonicalOffset(element, nextEnd);
  const range = document.createRange();
  range.setStart(startTarget.node, startTarget.offset);
  range.setEnd(endTarget.node, endTarget.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  caretPosition.value = nextEnd;
  emit('caret-change', { end: nextEnd, start: nextStart, valid: true });
}

function setText(value: string, caret = value.length, options: { focus?: boolean } = {}): void {
  emit('update:modelValue', value);
  renderText(value, caret, options);
}

function insertTextAtSelection(value: string): void {
  const selection = getSelectionRange();
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
    const prefix = match[2] ?? '';
    const trigger = match[3];
    const tokenText = match[4] ?? '';
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
        : createFileChip(tokenText, atMention.value));
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
  scrollCaretIntoView();
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
  | undefined {
  const plugin = findPlugin(name);
  if (plugin) return { kind: 'plugin', value: plugin };
  const file = findFile(name);
  return file ? { kind: 'file', value: file } : undefined;
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

function unmountChipHosts(): void {
  for (const chip of editor.value?.querySelectorAll('.chat-rich-text-editor__chip-token-host') ?? []) {
    render(null, chip as HTMLElement);
  }
}

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
</script>

<style scoped>
.chat-rich-text-editor {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  min-height: var(--chat-composer-line-height, var(--line-height-24));
  max-height: var(--chat-composer-input-max-height, 88px);
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
  color: var(--color-text-muted);
  content: attr(data-placeholder);
  pointer-events: none;
}

.chat-rich-text-editor[aria-disabled="true"] {
  cursor: not-allowed;
}

.chat-rich-text-editor__chip-token-host {
  display: inline-block;
  max-width: 220px;
  margin: 0 var(--space-1);
  vertical-align: baseline;
}
</style>
