// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatContextUsageIndicator from '../../src/chat/ChatContextUsageIndicator.vue';

describe('ChatContextUsageIndicator', () => {
  it('renders a context occupation circle with token detail', () => {
    const wrapper = mount(ChatContextUsageIndicator, {
      props: {
        contextUsage: {
          totalTokens: 397_740,
          inputTokens: 320_000,
          cachedInputTokens: 80_000,
          outputTokens: 72_000,
          reasoningOutputTokens: 24_000,
          lastTotalTokens: 64_600,
          modelContextWindow: 258_400,
          usedPercent: 25,
        },
      },
    });

    expect(wrapper.find('.chat-context-usage').exists()).toBe(true);
    expect(wrapper.attributes('aria-label')).toBe('Context usage');
    expect(wrapper.attributes('title')).toBeUndefined();
    expect(wrapper.get('.chat-context-usage__popover').text()).toBe('Context window:25% used (75% left)65k / 258k tokens used');
    expect(wrapper.attributes('style')).toContain('--chat-context-usage-percent: 25%');
  });

  it('caps the tooltip numerator when the latest context reaches the window', () => {
    const wrapper = mount(ChatContextUsageIndicator, {
      props: {
        contextUsage: {
          totalTokens: 397_740,
          inputTokens: 320_000,
          cachedInputTokens: 80_000,
          outputTokens: 72_000,
          reasoningOutputTokens: 24_000,
          lastTotalTokens: 397_740,
          modelContextWindow: 258_400,
          usedPercent: 100,
        },
      },
    });

    expect(wrapper.get('.chat-context-usage__popover').text()).toBe('Context window:100% used (0% left)258k / 258k tokens used');
  });

  it('stays hidden until a context utilization percent is available', () => {
    const wrapper = mount(ChatContextUsageIndicator, {
      props: {
        contextUsage: {
          totalTokens: 50_000,
          inputTokens: 40_000,
          cachedInputTokens: 10_000,
          outputTokens: 8_000,
          reasoningOutputTokens: 2_000,
          lastTotalTokens: 3_000,
          modelContextWindow: null,
          usedPercent: null,
        },
      },
    });

    expect(wrapper.html()).toBe('<!--v-if-->');
  });

  it.each([
    undefined,
    null,
  ])('stays hidden without context usage: %s', (contextUsage) => {
    const errors: unknown[] = [];
    const wrapper = mount(ChatContextUsageIndicator, {
      global: { config: { errorHandler: (error) => errors.push(error) } },
      props: { contextUsage },
    });

    expect(errors).toStrictEqual([]);
    expect(wrapper.html()).toBe('<!--v-if-->');
  });

  it('stays hidden without a numeric model context window', () => {
    const wrapper = mount(ChatContextUsageIndicator, {
      props: {
        contextUsage: {
          totalTokens: 1,
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          lastTotalTokens: 1,
          modelContextWindow: null,
          usedPercent: 1,
        },
      },
    });

    expect(wrapper.html()).toBe('<!--v-if-->');
  });

  it('stays hidden when usage percent is absent despite a valid context window', () => {
    const wrapper = mount(ChatContextUsageIndicator, {
      props: {
        contextUsage: {
          totalTokens: 1,
          inputTokens: 1,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          lastTotalTokens: 1,
          modelContextWindow: 1_000,
          usedPercent: null,
        },
      },
    });

    expect(wrapper.html()).toBe('<!--v-if-->');
  });

  it.each([
    [-1, '0% used (100% left)', '0%'],
    [24.6, '25% used (75% left)', '25%'],
    [100.6, '100% used (0% left)', '100%'],
  ])('rounds and clamps usage percent %s', (usedPercent, expectedText, expectedStyle) => {
    const wrapper = mount(ChatContextUsageIndicator, {
      props: {
        contextUsage: {
          totalTokens: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          lastTotalTokens: 0,
          modelContextWindow: 2_000_000,
          usedPercent,
        },
      },
    });

    expect(wrapper.text()).toContain(expectedText);
    expect(wrapper.attributes('style')).toContain(`--chat-context-usage-percent: ${expectedStyle}`);
  });

  it.each([
    [0, '0 / 2m tokens used'],
    [999, '999 / 2m tokens used'],
    [1_000, '1k / 2m tokens used'],
    [1_499, '1k / 2m tokens used'],
    [1_500, '2k / 2m tokens used'],
    [999_999, '1000k / 2m tokens used'],
    [1_000_000, '1m / 2m tokens used'],
    [1_049_999, '1m / 2m tokens used'],
    [1_050_000, '1.1m / 2m tokens used'],
  ])('formats the token-count boundary %s', (lastTotalTokens, expected) => {
    const wrapper = mount(ChatContextUsageIndicator, {
      props: {
        contextUsage: {
          totalTokens: lastTotalTokens,
          inputTokens: lastTotalTokens,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          lastTotalTokens,
          modelContextWindow: 2_000_000,
          usedPercent: 50,
        },
      },
    });

    expect(wrapper.text()).toContain(expected);
  });
});
