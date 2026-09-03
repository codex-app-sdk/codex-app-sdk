// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexSurfacePlugin } from '@codex-app-sdk/core/surface';
import type { CodexFileSearchItem, CodexSkillSummary } from '../../src/chat/contracts';
import ChatComposerAtMentionMenu from '../../src/chat/ChatComposerAtMentionMenu.vue';
import ChatComposerFileMentionMenu from '../../src/chat/ChatComposerFileMentionMenu.vue';
import ChatComposerPluginMenu from '../../src/chat/ChatComposerPluginMenu.vue';
import ChatComposerSkillMenu from '../../src/chat/ChatComposerSkillMenu.vue';

const plugin: CodexSurfacePlugin = {
  id: 'gmail@remote', name: 'gmail', displayName: 'Gmail',
  shortDescription: 'Read and manage mail', iconUrl: 'https://example.com/gmail.png', enabled: true,
};
const pluginWithoutIcon: CodexSurfacePlugin = {
  id: 'drive@remote', name: 'drive', displayName: 'Drive', enabled: true,
};
const file: CodexFileSearchItem = { name: 'README.md', path: 'README.md' };
const skill: CodexSkillSummary = {
  name: 'review', displayName: 'Review', description: 'Review changes',
  path: '/skills/review/SKILL.md', enabled: true,
};

describe('composer suggestion menus', () => {
  const scrollIntoView = vi.fn();
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
      writable: true,
    });
  });

  afterEach(() => {
    scrollIntoView.mockReset();
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('renders combined plugin and file results with correct active indexing', async () => {
    const wrapper = mount(ChatComposerAtMentionMenu, {
      props: {
        activeIndex: 1,
        showFileHint: false,
        visiblePlugins: [plugin],
        visibleFiles: [file],
      },
    });
    expect(wrapper.text()).toContain('Plugins');
    expect(wrapper.text()).toContain('Files');
    expect(wrapper.findAll('.chat-composer-at-menu__item')[1]?.classes())
      .toContain('chat-composer-at-menu__item--active');
    await wrapper.findAll('button')[0]!.trigger('mousedown');
    await wrapper.findAll('button')[1]!.trigger('mousedown');
    expect(wrapper.emitted('select-plugin')).toStrictEqual([[plugin]]);
    expect(wrapper.emitted('select-file')).toStrictEqual([[file]]);
  });

  it('renders host mention groups before built-ins with an app-owned row slot', async () => {
    const group = {
      id: 'threads',
      label: 'Threads',
      items: [{ id: 'thread-1', value: 'thread:019abc', label: 'codex-claw' }],
    };
    const wrapper = mount(ChatComposerAtMentionMenu, {
      props: {
        activeIndex: 0,
        mentionGroups: [group],
        showFileHint: false,
        visiblePlugins: [plugin],
        visibleFiles: [file],
      },
      slots: {
        mention: ({ item }: { item: { label: string } }) => h('span', { class: 'host-thread' }, `🤖 ${item.label}`),
      },
    });

    expect(wrapper.findAll('.chat-composer-at-menu__section').map((section) => section.text()))
      .toStrictEqual(['Threads', 'Plugins', 'Files']);
    expect(wrapper.get('.host-thread').text()).toBe('🤖 codex-claw');
    expect(wrapper.findAll('.chat-composer-at-menu__item')[0]?.classes())
      .toContain('chat-composer-at-menu__item--active');
    await wrapper.findAll('button')[0]!.trigger('mousedown');
    expect(wrapper.emitted('select-mention')).toStrictEqual([[group.items[0], group]]);
  });

  it('shows the file-search hint only when requested and files are absent', async () => {
    const wrapper = mount(ChatComposerAtMentionMenu, {
      props: { activeIndex: 0, showFileHint: true, visiblePlugins: [], visibleFiles: [] },
    });
    expect(wrapper.text()).toContain('Type to search files');
    await wrapper.setProps({ visibleFiles: [file] });
    expect(wrapper.text()).not.toContain('Type to search files');
    expect(wrapper.text()).toContain('README.md');
  });

  it('renders plugin icons and fallbacks, emits selection, and scrolls active updates', async () => {
    const wrapper = mount(ChatComposerPluginMenu, {
      props: { activeIndex: 0, visiblePlugins: [plugin, pluginWithoutIcon] },
    });
    expect(wrapper.get('img').attributes('src')).toBe('https://example.com/gmail.png');
    expect(wrapper.findAll('.chat-composer-plugin-menu__icon')).toHaveLength(2);
    await wrapper.findAll('button')[1]!.trigger('mousedown');
    expect(wrapper.emitted('select')).toStrictEqual([[pluginWithoutIcon]]);
    await wrapper.setProps({ activeIndex: 1 });
    await nextTick();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    await wrapper.setProps({ activeIndex: 10 });
    await nextTick();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ visiblePlugins: [] });
    expect(wrapper.text()).toContain('No matching plugins');
  });

  it('renders file hint, empty state, selection, and active scrolling', async () => {
    const wrapper = mount(ChatComposerFileMentionMenu, {
      props: { activeIndex: 0, showHint: true, visibleFiles: [] },
    });
    expect(wrapper.text()).toContain('Start typing to search files');
    await wrapper.setProps({ showHint: false });
    expect(wrapper.text()).toContain('No matching files');
    await wrapper.setProps({ visibleFiles: [file] });
    await nextTick();
    await wrapper.get('button').trigger('mousedown');
    expect(wrapper.emitted('select')).toStrictEqual([[file]]);
    scrollIntoView.mockReset();
    await wrapper.setProps({ activeIndex: 1 });
    await nextTick();
    expect(scrollIntoView).not.toHaveBeenCalled();
    await wrapper.setProps({ activeIndex: 0 });
    await nextTick();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('renders skill fallback state, selection, and active scrolling', async () => {
    const wrapper = mount(ChatComposerSkillMenu, {
      props: { activeIndex: 0, visibleSkills: [] },
    });
    expect(wrapper.text()).toContain('No matching skills');
    await wrapper.setProps({ visibleSkills: [skill] });
    await nextTick();
    expect(wrapper.text()).toContain('Review');
    expect(wrapper.text()).toContain('Review changes');
    await wrapper.get('button').trigger('mousedown');
    expect(wrapper.emitted('select')).toStrictEqual([[skill]]);
    scrollIntoView.mockReset();
    await wrapper.setProps({ activeIndex: 1 });
    await nextTick();
    expect(scrollIntoView).not.toHaveBeenCalled();
    await wrapper.setProps({ activeIndex: 0 });
    await nextTick();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });
});
