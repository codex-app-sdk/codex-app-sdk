// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import ChatMentionChip from '../../../src/vue/chat/ChatMentionChip.vue';
import ChatComposerAtMentionMenu from '../../../src/vue/chat/ChatComposerAtMentionMenu.vue';
import ChatRichTextEditor, { type CodexRichTextEditorExpose } from '../../../src/vue/chat/ChatRichTextEditor.vue';

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

  it('emits canonical text when a chip is deleted from the editable DOM', async () => {
    const wrapper = mount(ChatRichTextEditor, {
      props: { modelValue: 'use $cp now', skills: [skill] },
    });
    wrapper.get('[data-skill-name="cp"]').element.remove();
    await wrapper.trigger('input');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toStrictEqual(['use  now']);
  });
});
