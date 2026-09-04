// @vitest-environment jsdom

import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureCodexPortalTheme: vi.fn(),
  renderMermaidSVG: vi.fn(),
}));

vi.mock('beautiful-mermaid', () => ({
  renderMermaidSVG: mocks.renderMermaidSVG,
}));

vi.mock('../../src/chat/portal-theme', () => ({
  captureCodexPortalTheme: mocks.captureCodexPortalTheme,
}));

import ChatMermaidBlock from '../../src/chat/ChatMermaidBlock.vue';

const wrappers: VueWrapper[] = [];

function mountBlock(code = 'graph TD; A-->B') {
  const wrapper = mount(ChatMermaidBlock, { props: { code } });
  wrappers.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  mocks.renderMermaidSVG.mockReset();
  mocks.renderMermaidSVG.mockReturnValue('<svg><text>Done</text></svg>');
  mocks.captureCodexPortalTheme.mockReset();
  mocks.captureCodexPortalTheme.mockReturnValue({
    mode: 'dark',
    style: { '--color-text': 'lime' },
  });
});

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ChatMermaidBlock', () => {
  it('renders with the SDK theme and strips external styles and raw label attributes', () => {
    mocks.renderMermaidSVG.mockReturnValue(
      '<svg data-label="unsafe"><style>@import  url(https://example.com/font.css);  .node{color:red}</style><text>Done</text></svg>',
    );

    const wrapper = mountBlock('graph TD; Start-->Done');

    expect(mocks.renderMermaidSVG).toHaveBeenCalledWith('graph TD; Start-->Done', {
      accent: 'var(--color-primary)',
      bg: 'var(--color-surface-lowest)',
      border: 'var(--color-border)',
      fg: 'var(--color-text)',
      line: 'var(--color-border-strong)',
      muted: 'var(--color-text-muted)',
      surface: 'var(--color-surface-low)',
      transparent: true,
    });
    expect(wrapper.get('.chat-mermaid-block__diagram').element.innerHTML)
      .toBe('<svg><style>.node{color:red}</style><text>Done</text></svg>');
    expect(wrapper.find('[aria-label="Show source"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Open fullscreen"]').exists()).toBe(true);
  });

  it('shows source and returns to the rendered diagram with exact labels', async () => {
    const wrapper = mountBlock('graph TD; A-->B');

    await wrapper.get('[aria-label="Show source"]').trigger('click');
    expect(wrapper.get('.chat-mermaid-block__code').text()).toBe('graph TD; A-->B');
    expect(wrapper.find('[aria-label="Render diagram"]').exists()).toBe(true);

    await wrapper.get('[aria-label="Render diagram"]').trigger('click');
    expect(wrapper.get('.chat-mermaid-block__diagram').text()).toBe('Done');
    expect(wrapper.find('[aria-label="Show source"]').exists()).toBe(true);
  });

  it('renders Error and non-Error parser failures as visible text', () => {
    mocks.renderMermaidSVG.mockImplementationOnce(() => {
      throw new Error('Invalid edge');
    });
    const errorWrapper = mountBlock();
    expect(errorWrapper.get('.chat-mermaid-block__error').text()).toBe('Invalid edge');

    mocks.renderMermaidSVG.mockImplementationOnce(() => {
      throw 'parser offline';
    });
    const stringWrapper = mountBlock();
    expect(stringWrapper.get('.chat-mermaid-block__error').text()).toBe('parser offline');
  });

  it('captures portal theme and closes only for Escape or explicit close actions', async () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const wrapper = mountBlock();

    await wrapper.get('[aria-label="Open fullscreen"]').trigger('click');
    const fullscreen = document.body.querySelector<HTMLElement>('.chat-mermaid-block__fullscreen');
    expect(mocks.captureCodexPortalTheme).toHaveBeenCalledWith(wrapper.element);
    expect(fullscreen?.dataset.codexTheme).toBe('dark');
    expect(fullscreen?.style.getPropertyValue('--color-text')).toBe('lime');
    expect(document.body.querySelector('[aria-label="Close fullscreen"]')).not.toBeNull();
    expect(addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.chat-mermaid-block__fullscreen')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.chat-mermaid-block__fullscreen')).toBeNull();
    expect(removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));

    await wrapper.get('[aria-label="Open fullscreen"]').trigger('click');
    document.body.querySelector<HTMLElement>('[aria-label="Close fullscreen"]')?.click();
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.chat-mermaid-block__fullscreen')).toBeNull();
  });

  it('removes the fullscreen key listener when unmounted while open', async () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const wrapper = mountBlock();

    await wrapper.get('[aria-label="Open fullscreen"]').trigger('click');
    removeEventListener.mockClear();
    wrapper.unmount();

    expect(removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
