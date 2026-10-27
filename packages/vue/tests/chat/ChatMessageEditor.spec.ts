// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ChatMessageEditor from '../../src/chat/ChatMessageEditor.vue';
import ChatRichTextEditor, { type CodexRichTextEditorExpose } from '../../src/chat/ChatRichTextEditor.vue';

function mountEditor(content = 'Old prompt') {
  return mount(ChatMessageEditor, {
    props: {
      cancelLabel: 'Cancel',
      content,
      inputLabel: 'Edit prompt',
      saveLabel: 'Resubmit',
    },
  });
}

describe('ChatMessageEditor', () => {
  it('retains an explicitly selected skill when editing and resubmitting without catalogs', async () => {
    const part = { type: 'mention' as const, kind: 'skill' as const, id: '/skills/cp/SKILL.md', label: 'Commit-Push', value: 'cp' };
    const wrapper = mount(ChatMessageEditor, { props: {
      cancelLabel: 'Cancel', content: 'Commit-Push', promptContent: [part], inputLabel: 'Edit prompt', saveLabel: 'Resubmit',
    } });
    expect(wrapper.get('[role="textbox"]').text()).toBe('Commit-Push');
    const editor = wrapper.findComponent(ChatRichTextEditor).vm as unknown as CodexRichTextEditorExpose;
    editor.setCaret('Commit-Push'.length);
    editor.insertTextAtSelection(' now');
    await wrapper.get('.chat-message__edit-button--primary').trigger('click');
    expect(wrapper.emitted('save')).toStrictEqual([['Commit-Push now', { content: [part, { type: 'text', text: ' now' }] }]]);
  });

  it('focuses a structured edit and keeps IME, multiline paste, cancellation and keyboard saves intact', async () => {
    const part = { type: 'mention' as const, kind: 'skill' as const, id: '/skills/cp/SKILL.md', label: 'Commit-Push', value: 'cp' };
    const wrapper = mount(ChatMessageEditor, { attachTo: document.body, props: {
      cancelLabel: 'Cancel', content: 'Commit-Push', promptContent: [part], inputLabel: 'Edit prompt', saveLabel: 'Resubmit',
    } });
    try {
      const textbox = wrapper.get('[role="textbox"]');
      await vi.waitFor(() => expect(document.activeElement).toBe(textbox.element));
      await textbox.trigger('keydown', { key: 'Enter', isComposing: true });
      await textbox.trigger('keydown', { key: 'PageDown' });
      expect(wrapper.emitted('save')).toBeUndefined();
      await textbox.trigger('keydown', { key: 'Enter' });
      await textbox.trigger('paste');
      await textbox.trigger('paste', { clipboardData: { getData: () => '' } });
      await textbox.trigger('paste', { clipboardData: { getData: () => '<b>literal</b>' } });
      expect(textbox.find('b').exists()).toBe(false);
      await textbox.trigger('keydown', { key: 'Enter', ctrlKey: true });
      expect(wrapper.emitted('save')).toStrictEqual([['Commit-Push\n<b>literal</b>', {
        content: [part, { type: 'text', text: '\n<b>literal</b>' }],
      }]]);
      await textbox.trigger('keydown', { key: 'Enter', metaKey: true });
      expect(wrapper.emitted('save')).toHaveLength(2);
      await textbox.trigger('keydown', { key: 'Escape' });
      expect(wrapper.emitted('cancel')).toStrictEqual([[]]);
    } finally {
      wrapper.unmount();
    }
  });
  it('owns its draft and emits trimmed saves', async () => {
    const wrapper = mountEditor();
    expect(wrapper.get('textarea').attributes('aria-label')).toBe('Edit prompt');

    await wrapper.get('textarea').setValue('  New prompt  ');
    await wrapper.get('.chat-message__edit-button--primary').trigger('click');

    expect(wrapper.emitted('save')).toStrictEqual([['New prompt']]);
  });

  it('updates from its content interface and rejects blank saves', async () => {
    const wrapper = mountEditor();
    await (wrapper as unknown as {
      setProps(props: { content: string }): Promise<void>
    }).setProps({ content: 'Updated externally' });
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('Updated externally');

    await wrapper.get('textarea').setValue('   ');
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', metaKey: true });
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('emits cancellation from its button and keyboard interface', async () => {
    const wrapper = mountEditor();
    await wrapper.get('.chat-message__edit-button').trigger('click');
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' });

    expect(wrapper.emitted('cancel')).toStrictEqual([[], []]);
  });

  it('focuses the textarea and selects the draft end on its scheduled frame', () => {
    let focusCallback: FrameRequestCallback | undefined;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      focusCallback = callback;
      return 17;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const wrapper = mount(ChatMessageEditor, {
      attachTo: document.body,
      props: {
        cancelLabel: 'Cancel',
        content: 'Select my end',
        inputLabel: 'Edit prompt',
        saveLabel: 'Resubmit',
      },
    });
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea').element;
    textarea.setSelectionRange(0, 0);

    expect(requestFrame).toHaveBeenCalledOnce();
    focusCallback?.(0);

    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe('Select my end'.length);
    expect(textarea.selectionEnd).toBe('Select my end'.length);
    wrapper.unmount();
    expect(cancelFrame).not.toHaveBeenCalled();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it('cancels its pending focus frame when unmounted', () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(23);
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const wrapper = mountEditor();

    wrapper.unmount();

    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(23);
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });
});
