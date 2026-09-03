// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatComposerSkillMenu from '../../src/chat/ChatComposerSkillMenu.vue';
import type { CodexSkillSummary } from '../../src/chat/contracts';

const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

describe('ChatComposerSkillMenu', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
    vi.restoreAllMocks();
  });

  it('scrolls the active keyboard item into view', async () => {
    const scrolledElements: Element[] = [];
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(function scrollIntoView(this: Element) {
        scrolledElements.push(this);
      }),
      writable: true,
    });
    const wrapper = mount(ChatComposerSkillMenu, {
      props: {
        activeIndex: 0,
        visibleSkills: createSkills(8),
      },
    });

    await wrapper.setProps({ activeIndex: 5 } as Record<string, unknown>);
    await nextTick();

    expect(scrolledElements.at(-1)?.textContent).toContain('Skill 6');
  });

  it('replaces an opaque plugin id with the canonical plugin namespace', () => {
    const wrapper = mount(ChatComposerSkillMenu, {
      props: {
        activeIndex: 0,
        plugins: [{
          id: 'app-69b31dc2110c8191b8b47dc98fe5a052@openai-curated-remote',
          name: 'app-69b31dc2110c8191b8b47dc98fe5a052',
          displayName: 'Dropbox',
          enabled: true,
        }],
        visibleSkills: [{
          name: 'app-69b31dc2110c8191b8b47dc98fe5a052:clean-up-dropbox-content',
          description: 'Clean up Dropbox content.',
          path: '/plugins/dropbox/skills/clean-up-dropbox-content/SKILL.md',
          enabled: true,
        }],
      },
    });

    expect(wrapper.get('.chat-composer-skill-menu__name').text())
      .toBe('dropbox:clean-up-dropbox-content');
    expect(wrapper.text()).not.toContain('app-69b31dc2110c8191b8b47dc98fe5a052');
  });
});

function createSkills(count: number): CodexSkillSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `skill-${index + 1}`,
    displayName: `Skill ${index + 1}`,
    description: `Skill ${index + 1} description`,
    path: `/Users/nbonamy/.codex/skills/skill-${index + 1}/SKILL.md`,
    scope: 'user',
    enabled: true,
  }));
}
