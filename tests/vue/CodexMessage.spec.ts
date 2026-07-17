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

  it('renders tool body and string output fallbacks and supports all part slots', () => {
    const fallback = mount(CodexMessage, {
      props: {
        message: {
          id: 'tools', role: 'assistant', status: 'error', parts: [
            { type: 'tool', id: 'body', title: 'Body', status: 'failed', statusText: 'Failed', body: 'stderr' },
            { type: 'tool', id: 'string', title: 'String', status: 'completed', output: 'plain output' },
          ],
        },
      },
    });
    expect(fallback.text()).toContain('Failed');
    expect(fallback.text()).toContain('stderr');
    expect(fallback.text()).toContain('plain output');
    expect(fallback.attributes('aria-busy')).toBeUndefined();

    const slotted = mount(CodexMessage, {
      props: { message: messages[1]! },
      slots: {
        status: 'CUSTOM STATUS',
        tool: 'CUSTOM TOOL',
      },
    });
    expect(slotted.text()).toContain('CUSTOM STATUS');
    expect(slotted.text()).toContain('CUSTOM TOOL');
  });
});
