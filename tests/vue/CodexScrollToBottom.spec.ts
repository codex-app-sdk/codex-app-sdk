// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CodexScrollToBottom from '../../src/vue/components/CodexScrollToBottom.vue';

describe('CodexScrollToBottom', () => {
  it('renders an accessible circular arrow control and emits click', async () => {
    const wrapper = mount(CodexScrollToBottom, {
      props: { label: 'Jump to latest' },
    });

    const button = wrapper.get('button');
    expect(button.attributes('aria-label')).toBe('Jump to latest');
    expect(button.attributes('title')).toBe('Jump to latest');
    expect(button.find('svg').exists()).toBe(true);
    expect(button.find('svg').attributes('aria-hidden')).toBe('true');

    await button.trigger('click');
    expect(wrapper.emitted('click')).toStrictEqual([[]]);
  });
});
