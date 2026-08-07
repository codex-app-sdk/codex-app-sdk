// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatRichTextEditor, {
  type CodexRichTextEditorExpose,
} from '../../../packages/vue/src/chat/ChatRichTextEditor.vue';

describe('ChatRichTextEditor leading empty line', () => {
  it('restores offset zero before the leading line break', () => {
    const wrapper = mount(ChatRichTextEditor, {
      attachTo: document.body,
      props: { modelValue: '\nExisting text' },
    });
    const editor = wrapper.get('[role="textbox"]').element;
    const richEditor = wrapper.vm as unknown as CodexRichTextEditorExpose;

    richEditor.setCaret(0);

    const selection = window.getSelection()!;
    expect(selection.anchorNode).toBe(editor);
    expect(selection.anchorOffset).toBe(0);
    expect(richEditor.getSelectionRange()).toStrictEqual({ end: 0, start: 0, valid: true });

    richEditor.setCaret(1);
    expect(selection.anchorNode).toBe(editor);
    expect(selection.anchorOffset).toBe(1);
    expect(richEditor.getSelectionRange()).toStrictEqual({ end: 1, start: 1, valid: true });

    wrapper.unmount();
  });
});
