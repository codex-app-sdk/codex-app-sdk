// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CodexMessageTurn from '../src/components/CodexMessageTurn.vue';

describe('CodexMessageTurn', () => {
  it('renders its turn content without adding a layout wrapper', () => {
    const wrapper = mount(CodexMessageTurn, {
      props: { entries: [], showToolBlocks: true, turnId: 'turn-1' },
      slots: { default: '<p>Turn content</p>' },
    });

    expect(wrapper.classes()).toContain('codex-message-turn');
    expect(wrapper.get('p').text()).toBe('Turn content');
  });
});
