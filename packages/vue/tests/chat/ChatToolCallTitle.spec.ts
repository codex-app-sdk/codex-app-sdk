// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { markRaw } from 'vue';
import { describe, expect, it } from 'vitest';
import ChatToolCallTitle from '../../src/chat/ChatToolCallTitle.vue';

describe('ChatToolCallTitle', () => {
  it('renders running titles with line diffs and a host icon', () => {
    const Icon = markRaw({ template: '<svg data-test="tool-icon" />' });
    const wrapper = mount(ChatToolCallTitle, {
      props: {
        icon: Icon,
        lineDiff: { addedLines: 4, removedLines: 2 },
        running: true,
        title: 'editing files',
      },
    });

    expect(wrapper.text()).toContain('editing files');
    expect(wrapper.text()).toContain('+4');
    expect(wrapper.text()).toContain('-2');
    expect(wrapper.find('[data-test="tool-icon"]').exists()).toBe(true);
  });

  it('renders remove-only diffs', () => {
    const wrapper = mount(ChatToolCallTitle, {
      props: {
        lineDiff: { addedLines: 0, removedLines: 3 },
        title: 'removed lines',
      },
    });

    expect(wrapper.text()).toContain('-3');
    expect(wrapper.text()).not.toContain('+');
  });

  it('omits diff markup when no diff is provided', () => {
    const wrapper = mount(ChatToolCallTitle, { props: { title: 'searched files' } });

    expect(wrapper.text()).toContain('searched files');
    expect(wrapper.get('.chat-tool-call__title-content').text()).toBe('searched files');
    expect(wrapper.find('.chat-tool-call__diff').exists()).toBe(false);
  });

  it('separates a title prefix from its target', () => {
    const wrapper = mount(ChatToolCallTitle, {
      props: {
        title: 'Read README.md',
        titlePrefix: 'Read',
        titleTarget: 'README.md',
      },
    });

    expect(wrapper.get('.chat-tool-call__title-text').text()).toBe('Read README.md');
    expect(wrapper.get('.chat-tool-call__title-content').text()).toBe('Read README.md');
    expect(wrapper.get('.chat-tool-call__title-target').text()).toBe('README.md');
  });

  it('renders interactive file targets and emits for pointer and keyboard activation', async () => {
    const link = {
      href: '/workspace/project/tests/app-state.spec.ts',
      kind: 'file' as const,
      path: '/workspace/project/tests/app-state.spec.ts',
    };
    const wrapper = mount(ChatToolCallTitle, {
      props: {
        title: 'Read app-state.spec.ts',
        titlePrefix: 'Read',
        titleTarget: 'app-state.spec.ts',
        titleTargetLink: link,
      },
    });

    const target = wrapper.get('.chat-tool-call__title-target--link');
    expect(target.attributes('href')).toBe('/workspace/project/tests/app-state.spec.ts');
    expect(wrapper.emitted('open-link')).toBeUndefined();
    await target.trigger('click');
    await target.trigger('keydown', { key: 'Enter' });
    await target.trigger('keydown', { key: ' ' });
    expect(wrapper.emitted('open-link')).toEqual([[link], [link], [link]]);
  });

  it('preserves separators and activates links inside multipart targets', async () => {
    const link = {
      href: '/workspace/project/src/index.ts',
      kind: 'file' as const,
      path: '/workspace/project/src/index.ts',
    };
    const wrapper = mount(ChatToolCallTitle, {
      props: {
        title: 'Read src/index.ts and package.json',
        titlePrefix: 'Read',
        titleTarget: 'src/index.ts and package.json',
        titleTargetParts: [
          { label: 'src/index.ts', link },
          { label: 'package.json', separator: ' and ' },
        ],
      },
    });

    expect(wrapper.get('.chat-tool-call__title-target-separator').element.textContent).toBe(' and ');
    expect(wrapper.findAll('.chat-tool-call__title-target').map((target) => target.text()))
      .toStrictEqual(['src/index.ts', 'package.json']);
    const target = wrapper.get('.chat-tool-call__title-target--link');
    await target.trigger('click');
    await target.trigger('keydown', { key: 'Enter' });
    await target.trigger('keydown', { key: ' ' });

    expect(wrapper.emitted('open-link')).toStrictEqual([[link], [link], [link]]);
  });
});
