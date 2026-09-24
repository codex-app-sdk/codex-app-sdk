// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import ChatMessageBlock from '../../src/chat/ChatMessageBlock.vue';
import productionStyles from '../../src/styles.css?inline';

beforeEach(() => {
  document.head.innerHTML = `<style>${productionStyles}</style>`;
});

describe('rendered code block styles', () => {
  it('does not draw a focus outline around the scrollable code block', () => {
    const wrapper = mount(ChatMessageBlock, {
      attachTo: document.body,
      props: { block: { type: 'text', content: '```sh\nnpm test\n```' } },
    });

    expect(getComputedStyle(wrapper.get('pre').element).outline).toBe('none');
  });

  it('applies wrap-preserving styles to rendered code', () => {
    const wrapper = mount(ChatMessageBlock, {
      attachTo: document.body,
      props: { block: { type: 'text', content: '```sh\n  a very long command\n```' } },
    });
    const style = getComputedStyle(wrapper.get('pre code').element);

    expect(style.overflowWrap).toBe('anywhere');
    expect(style.whiteSpace).toBe('pre-wrap');
  });
});
