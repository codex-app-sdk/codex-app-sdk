// @vitest-environment jsdom

import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureCodexPortalTheme: vi.fn(),
}));

vi.mock('../../src/chat/portal-theme', () => ({
  captureCodexPortalTheme: mocks.captureCodexPortalTheme,
}));

import ChatImageLightbox from '../../src/chat/ChatImageLightbox.vue';

const wrappers: VueWrapper[] = [];

function mountLightbox(open: boolean, themeSource: HTMLElement | null = null) {
  const wrapper = mount(ChatImageLightbox, {
    props: {
      alt: 'Generated skyline',
      label: 'Generated image preview',
      open,
      src: '/artifacts/skyline.webp',
      themeSource,
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  mocks.captureCodexPortalTheme.mockReset();
  mocks.captureCodexPortalTheme.mockReturnValue({
    mode: 'dark',
    style: { '--color-text': 'papayawhip' },
  });
});

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ChatImageLightbox', () => {
  it('renders the captured portal theme and exact dialog contract when initially open', () => {
    const themeSource = document.createElement('main');
    const wrapper = mountLightbox(true, themeSource);
    const dialog = document.body.querySelector<HTMLElement>('.chat-image-lightbox');
    const image = document.body.querySelector<HTMLImageElement>('.chat-image-lightbox__image');

    expect(mocks.captureCodexPortalTheme).toHaveBeenCalledOnce();
    expect(mocks.captureCodexPortalTheme).toHaveBeenCalledWith(themeSource);
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('Generated image preview');
    expect(dialog?.dataset.codexTheme).toBe('dark');
    expect(dialog?.style.getPropertyValue('--color-text')).toBe('papayawhip');
    expect(image?.alt).toBe('Generated skyline');
    expect(image?.getAttribute('src')).toBe('/artifacts/skyline.webp');
    expect(document.body.querySelector('[aria-label="Close fullscreen"]')).not.toBeNull();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('closes only from the backdrop, close button, or Escape key', async () => {
    const wrapper = mountLightbox(true);
    const dialog = document.body.querySelector<HTMLElement>('.chat-image-lightbox')!;
    const image = document.body.querySelector<HTMLElement>('.chat-image-lightbox__image')!;

    image.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(wrapper.emitted('close')).toBeUndefined();

    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.body.querySelector<HTMLElement>('[aria-label="Close fullscreen"]')?.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('close')).toStrictEqual([[], [], []]);
  });

  it('installs the keyboard listener only while open and recaptures each opening theme', async () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const firstSource = document.createElement('main');
    const secondSource = document.createElement('aside');
    const wrapper = mountLightbox(false, firstSource);

    expect(document.body.querySelector('.chat-image-lightbox')).toBeNull();
    expect(mocks.captureCodexPortalTheme).not.toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));

    await wrapper.setProps({ open: true });
    expect(mocks.captureCodexPortalTheme).toHaveBeenLastCalledWith(firstSource);
    expect(addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));

    await wrapper.setProps({ open: false });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeUndefined();

    mocks.captureCodexPortalTheme.mockReturnValueOnce({
      mode: 'light',
      style: { '--color-text': 'navy' },
    });
    await wrapper.setProps({ open: true, themeSource: secondSource });
    const dialog = document.body.querySelector<HTMLElement>('.chat-image-lightbox');
    expect(mocks.captureCodexPortalTheme).toHaveBeenLastCalledWith(secondSource);
    expect(dialog?.dataset.codexTheme).toBe('light');
    expect(dialog?.style.getPropertyValue('--color-text')).toBe('navy');

    const keydownHandler = [...addEventListener.mock.calls]
      .reverse()
      .find(([type]) => type === 'keydown')?.[1];
    removeEventListener.mockClear();
    wrapper.unmount();
    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith('keydown', keydownHandler);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});
