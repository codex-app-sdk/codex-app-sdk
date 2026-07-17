// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import {
  CodexConversationPane,
  type CodexComposerMenuItem,
  type SurfaceMessage,
} from '../../src/vue';

const messages: SurfaceMessage[] = [{
  id: 'assistant-1',
  role: 'assistant',
  status: 'complete',
  parts: [{ type: 'text', text: 'Ready to build' }],
}];

describe('CodexConversationPane', () => {
  it('renders its header, messages, empty state, and errors in isolation', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: { error: 'Connection lost', messages, modelValue: '', title: 'SDK conversation' },
    });
    expect(wrapper.text()).toContain('SDK conversation');
    expect(wrapper.text()).toContain('Ready to build');
    expect(wrapper.get('[role="alert"]').text()).toBe('Connection lost');

    await wrapper.setProps({ error: null, messages: [] });
    expect(wrapper.text()).toContain('Start a conversation with Codex');
  });

  it('owns composer behavior through its public events', async () => {
    const wrapper = mount(CodexConversationPane, {
      props: { busy: false, messages, modelValue: '  Ship it  ' },
    });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')).toStrictEqual([['Ship it']]);
    expect(wrapper.emitted('update:modelValue')).toContainEqual(['']);

    await wrapper.setProps({ busy: true, modelValue: '' });
    await wrapper.get('button[aria-label="Interrupt"]').trigger('click');
    expect(wrapper.emitted('interrupt')).toHaveLength(1);
  });

  it('exposes slots and extensible composer menu entries', async () => {
    const menuItems: CodexComposerMenuItem<{ source: string }>[] = [{
      id: 'custom-action',
      type: 'custom',
      label: 'Custom action',
      payload: { source: 'sample' },
    }];
    const wrapper = mount(CodexConversationPane, {
      props: { menuItems, messages: [], modelValue: '', title: 'Fallback' },
      slots: {
        header: '<strong class="custom-header">Custom header</strong>',
        empty: '<p class="custom-empty">Pick a prompt</p>',
        'before-composer': '<div class="custom-toolbar">Toolbar</div>',
      },
    });
    expect(wrapper.get('.custom-header').text()).toBe('Custom header');
    expect(wrapper.get('.custom-empty').text()).toBe('Pick a prompt');
    expect(wrapper.get('.custom-toolbar').text()).toBe('Toolbar');

    await wrapper.get('.codex-composer-menu__trigger').trigger('click');
    await wrapper.findAll('button').find((button) => button.text().includes('Custom action'))!.trigger('click');
    expect(wrapper.emitted('menuSelect')?.[0]).toStrictEqual([menuItems[0]]);
  });
});
