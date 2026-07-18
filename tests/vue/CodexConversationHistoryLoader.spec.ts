// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CodexConversationHistoryLoader from '../../src/vue/components/CodexConversationHistoryLoader.vue';

describe('CodexConversationHistoryLoader', () => {
  it('renders an accessible themed transcript skeleton in isolation', () => {
    const wrapper = mount(CodexConversationHistoryLoader);

    expect(wrapper.attributes('role')).toBe('status');
    expect(wrapper.attributes('aria-label')).toBe('Loading conversation');
    expect(wrapper.classes()).toContain('codex-chat-theme');
    expect(wrapper.findAll('.codex-conversation-history-loader__block')).toHaveLength(7);
  });
});
