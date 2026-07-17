// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { CodexComposerSendButton } from '../../src/vue';

describe('CodexComposerSendButton', () => {
  it('renders submit and busy states and emits clicks', async () => {
    const wrapper = mount(CodexComposerSendButton, {
      props: {
        interruptLabel: 'Codex is working',
        submitLabel: 'Run',
      },
    });
    expect(wrapper.attributes('aria-label')).toBe('Run');
    expect(wrapper.find('.codex-composer-send-button__spinner').exists()).toBe(false);
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toStrictEqual([[]]);

    await wrapper.setProps({ busy: true });
    expect(wrapper.attributes('aria-label')).toBe('Codex is working');
    expect(wrapper.classes()).toContain('codex-composer-send-button--busy');
    expect(wrapper.find('.codex-composer-send-button__spinner').exists()).toBe(true);
    expect(wrapper.find('.codex-composer-send-button__stop').exists()).toBe(true);
  });
});
