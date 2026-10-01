// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import ChatRichTextEditor from '../src/chat/ChatRichTextEditor.vue';
import type { CodexComposerState } from '../src/composer-state';
import CodexComposer from '../src/components/CodexComposer.vue';

describe('controlled composer caret', () => {
  it('does not rebuild the editor when native caret movement echoes through controlled state', async () => {
    const composerState = ref<CodexComposerState>({
      text: '\nExisting text',
      selectionStart: 1,
      selectionEnd: 1,
    });
    const host = defineComponent(() => () => h(CodexComposer, {
      composerState: composerState.value,
      disabled: false,
      isSending: false,
      placeholder: 'Ask Codex…',
      'onUpdate:composerState': (state: CodexComposerState) => {
        composerState.value = state;
      },
    }));
    const wrapper = mount(host, { attachTo: document.body });
    await nextTick();
    await nextTick();

    const editor = wrapper.get<HTMLElement>('[role="textbox"]').element;
    editor.focus();
    const existingTextNode = editor.childNodes[1];
    const range = document.createRange();
    range.setStart(editor, 0);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    document.dispatchEvent(new Event('selectionchange'));
    await nextTick();
    await nextTick();

    expect(composerState.value).toStrictEqual({
      text: '\nExisting text',
      selectionStart: 0,
      selectionEnd: 0,
    });
    expect(editor.childNodes[1]).toBe(existingTextNode);
    expect(selection.anchorNode).toBe(editor);
    expect(selection.anchorOffset).toBe(0);
    expect(wrapper.findComponent(ChatRichTextEditor).exists()).toBe(true);

    composerState.value = {
      text: '\nExisting text',
      selectionStart: 1,
      selectionEnd: 1,
    };
    await nextTick();
    await nextTick();

    expect(editor.childNodes[1]).toBe(existingTextNode);
    expect(selection.anchorNode).toBe(editor);
    expect(selection.anchorOffset).toBe(1);

    wrapper.unmount();
  });
});
