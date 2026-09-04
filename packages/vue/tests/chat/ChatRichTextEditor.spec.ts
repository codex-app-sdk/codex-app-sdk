// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import ChatMentionChip from '../../src/chat/ChatMentionChip.vue';
import ChatComposerAtMentionMenu from '../../src/chat/ChatComposerAtMentionMenu.vue';
import ChatRichTextEditor, { type CodexRichTextEditorExpose } from '../../src/chat/ChatRichTextEditor.vue';

const skill = {
  name: 'Commit-Push (cp)',
  path: '/skills/commit-push/SKILL.md',
  enabled: true,
};

describe('ChatRichTextEditor', () => {
  it('renders canonical plugin, skill, and file tokens as editable chips', () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: {
        files: [{ name: 'README.md', path: 'README.md' }],
        modelValue: '@gmail $cp /cp @README.md',
        plugins: [{ id: 'gmail@remote', name: 'gmail', displayName: 'Gmail', enabled: true }],
        skills: [skill],
      },
    });

    expect(wrapper.find('[data-plugin-name="gmail"]').text()).toContain('Gmail');
    expect(wrapper.find('[data-skill-name="cp"]').text()).toContain('Commit-Push (cp)');
    expect(wrapper.find('[data-file-mention="README.md"]').text()).toContain('README.md');
    expect((wrapper.vm as unknown as CodexRichTextEditorExpose).readText())
      .toBe('@gmail $cp /cp @README.md');
  });

  it('renders host mentions with a custom composer chip while preserving stable text', () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: {
        mentionGroups: [{
          id: 'threads',
          label: 'Threads',
          items: [{ id: 'thread-1', value: 'thread:019abc', label: 'codex-claw' }],
        }],
        modelValue: 'Ask @thread:019abc',
      },
      slots: {
        mention: ({ item }: { item: { label: string } }) => h('span', { class: 'host-thread-chip' }, `🤖 ${item.label}`),
      },
    });

    expect(wrapper.get('[data-mention-value="thread:019abc"]').text()).toBe('🤖 codex-claw');
    expect((wrapper.vm as unknown as CodexRichTextEditorExpose).readText()).toBe('Ask @thread:019abc');
  });

  it('mounts the exported mention chip', () => {
    const wrapper = mount(ChatMentionChip, {
      props: { kind: 'skill', name: 'Commit-Push (cp)' },
    });

    expect(wrapper.text()).toBe('Commit-Push (cp)');
  });

  it('mounts the exported combined at-mention menu', () => {
    const wrapper = mount(ChatComposerAtMentionMenu, {
      props: {
        activeIndex: 0,
        showFileHint: false,
        visibleFiles: [{ name: 'README.md', path: 'README.md' }],
        visiblePlugins: [{ id: 'gmail@remote', name: 'gmail', displayName: 'Gmail', enabled: true }],
      },
    });
    expect(wrapper.text()).toContain('Plugins');
    expect(wrapper.text()).toContain('Files');
    expect(wrapper.findAll('.chat-composer-at-menu__item')).toHaveLength(2);
    expect(wrapper.findAll('.chat-composer-at-menu__item')[0]?.classes())
      .toContain('chat-composer-at-menu__item--active');
  });

  it('enriches plain mentions when catalogs arrive without changing canonical text', async () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: { modelValue: '@gmail $cp' },
    });
    expect(wrapper.find('.chat-mention-chip').exists()).toBe(false);

    await wrapper.setProps({
      plugins: [{ id: 'gmail@remote', name: 'gmail', displayName: 'Gmail', enabled: true }],
      skills: [skill],
    });

    expect(wrapper.findAll('.chat-mention-chip')).toHaveLength(2);
    expect((wrapper.vm as unknown as CodexRichTextEditorExpose).readText()).toBe('@gmail $cp');
  });

  it('preserves canonical offsets when inserting beside chips', async () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'use $cp now', skills: [skill] },
    });
    const richEditor = wrapper.vm as unknown as CodexRichTextEditorExpose;
    richEditor.setCaret('use $cp'.length);
    richEditor.insertTextAtSelection(' safely');
    await nextTick();

    expect(richEditor.readText()).toBe('use $cp safely now');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toStrictEqual(['use $cp safely now']);
    wrapper.unmount();
  });

  it('scrolls a trailing inserted newline into view at max height', () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: {
        modelValue: 'one\ntwo\nthree',
        maxHeight: 48,
      },
    });
    const element = wrapper.get('[role="textbox"]').element as HTMLElement;
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 96 });
    element.scrollTop = 0;
    const richEditor = wrapper.vm as unknown as CodexRichTextEditorExpose;

    richEditor.setCaret('one\ntwo\nthree'.length);
    richEditor.insertTextAtSelection('\n');

    expect(element.scrollTop).toBe(96);
  });

  it('scrolls an inserted line at a middle caret only when it leaves the viewport', () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'one\ntwo\nthree\nfour' },
    });
    const element = wrapper.get('[role="textbox"]').element as HTMLElement;
    const richEditor = wrapper.vm as unknown as CodexRichTextEditorExpose;
    const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
    const editorRect = vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(domRect(20, 80));

    try {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(() => domRect(100, 120)),
      });
      element.scrollTop = 5;
      richEditor.setCaret('one\ntwo\n'.length);
      richEditor.insertTextAtSelection('\n');
      expect(element.scrollTop).toBe(45);

      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: vi.fn(() => domRect(0, 10)),
      });
      element.scrollTop = 30;
      richEditor.setCaret('one'.length);
      richEditor.insertTextAtSelection('\n');
      expect(element.scrollTop).toBe(10);
    } finally {
      editorRect.mockRestore();
      if (originalRangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeRect);
      else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
      wrapper.unmount();
    }
  });

  it('keeps unmatched and code-wrapped mentions as text and prefers plugins over same-name files', () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: {
        files: [{ name: 'shared', path: 'shared' }],
        modelValue: '`@shared` @missing @shared $missing',
        plugins: [{ id: 'shared@remote', name: 'shared', displayName: 'Shared plugin', enabled: true }],
      },
    });

    expect(wrapper.findAll('[data-plugin-name="shared"]')).toHaveLength(1);
    expect(wrapper.find('[data-file-mention="shared"]').exists()).toBe(false);
    expect((wrapper.vm as unknown as CodexRichTextEditorExpose).readText())
      .toBe('`@shared` @missing @shared $missing');
  });

  it('supports disabled editors, focus-free text replacement, and invalid external selections', () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: { disabled: true, modelValue: 'initial', placeholder: 'Ask Codex' },
    });
    const element = wrapper.get('[role="textbox"]');
    const richEditor = wrapper.vm as unknown as CodexRichTextEditorExpose;
    const outside = document.createTextNode('outside');
    document.body.append(outside);
    const range = document.createRange();
    range.setStart(outside, 0);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(element.attributes('contenteditable')).toBe('false');
    expect(element.attributes('data-placeholder')).toBe('Ask Codex');
    expect(richEditor.getSelectionRange().valid).toBe(false);
    richEditor.setText('replacement', 3, { focus: false });
    expect(richEditor.readText()).toBe('replacement');
    outside.remove();
  });

  it('emits canonical text when a chip is deleted from the editable DOM', async () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: { modelValue: 'use $cp now', skills: [skill] },
    });
    wrapper.get('[data-skill-name="cp"]').element.remove();
    await wrapper.trigger('input');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toStrictEqual(['use  now']);
  });

  it('discards the browser placeholder break after deleting the last character', async () => {
    const wrapper = mount(ChatRichTextEditor, { props: { modelValue: 'x' } });
    const element = wrapper.get('[role="textbox"]');
    element.element.replaceChildren(document.createElement('br'));

    await element.trigger('input');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toStrictEqual(['']);
    expect((wrapper.vm as unknown as CodexRichTextEditorExpose).readText()).toBe('');
    expect(element.element.childNodes).toHaveLength(0);
  });

  it('keeps one intentional newline when deleting the final character of its line', async () => {
    const wrapper = mount(ChatRichTextEditor, { props: { modelValue: 'hello\nx' } });
    const element = wrapper.get('[role="textbox"]');
    element.element.replaceChildren(
      document.createTextNode('hello'),
      document.createElement('br'),
      document.createElement('br'),
    );

    await element.trigger('input');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toStrictEqual(['hello\n']);
    expect((wrapper.vm as unknown as CodexRichTextEditorExpose).readText()).toBe('hello\n');
    expect(element.findAll('br')).toHaveLength(2);
    expect(element.findAll('br')[1]?.attributes()).toHaveProperty('data-trailing-line-break');
  });

  it('applies external text and catalog updates without stealing focus', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: '@gmail tail' },
    });
    const richEditor = wrapper.vm as unknown as CodexRichTextEditorExpose;
    richEditor.setCaret(8);
    outside.focus();

    await wrapper.setProps({ modelValue: 'xy' });
    expect(richEditor.readText()).toBe('xy');
    expect(document.activeElement).toBe(outside);

    await wrapper.setProps({ modelValue: '@gmail' });
    await wrapper.setProps({
      plugins: [{ id: 'gmail@remote', name: 'gmail', displayName: 'Gmail', enabled: true }],
    });
    expect(wrapper.get('[data-plugin-name="gmail"]').text()).toContain('Gmail');
    expect(richEditor.readText()).toBe('@gmail');
    expect(document.activeElement).toBe(outside);

    wrapper.unmount();
    outside.remove();
  });

  it('renders one canonical chip when text and catalogs arrive together', async () => {
    const wrapper = mount(ChatRichTextEditor, { props: { modelValue: '' } });
    const richEditor = wrapper.vm as unknown as CodexRichTextEditorExpose;

    await wrapper.setProps({
      modelValue: '@gmail',
      plugins: [{ id: 'gmail@remote', name: 'gmail', displayName: 'Gmail', enabled: true }],
    });

    expect(wrapper.findAll('[data-plugin-name="gmail"]')).toHaveLength(1);
    expect(richEditor.readText()).toBe('@gmail');
  });

  it('publishes document selection changes only while mounted', async () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'selection' },
    });
    const richEditor = wrapper.vm as unknown as CodexRichTextEditorExpose;
    richEditor.setSelection(2, 6);
    await nextTick();
    const before = wrapper.emitted('caret-change')?.length ?? 0;

    document.dispatchEvent(new Event('selectionchange'));
    expect(wrapper.emitted('caret-change')?.at(-1)).toStrictEqual([
      { end: 6, start: 2, valid: true },
    ]);
    expect(wrapper.emitted('caret-change')).toHaveLength(before + 1);
    const events = wrapper.emitted('caret-change')!;

    wrapper.unmount();
    document.dispatchEvent(new Event('selectionchange'));
    expect(events).toHaveLength(before + 1);
  });

  it('emits exact text and selection state for valid and invalid browser input', async () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'abcd' },
    });
    const element = wrapper.get('[role="textbox"]');
    const richEditor = wrapper.vm as unknown as CodexRichTextEditorExpose;
    richEditor.setSelection(1, 3);
    await element.trigger('input');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toStrictEqual(['abcd']);
    expect(wrapper.emitted('caret-change')?.at(-1)).toStrictEqual([
      { end: 3, start: 1, valid: true },
    ]);
    expect(wrapper.emitted('input')?.at(-1)).toStrictEqual([]);

    const outside = document.createTextNode('outside');
    document.body.append(outside);
    const range = document.createRange();
    range.setStart(outside, 0);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.element.replaceChildren(document.createTextNode('changed'));
    await element.trigger('input');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toStrictEqual(['changed']);
    expect(wrapper.emitted('caret-change')?.at(-1)).toStrictEqual([
      { end: 7, start: 7, valid: false },
    ]);
    outside.remove();
    wrapper.unmount();
  });

  it('resizes through the public editor API and remains safe after unmount', () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: { maxHeight: 50, modelValue: 'draft' },
    });
    const element = wrapper.get('[role="textbox"]').element as HTMLElement;
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 120 });
    const richEditor = wrapper.vm as unknown as CodexRichTextEditorExpose;

    richEditor.autoResize();
    expect(element.style.height).toBe('50px');
    wrapper.unmount();
    expect(() => richEditor.autoResize()).not.toThrow();
  });

  it('keeps an existing focused selection when rendering with implicit focus ownership', () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: 'draft' },
    });
    const element = wrapper.get('[role="textbox"]').element as HTMLElement;
    const richEditor = wrapper.vm as unknown as CodexRichTextEditorExpose;
    richEditor.setSelection(1, 4);
    expect(document.activeElement).toBe(element);

    richEditor.setText('updated', 3);
    expect(document.activeElement).toBe(element);
    expect(richEditor.getSelectionRange()).toStrictEqual({ end: 3, start: 3, valid: true });
    wrapper.unmount();
  });
});

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
