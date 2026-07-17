// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { CodexComposer } from '../../src/vue';

describe('CodexComposer', () => {
  it('emits trimmed prompts and clears its model', async () => {
    const wrapper = mount(CodexComposer, {
      props: { modelValue: '  hello Codex  ' },
    });

    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('submit')).toStrictEqual([['hello Codex']]);
    expect(wrapper.emitted('update:modelValue')).toContainEqual(['']);
  });

  it('updates drafts, preserves shifted newlines, and supports explicit shortcuts', async () => {
    const wrapper = mount(CodexComposer, {
      props: { modelValue: '', submitOnEnter: false },
    });
    await wrapper.get('textarea').setValue('next prompt');
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(wrapper.emitted('submit')).toBeUndefined();

    await wrapper.setProps({ modelValue: 'next prompt' });
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', metaKey: true });
    expect(wrapper.emitted('submit')).toStrictEqual([['next prompt']]);
    expect(wrapper.emitted('update:modelValue')).toContainEqual(['next prompt']);
  });

  it('switches the action to interrupt while busy and respects disabled state', async () => {
    const wrapper = mount(CodexComposer, {
      props: { busy: true, modelValue: '', interruptLabel: 'Stop agent' },
    });
    expect(wrapper.get('button').attributes('aria-label')).toBe('Stop agent');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('interrupt')).toHaveLength(1);

    await wrapper.setProps({ disabled: true });
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
  });

  it('exposes focus and blocks empty or composing submissions', async () => {
    const wrapper = mount(CodexComposer, { props: { modelValue: '   ' } });
    const focus = vi.spyOn(wrapper.get('textarea').element, 'focus');
    (wrapper.vm as unknown as { focus(): void }).focus();
    expect(focus).toHaveBeenCalledOnce();

    await wrapper.get('form').trigger('submit');
    await wrapper.setProps({ modelValue: 'composing' });
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', isComposing: true });
    expect(wrapper.emitted('submit')).toBeUndefined();
  });
});
