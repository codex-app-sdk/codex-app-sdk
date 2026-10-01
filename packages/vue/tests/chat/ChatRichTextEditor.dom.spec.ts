// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { defineComponent, h, onUnmounted } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import ChatRichTextEditor, {
  type CodexRichTextEditorExpose,
} from '../../src/chat/ChatRichTextEditor.vue';

const plugin = {
  id: 'gmail@remote',
  name: 'gmail',
  displayName: 'Gmail',
  enabled: true,
};

const skill = {
  name: 'Commit-Push (cp)',
  path: '/skills/commit-push/SKILL.md',
  enabled: true,
};

describe('ChatRichTextEditor DOM contract', () => {
  it('reads every canonical DOM node form and ignores non-HTML nodes', () => {
    const wrapper = mount(ChatRichTextEditor, { props: { modelValue: '' } });
    const editor = wrapper.get('[role="textbox"]').element;
    const code = document.createElement('code');
    code.textContent = 'inline';
    const emptyCode = document.createElement('code');
    const pluginHost = chip({ pluginName: 'gmail' });
    const fileHost = chip({ fileMention: 'README.md' });
    const mentionHost = chip({ mentionValue: 'thread:019abc' });
    const slashSkillHost = chip({ skillName: 'plan', skillTrigger: '/' });
    const defaultSkillHost = chip({ skillName: 'review' });
    const lineBreak = document.createElement('br');
    const trailingSentinel = document.createElement('br');
    trailingSentinel.dataset.trailingLineBreak = '';
    const nested = document.createElement('span');
    nested.append('nested', document.createElement('br'), 'tail');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    editor.replaceChildren(
      document.createTextNode('start '),
      document.createComment('ignored'),
      svg,
      code,
      emptyCode,
      pluginHost,
      fileHost,
      mentionHost,
      slashSkillHost,
      defaultSkillHost,
      lineBreak,
      trailingSentinel,
      nested,
    );

    expect(api(wrapper).readText())
      .toBe('start `inline```@gmail@README.md@thread:019abc/plan$review\nnested\ntail');
  });

  it('maps root, nested-element, and nested-text DOM positions to canonical offsets', () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: '' },
    });
    const editor = wrapper.get('[role="textbox"]').element;
    const nested = document.createElement('span');
    const first = document.createTextNode('c');
    const inner = document.createElement('strong');
    const middle = document.createTextNode('de');
    inner.append(middle);
    nested.append(first, inner, 'f');
    editor.replaceChildren(document.createTextNode('ab'), nested, document.createTextNode('gh'));

    select(nested, 2);
    expect(api(wrapper).getSelectionRange()).toStrictEqual({ end: 5, start: 5, valid: true });

    select(middle, 1);
    expect(api(wrapper).getSelectionRange()).toStrictEqual({ end: 4, start: 4, valid: true });

    select(editor, 2);
    expect(api(wrapper).getSelectionRange()).toStrictEqual({ end: 6, start: 6, valid: true });
    wrapper.unmount();
  });

  it('maps canonical offsets across text, chips, line breaks, nested elements, and document edges', () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: '' },
    });
    const editor = wrapper.get('[role="textbox"]').element;
    const text = document.createTextNode('A');
    const pluginHost = chip({ pluginName: 'x' });
    const lineBreak = document.createElement('br');
    const nested = document.createElement('span');
    const nestedText = document.createTextNode('B');
    nested.append(nestedText);
    editor.replaceChildren(text, pluginHost, lineBreak, nested);
    (editor as HTMLElement).focus();
    const selection = window.getSelection()!;
    const richEditor = api(wrapper);

    richEditor.setCaret(-10, { focus: false });
    expect([selection.anchorNode, selection.anchorOffset]).toStrictEqual([text, 0]);

    richEditor.setCaret(2, { focus: false });
    expect([selection.anchorNode, selection.anchorOffset]).toStrictEqual([editor, 1]);

    richEditor.setCaret(3, { focus: false });
    expect([selection.anchorNode, selection.anchorOffset]).toStrictEqual([editor, 2]);

    richEditor.setCaret(4, { focus: false });
    expect([selection.anchorNode, selection.anchorOffset]).toStrictEqual([editor, 3]);

    richEditor.setCaret(5, { focus: false });
    expect([selection.anchorNode, selection.anchorOffset]).toStrictEqual([nestedText, 1]);

    richEditor.setCaret(99, { focus: false });
    expect([selection.anchorNode, selection.anchorOffset]).toStrictEqual([nestedText, 1]);

    editor.replaceChildren();
    richEditor.setCaret(0, { focus: false });
    expect([selection.anchorNode, selection.anchorOffset]).toStrictEqual([editor, 0]);
    wrapper.unmount();
  });

  it('clamps selections, tolerates a missing browser selection, and becomes inert after unmount', () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'abcd' },
    });
    const richEditor = api(wrapper);
    (wrapper.get('[role="textbox"]').element as HTMLElement).focus();

    richEditor.setSelection(-2, 10, { focus: false });
    expect(richEditor.getSelectionRange()).toStrictEqual({ end: 4, start: 0, valid: true });
    expect(wrapper.emitted('caret-change')?.at(-1)).toStrictEqual([
      { end: 4, start: 0, valid: true },
    ]);

    richEditor.setSelection(3, 1, { focus: false });
    expect(richEditor.getSelectionRange()).toStrictEqual({ end: 3, start: 3, valid: true });

    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue(null);
    expect(() => richEditor.setSelection(1, 2, { focus: false })).not.toThrow();
    expect(wrapper.emitted('caret-change')?.at(-1)).toStrictEqual([
      { end: 2, start: 1, valid: true },
    ]);
    getSelection.mockRestore();

    const events = wrapper.emitted('caret-change')!;
    const eventCount = events.length;
    wrapper.unmount();
    expect(() => richEditor.setSelection(1, 2)).not.toThrow();
    expect(events).toHaveLength(eventCount);
  });

  it('replaces a selected range, restores focus, and publishes the resulting caret', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'abcd' },
    });
    const richEditor = api(wrapper);
    richEditor.setSelection(1, 3);
    outside.focus();
    selectRange(
      wrapper.get('[role="textbox"]').element.firstChild!,
      1,
      wrapper.get('[role="textbox"]').element.firstChild!,
      3,
    );

    richEditor.insertTextAtSelection('X');

    expect(richEditor.readText()).toBe('aXd');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toStrictEqual(['aXd']);
    expect(wrapper.emitted('caret-change')?.at(-1)).toStrictEqual([
      { end: 2, start: 2, valid: true },
    ]);
    expect(document.activeElement).toBe(wrapper.get('[role="textbox"]').element);
    wrapper.unmount();
    outside.remove();
  });

  it('uses leading mentions before built-ins and trailing mentions only after them', () => {
    const groups = [
      {
        id: 'leading',
        label: 'Leading',
        placement: 'before' as const,
        items: [
          { id: 'leading-shared', value: 'shared', label: 'Leading shared' },
          { id: 'leading-gmail', value: 'gmail', label: 'Leading Gmail' },
        ],
      },
      {
        id: 'trailing',
        label: 'Trailing',
        placement: 'after' as const,
        items: [
          { id: 'trailing-shared', value: 'shared', label: 'Trailing shared' },
          { id: 'trailing-plugin', value: 'slack', label: 'Trailing Slack' },
          { id: 'trailing-file', value: 'README.md', label: 'Trailing README' },
          { id: 'trailing-only', value: 'tail', label: 'Trailing only' },
        ],
      },
    ];
    const wrapper = mount(ChatRichTextEditor, {
      props: {
        files: [{ name: 'README.md', path: 'README.md' }],
        mentionGroups: groups,
        modelValue: '@shared @gmail @slack @README.md @tail',
        plugins: [
          plugin,
          { id: 'slack@remote', name: 'slack', displayName: 'Slack', enabled: true },
        ],
      },
      slots: {
        mention: ({ group, item, surface }) => h(
          'span',
          { class: 'host-mention' },
          `${surface}:${group.id}:${item.id}`,
        ),
      },
    });

    expect(wrapper.get('[data-mention-value="shared"]').text())
      .toBe('composer:leading:leading-shared');
    expect(wrapper.get('[data-mention-value="gmail"]').text())
      .toBe('composer:leading:leading-gmail');
    expect(wrapper.find('[data-plugin-name="gmail"]').exists()).toBe(false);
    expect(wrapper.get('[data-plugin-name="slack"]').text()).toContain('Slack');
    expect(wrapper.get('[data-file-mention="README.md"]').text()).toContain('README.md');
    expect(wrapper.get('[data-mention-value="tail"]').text())
      .toBe('composer:trailing:trailing-only');
    expect(wrapper.findAll('.host-mention')).toHaveLength(3);
    expect(api(wrapper).readText()).toBe('@shared @gmail @slack @README.md @tail');
  });

  it('matches files by exact path or exact name without selecting an earlier file', () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: {
        files: [
          { name: 'other.txt', path: 'src/other.txt' },
          { name: 'target.txt', path: 'src/target.txt' },
        ],
        modelValue: '@src/target.txt @target.txt @missing.txt',
      },
    });

    const hosts = wrapper.findAll('[data-file-mention]');
    expect(hosts).toHaveLength(2);
    expect(hosts.map((host) => host.attributes('data-file-mention')))
      .toStrictEqual(['src/target.txt', 'target.txt']);
    expect(hosts.map((host) => host.attributes('aria-label')))
      .toStrictEqual(['target.txt', 'target.txt']);
    expect(api(wrapper).readText()).toBe('@src/target.txt @target.txt @missing.txt');
  });

  it('publishes exact chip accessibility, editability, icon, and trigger attributes', () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: {
        files: [{ name: 'README.md', path: 'README.md' }],
        mentionGroups: [{
          id: 'threads',
          label: 'Threads',
          items: [{ id: 'thread-1', value: 'thread', label: 'Thread one' }],
        }],
        modelValue: '@gmail @README.md $cp @thread',
        plugins: [plugin],
        skills: [skill],
      },
    });

    const pluginHost = wrapper.get('[data-plugin-name="gmail"]');
    const fileHost = wrapper.get('[data-file-mention="README.md"]');
    const skillHost = wrapper.get('[data-skill-name="cp"]');
    const customHost = wrapper.get('[data-mention-value="thread"]');
    for (const host of [pluginHost, fileHost, skillHost, customHost]) {
      expect(host.classes()).toContain('chat-rich-text-editor__chip-token-host');
      expect((host.element as HTMLElement).contentEditable).toBe('false');
    }
    expect(pluginHost.attributes('aria-label')).toBe('Gmail');
    expect(fileHost.attributes('aria-label')).toBe('README.md');
    expect(skillHost.attributes()).toMatchObject({
      'aria-label': 'Commit-Push (cp)',
      'data-skill-trigger': '$',
    });
    expect(customHost.attributes('aria-label')).toBe('Thread one');
    expect(customHost.text()).toBe('Thread one');
    expect(fileHost.get('svg').classes()).toContain('tabler-icon-file-text');
    expect(skillHost.get('svg').classes()).toContain('tabler-icon-sparkle-highlight');
    expect(customHost.get('svg').classes()).toContain('tabler-icon-plug-connected');
  });

  it('unmounts hosted mention components before replacing their DOM', () => {
    const onChipUnmounted = vi.fn();
    const HostedChip = defineComponent({
      setup() {
        onUnmounted(onChipUnmounted);
        return () => h('span', 'hosted chip');
      },
    });
    const wrapper = mount(ChatRichTextEditor, {
      props: {
        mentionGroups: [{
          id: 'threads',
          label: 'Threads',
          items: [{ id: 'thread-1', value: 'thread', label: 'Thread one' }],
        }],
        modelValue: '@thread',
      },
      slots: { mention: () => h(HostedChip) },
    });
    expect(wrapper.text()).toContain('hosted chip');

    api(wrapper).setText('plain', 5, { focus: false });

    expect(onChipUnmounted).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-mention-value]').exists()).toBe(false);
    expect(api(wrapper).readText()).toBe('plain');

    const unmountedWrapper = mount(ChatRichTextEditor, {
      props: {
        mentionGroups: [{
          id: 'threads',
          label: 'Threads',
          items: [{ id: 'thread-1', value: 'thread', label: 'Thread one' }],
        }],
        modelValue: '@thread',
      },
      slots: { mention: () => h(HostedChip) },
    });
    unmountedWrapper.unmount();
    expect(onChipUnmounted).toHaveBeenCalledTimes(2);
  });

  it('resizes after rendering and marks the trailing caret sentinel exactly', () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: { maxHeight: 50, modelValue: 'initial' },
    });
    const editor = wrapper.get('[role="textbox"]').element as HTMLElement;
    Object.defineProperty(editor, 'scrollHeight', { configurable: true, value: 120 });

    api(wrapper).setText('line\n', 5, { focus: false });

    expect(editor.style.height).toBe('50px');
    const breaks = wrapper.findAll('br');
    expect(breaks).toHaveLength(2);
    expect(breaks[1]?.attributes('data-trailing-line-break')).toBe('');
    expect(api(wrapper).readText()).toBe('line\n');
  });

  it('scrolls an oversized caret whose bottom is exactly aligned and leaves visible carets alone', () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'abcdef' },
    });
    const editor = wrapper.get('[role="textbox"]').element as HTMLElement;
    const editorRect = vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(domRect(20, 80));
    const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
    const rangeRect = vi.fn(() => domRect(0, 80));
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: rangeRect,
    });

    try {
      editor.scrollTop = 30;
      api(wrapper).setCaret(2);
      api(wrapper).insertTextAtSelection('X');
      expect(editor.scrollTop).toBe(10);

      rangeRect.mockReturnValue(domRect(30, 40));
      editor.scrollTop = 25;
      api(wrapper).insertTextAtSelection('Y');
      expect(editor.scrollTop).toBe(25);
    } finally {
      editorRect.mockRestore();
      if (originalRangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeRect);
      else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
      wrapper.unmount();
    }
  });

  it('preserves the caret when external text expands and stays safe after unmount', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'abc' },
    });
    const richEditor = api(wrapper);
    richEditor.setCaret(1);
    outside.focus();

    await wrapper.setProps({ modelValue: 'abcdefgh' });

    expect(richEditor.getSelectionRange()).toStrictEqual({ end: 1, start: 1, valid: false });
    expect(document.activeElement).toBe(outside);
    richEditor.setText('manual', 2, { focus: false });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toStrictEqual(['manual']);

    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue(null);
    expect(richEditor.getSelectionRange()).toStrictEqual({ end: 2, start: 2, valid: false });
    getSelection.mockRestore();

    wrapper.unmount();
    expect(richEditor.getSelectionRange()).toStrictEqual({ end: 2, start: 2, valid: false });
    expect(() => richEditor.setText('after unmount')).not.toThrow();
    outside.remove();
  });

  it('does not rebuild native input when the controlled model echoes its text', async () => {
    let wrapper!: ReturnType<typeof mount>;
    wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: {
        modelValue: 'draft',
        'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }),
      },
    });
    const editor = wrapper.get('[role="textbox"]');
    const typedNode = document.createTextNode('draftX');
    editor.element.replaceChildren(typedNode);
    select(typedNode, 6);

    await editor.trigger('input');
    await wrapper.vm.$nextTick();

    expect((wrapper.props() as { modelValue: string }).modelValue).toBe('draftX');
    expect(editor.element.firstChild).toBe(typedNode);
    expect(window.getSelection()?.anchorNode).toBe(typedNode);
    expect(window.getSelection()?.anchorOffset).toBe(6);
    wrapper.unmount();
  });

  it('refreshes an existing chip after an in-place catalog change', async () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: {
        modelValue: '@gmail',
        plugins: [plugin],
      },
    });
    const currentPlugin = wrapper.props('plugins')![0]! as typeof plugin;

    currentPlugin.displayName = 'Google Mail';
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-plugin-name="gmail"]').text()).toContain('Google Mail');
    expect(api(wrapper).readText()).toBe('@gmail');
  });

  it('removes the exact selection listener installed for its mounted lifetime', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const wrapper = mount(ChatRichTextEditor, { props: { modelValue: 'draft' } });
    const installed = addEventListener.mock.calls.find(([type]) => type === 'selectionchange');

    expect(installed).toBeDefined();
    wrapper.unmount();
    expect(removeEventListener).toHaveBeenCalledWith('selectionchange', installed?.[1]);

    addEventListener.mockRestore();
    removeEventListener.mockRestore();
  });

  it('ignores document selection changes whose range is outside the editor', () => {
    const outside = document.createTextNode('outside');
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'draft' },
    });
    document.body.append(outside);
    const before = wrapper.emitted('caret-change')?.length ?? 0;
    select(outside, 3);

    document.dispatchEvent(new Event('selectionchange'));

    expect(wrapper.emitted('caret-change') ?? []).toHaveLength(before);
    wrapper.unmount();
    outside.remove();
  });

  it('normalizes a stale trailing sentinel, restores focus, and preserves a leading newline', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: '\nx' },
    });
    const editor = wrapper.get('[role="textbox"]');
    const sentinel = document.createElement('br');
    sentinel.dataset.trailingLineBreak = '';
    editor.element.append(sentinel);
    select(editor.element.childNodes[1]!, 1);
    outside.focus();

    await editor.trigger('input');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toStrictEqual(['\nx']);
    expect(api(wrapper).readText()).toBe('\nx');
    expect(editor.findAll('br')).toHaveLength(1);
    expect(document.activeElement).toBe(editor.element);
    wrapper.unmount();
    outside.remove();
  });

  it('resets height before measuring ordinary browser input so the editor can shrink', async () => {
    const wrapper = mount(ChatRichTextEditor, { props: { modelValue: 'long draft' } });
    const editor = wrapper.get('[role="textbox"]');
    const element = editor.element as HTMLElement;
    let heightWhenMeasured = '';
    Object.defineProperty(element, 'scrollHeight', {
      configurable: true,
      get() {
        heightWhenMeasured = element.style.height;
        return heightWhenMeasured === 'auto' ? 20 : 120;
      },
    });
    element.style.height = '120px';
    element.replaceChildren(document.createTextNode('short'));
    select(element.firstChild!, 5);

    await editor.trigger('input');

    expect(heightWhenMeasured).toBe('auto');
    expect(element.style.height).toBe('20px');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toStrictEqual(['short']);
  });

  it('rejects a selection when only one endpoint belongs to the editor', () => {
    const outside = document.createTextNode('outside');
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'inside' },
    });
    document.body.append(outside);
    const inside = wrapper.get('[role="textbox"]').element.firstChild!;
    selectRange(inside, 1, outside, 3);

    expect(api(wrapper).getSelectionRange()).toStrictEqual({ end: 6, start: 6, valid: false });
    wrapper.unmount();
    outside.remove();
  });

  it('stops DOM traversal at the selected nested node and continues past shorter elements', () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: '' },
    });
    const editor = wrapper.get('[role="textbox"]').element;
    const nested = document.createElement('span');
    const targetWrapper = document.createElement('strong');
    const target = document.createTextNode('target');
    targetWrapper.append(target);
    nested.append(targetWrapper, document.createTextNode('later'));
    editor.replaceChildren(document.createTextNode('p'), nested, document.createTextNode('suffix'));
    select(target, 1);
    expect(api(wrapper).getSelectionRange()).toStrictEqual({ end: 2, start: 2, valid: true });

    const shortElement = document.createElement('span');
    shortElement.textContent = 'A';
    const followingText = document.createTextNode('B');
    editor.replaceChildren(shortElement, followingText);
    (editor as HTMLElement).focus();
    api(wrapper).setCaret(2, { focus: false });
    const selection = window.getSelection()!;
    expect([selection.anchorNode, selection.anchorOffset]).toStrictEqual([followingText, 1]);

    const sentinel = document.createElement('br');
    sentinel.dataset.trailingLineBreak = '';
    editor.replaceChildren(sentinel);
    api(wrapper).setCaret(0, { focus: false });
    expect([selection.anchorNode, selection.anchorOffset]).toStrictEqual([editor, 1]);
    wrapper.unmount();
  });

  it('keeps slash text literal even when its name collides with an at-mention', () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: {
        modelValue: '`@gmail code` /gmail',
        plugins: [plugin],
      },
    });

    expect(wrapper.find('[data-plugin-name]').exists()).toBe(false);
    expect(api(wrapper).readText()).toBe('`@gmail code` /gmail');
  });

  it('uses the caret top offset when scrolling upward', () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'abcdef' },
    });
    const editor = wrapper.get('[role="textbox"]').element as HTMLElement;
    const editorRect = vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(domRect(20, 80));
    const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: vi.fn(() => domRect(10, 15)),
    });

    try {
      editor.scrollTop = 30;
      api(wrapper).setCaret(2);
      api(wrapper).insertTextAtSelection('X');
      expect(editor.scrollTop).toBe(20);
    } finally {
      editorRect.mockRestore();
      if (originalRangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeRect);
      else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
      wrapper.unmount();
    }
  });
});

function api(wrapper: ReturnType<typeof mount>): CodexRichTextEditorExpose {
  return wrapper.vm as unknown as CodexRichTextEditorExpose;
}

function chip(dataset: Record<string, string>): HTMLElement {
  const element = document.createElement('span');
  Object.assign(element.dataset, dataset);
  return element;
}

function select(node: Node, offset: number): void {
  selectRange(node, offset, node, offset);
}

function selectRange(startNode: Node, startOffset: number, endNode: Node, endOffset: number): void {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function domRect(top: number, bottom: number): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    top,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}
