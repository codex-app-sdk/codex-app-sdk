// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatVisualizationBlock from '../../src/chat/ChatVisualizationBlock.vue';

describe('ChatVisualizationBlock', () => {
  it('opens a visualization when a path is available', async () => {
    const wrapper = mount(ChatVisualizationBlock, {
      props: { path: '/tmp/backlog.html', title: 'Backlog candidates' },
    });

    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('open-visualization')).toStrictEqual([[
      { path: '/tmp/backlog.html', title: 'Backlog candidates' },
    ]]);
  });

  it('renders a non-interactive label without a path', () => {
    const wrapper = mount(ChatVisualizationBlock, {
      props: { title: 'Visualization' },
    });

    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.text()).toBe('Visualization');
  });
});
