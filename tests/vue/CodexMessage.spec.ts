// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { CodexMessage, type SurfaceMessage } from '../../src/vue';

const messages: SurfaceMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    status: 'complete',
    parts: [{ type: 'text', text: 'Build a surface' }],
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    status: 'streaming',
    parts: [
      { type: 'status', text: 'Working' },
      {
        type: 'tool',
        id: 'tool-1',
        title: 'Inspect repository',
        status: 'running',
        output: { files: 12 },
      },
    ],
  },
];

describe('CodexMessage', () => {
  it('renders safe text, status, tools, and streaming state', () => {
    const wrapper = mount(CodexMessage, { props: { message: messages[1]! } });

    expect(wrapper.text()).toContain('Working');
    expect(wrapper.text()).toContain('Inspect repository');
    expect(wrapper.text()).toContain('"files": 12');
    expect(wrapper.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('[aria-label="Streaming"]').exists()).toBe(true);
  });

  it('supports product-specific rendering through typed slots', () => {
    const wrapper = mount(CodexMessage, {
      props: { message: messages[0]! },
      slots: {
        text: ({ part }: { part: { text: string } }) => `CUSTOM ${part.text}`,
      },
    });
    expect(wrapper.text()).toBe('CUSTOM Build a surface');
  });
});
