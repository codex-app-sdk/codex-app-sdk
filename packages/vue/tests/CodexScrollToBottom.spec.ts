// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CodexScrollToBottom from '../src/components/CodexScrollToBottom.vue';

describe('CodexScrollToBottom', () => {
  it('uses its accessible default label when no override is supplied', () => {
    const wrapper = mount(CodexScrollToBottom);

    expect(wrapper.attributes('aria-label')).toBe('Scroll to bottom');
    expect(wrapper.attributes('title')).toBe('Scroll to bottom');
  });

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
