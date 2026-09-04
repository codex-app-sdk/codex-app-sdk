// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatAttachmentBlock from '../../src/chat/ChatAttachmentBlock.vue';
import ChatComposerSlashMenu from '../../src/chat/ChatComposerSlashMenu.vue';
import ChatFoldTransition from '../../src/chat/ChatFoldTransition.vue';
import ChatFollowUps from '../../src/chat/ChatFollowUps.vue';
import ChatGoal from '../../src/chat/ChatGoal.vue';
import ChatIconButton from '../../src/chat/ChatIconButton.vue';
import ChatImageLightbox from '../../src/chat/ChatImageLightbox.vue';
import ChatMediaBlock from '../../src/chat/ChatMediaBlock.vue';
import ChatMermaidBlock from '../../src/chat/ChatMermaidBlock.vue';
import ChatMessageActions from '../../src/chat/ChatMessageActions.vue';
import ChatQueuedPrompt from '../../src/chat/ChatQueuedPrompt.vue';
import ChatTurnGitInfo from '../../src/chat/ChatTurnGitInfo.vue';

describe('public conversation leaf components', () => {
  afterEach(() => {
    delete (window as Window & { codexAppSdkNative?: unknown }).codexAppSdkNative;
  });

  it('does not use blocked filesystem URLs as image previews', async () => {
    const wrapper = mount(ChatAttachmentBlock, {
      props: {
        attachment: {
          kind: 'image',
          name: 'diagram.png',
          path: '/tmp/diagram.png',
          url: 'file:///tmp/diagram.png',
          mimeType: 'image/png',
        },
      },
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('a').attributes('href')).toBe('/tmp/diagram.png');
    expect(wrapper.text()).toContain('diagram.png');

    await wrapper.setProps({
      attachment: {
        kind: 'file', name: 'unsafe.txt', path: 'javascript:alert(1)', mimeType: 'text/plain',
      },
    });
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.get('span.chat-attachment-block--chip').text()).toContain('unsafe.txt');
  });

  it('loads historical local image previews through the native bridge', async () => {
    const readImagePreview = vi.fn(async () => 'data:image/png;base64,cG5n');
    Object.defineProperty(window, 'codexAppSdkNative', {
      configurable: true,
      value: { readImagePreview },
    });
    const wrapper = mount(ChatAttachmentBlock, {
      props: {
        attachment: {
          kind: 'image',
          name: 'diagram.png',
          path: '/tmp/diagram.png',
        },
      },
    });

    await flushPromises();
    expect(readImagePreview).toHaveBeenCalledWith('/tmp/diagram.png');
    expect(wrapper.get('img').attributes('src')).toBe('data:image/png;base64,cG5n');
  });

  it('mounts the slash menu independently', () => {
    const wrapper = mount(ChatComposerSlashMenu, {
      props: {
        activeIndex: 0,
        visibleCommands: [{ id: 'compact', name: 'compact' }],
        visibleSkills: [],
      },
    });

    expect(wrapper.attributes('aria-label')).toBe('Commands and skills');
    expect(wrapper.text()).toContain('compact');
    expect(wrapper.classes()).toContain('codex-chat-theme');
  });

  it('renders and selects both command and skill slash results', async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
      writable: true,
    });
    try {
      const command = { id: 'review', name: 'review', description: 'Review changes' };
      const skill = {
        name: 'tests',
        description: 'Run the test suite',
        path: '/skills/tests/SKILL.md',
        enabled: true,
      };
      const wrapper = mount(ChatComposerSlashMenu, {
        props: {
          activeIndex: 1,
          visibleCommands: [command],
          visibleSkills: [skill],
        },
      });

      expect(wrapper.text()).toContain('Commands');
      expect(wrapper.text()).toContain('Skills');
      expect(wrapper.findAll('.chat-composer-slash-menu__item')[1]?.classes())
        .toContain('chat-composer-slash-menu__item--active');
      await wrapper.findAll('.chat-composer-slash-menu__item')[0]?.trigger('mousedown');
      await wrapper.findAll('.chat-composer-slash-menu__item')[1]?.trigger('mousedown');
      expect(wrapper.emitted('selectCommand')).toStrictEqual([[command]]);
      expect(wrapper.emitted('selectSkill')).toStrictEqual([[skill]]);

      await wrapper.setProps({ activeIndex: 0 });
      await nextTick();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

      scrollIntoView.mockReset();
      await wrapper.setProps({ activeIndex: 99 });
      await nextTick();
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      }
    }
  });

  it('mounts the fold transition independently', () => {
    const wrapper = mount(ChatFoldTransition, {
      props: { open: true },
      slots: { default: 'Details' },
    });

    expect(wrapper.text()).toBe('Details');
    expect(wrapper.classes()).toContain('chat-fold--open');
  });

  it('mounts follow-ups independently and emits the prompt', async () => {
    const wrapper = mount(ChatFollowUps, { props: { prompts: ['Continue'] } });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('send-follow-up')).toStrictEqual([['Continue']]);
  });

  it('mounts the goal independently', () => {
    const wrapper = mount(ChatGoal, {
      props: {
        goal: {
          threadId: 'thread-1', objective: 'Ship parity', status: 'active', tokenBudget: null,
          tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0,
        },
      },
    });
    expect(wrapper.text()).toContain('Ship parity');
  });

  it('mounts icon buttons independently as buttons or links', () => {
    const button = mount(ChatIconButton, { props: { label: 'Inspect' }, slots: { default: '!' } });
    expect(button.element.tagName).toBe('BUTTON');
    expect(button.attributes('aria-label')).toBe('Inspect');

    const link = mount(ChatIconButton, { props: { href: '/artifact', label: 'Artifact' } });
    expect(link.element.tagName).toBe('A');
    expect(link.attributes('href')).toBe('/artifact');
  });

  it('mounts the shared image lightbox independently', async () => {
    const wrapper = mount(ChatImageLightbox, {
      props: {
        alt: 'Preview',
        label: 'Image preview',
        open: true,
        src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      },
    });
    expect(document.body.querySelector('.chat-image-lightbox__image')?.getAttribute('alt')).toBe('Preview');
    document.body.querySelector<HTMLElement>('[aria-label="Close fullscreen"]')?.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('mounts media independently', () => {
    const wrapper = mount(ChatMediaBlock, {
      props: { media: { alt: 'Preview', url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } },
    });
    expect(wrapper.get('img').attributes('alt')).toBe('Preview');
  });

  it('mounts Mermaid diagrams independently', async () => {
    const wrapper = mount(ChatMermaidBlock, { props: { code: 'graph TD; A-->B' } });
    expect(wrapper.classes()).toContain('codex-chat-theme');
    await wrapper.get('[aria-label="Show source"]').trigger('click');
    expect(wrapper.get('code').text()).toBe('graph TD; A-->B');
  });

  it('mounts message actions independently', () => {
    const wrapper = mount(ChatMessageActions, {
      props: { message: { role: 'assistant', content: 'Done' } },
    });
    expect(wrapper.find('[aria-label="Copy"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Retry"]').exists()).toBe(true);
  });

  it('mounts queued prompts independently', async () => {
    const wrapper = mount(ChatQueuedPrompt, { props: { prompt: { id: 'queue-1', text: 'Run tests' } } });
    expect(wrapper.get('[aria-label="Steer queued prompt now"] svg').attributes('class')).toContain('tabler-icon-steering-wheel');
    await wrapper.get('[aria-label="Steer queued prompt now"]').trigger('click');
    expect(wrapper.emitted('steer')).toStrictEqual([['queue-1']]);
    await wrapper.get('[aria-label="Edit queued prompt"]').trigger('click');
    expect(wrapper.emitted('edit')).toStrictEqual([['queue-1']]);
    await wrapper.setProps({ editDisabled: true });
    expect(wrapper.get('[aria-label="Edit queued prompt"]').attributes('disabled')).toBeDefined();
  });

  it('mounts turn diff independently', () => {
    const wrapper = mount(ChatTurnGitInfo, {
      props: { diff: { turnId: 'turn-1', addedLines: 8, removedLines: 3, updatedAt: '2026-07-17T00:00:00Z' } },
    });
    expect(wrapper.text()).toContain('+8');
    expect(wrapper.text()).toContain('-3');
  });
});
