// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatComposerSkillMenu from '../../../packages/vue/src/chat/ChatComposerSkillMenu.vue';
import type { CodexSkillSummary } from '../../../packages/vue/src/chat/contracts';

const originalScrollIntoView = Element.prototype.scrollIntoView;

describe('ChatComposerSkillMenu', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    });
    vi.restoreAllMocks();
  });

  it('scrolls the active keyboard item into view', async () => {
    const scrolledElements: Element[] = [];
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(function scrollIntoView(this: Element) {
        scrolledElements.push(this);
      }),
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
