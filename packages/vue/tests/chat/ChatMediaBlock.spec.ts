// @vitest-environment jsdom

import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatImageLightbox from '../../src/chat/ChatImageLightbox.vue';
import ChatMediaBlock from '../../src/chat/ChatMediaBlock.vue';
import type { MessageMedia } from '../../src/chat/types';

const wrappers: VueWrapper[] = [];

function mountMedia(media: MessageMedia, openImage?: NonNullable<InstanceType<typeof ChatMediaBlock>['$props']['openImage']>) {
  const wrapper = mount(ChatMediaBlock, { props: { media, openImage } });
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ChatMediaBlock', () => {
  it('renders exact generated-media fallbacks and inert download behavior', async () => {
    const openImage = vi.fn();
    const wrapper = mountMedia({ url: '/artifacts/generated.png' }, openImage);

    expect(wrapper.get('img').attributes()).toMatchObject({
      alt: 'Generated media',
      src: '/artifacts/generated.png',
    });
    expect(wrapper.get('.chat-media-block__title').text()).toBe('Generated media');
    expect(wrapper.get('.chat-media-block__image-button').attributes('aria-label'))
      .toBe('Open Generated media');
    expect(wrapper.get('[aria-label="Open fullscreen"]').attributes('aria-label')).toBe('Open fullscreen');
    expect(wrapper.get('[aria-label="Download media"]').attributes()).toMatchObject({
      download: 'generated-image',
      href: '/artifacts/generated.png',
    });
    expect(wrapper.find('[aria-label="Prompt"]').exists()).toBe(false);

    wrapper.get('[aria-label="Download media"]').element.addEventListener('click', (event) => event.preventDefault());
    await wrapper.get('[aria-label="Download media"]').trigger('click');
    expect(openImage).not.toHaveBeenCalled();
  });

  it.each([
    ['image/avif', 'avif'],
    ['image/gif', 'gif'],
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ])('derives a .%s download extension from %s', (mimeType, extension) => {
    const wrapper = mountMedia({ alt: '  generated result  ', mimeType, url: '/asset' });

    expect(wrapper.get('[aria-label="Download media"]').attributes('download'))
      .toBe(`generated result.${extension}`);
  });

  it('normalizes unsafe names and distinguishes valid filename extensions', () => {
    const unsafe = mountMedia({ title: 'a\\/:*?"<>|b', mimeType: 'image/png', url: '/asset' });
    const existing = mountMedia({ title: 'photo.JPEG', mimeType: 'image/png', url: '/asset' });
    const long = mountMedia({ title: 'archive.abcdef', mimeType: 'image/png', url: '/asset' });
    const short = mountMedia({ title: 'photo.a', mimeType: 'image/png', url: '/asset' });
    const nonAscii = mountMedia({ title: 'photo.éé', mimeType: 'image/png', url: '/asset' });
    const unknown = mountMedia({ title: 'artifact', mimeType: 'application/octet-stream', url: '/asset' });
    const blankTitle = mountMedia({ title: '   ', alt: 'fallback', mimeType: 'image/png', url: '/asset' });

    expect(unsafe.get('[aria-label="Download media"]').attributes('download')).toBe('a-b.png');
    expect(existing.get('[aria-label="Download media"]').attributes('download')).toBe('photo.JPEG');
    expect(long.get('[aria-label="Download media"]').attributes('download')).toBe('archive.abcdef.png');
    expect(short.get('[aria-label="Download media"]').attributes('download')).toBe('photo.a.png');
    expect(nonAscii.get('[aria-label="Download media"]').attributes('download')).toBe('photo.éé.png');
    expect(unknown.get('[aria-label="Download media"]').attributes('download')).toBe('artifact');
    expect(blankTitle.get('[aria-label="Download media"]').attributes('download')).toBe('fallback.png');
  });

  it('uses the available title or alt text in the image action label', () => {
    const altOnly = mountMedia({ alt: 'Preview alt', url: '/asset' });
    const titleOnly = mountMedia({ title: 'Preview title', url: '/asset' });

    expect(altOnly.get('.chat-media-block__image-button').attributes('aria-label')).toBe('Open Preview alt');
    expect(titleOnly.get('.chat-media-block__image-button').attributes('aria-label')).toBe('Open Preview title');
  });

  it('offers exact image context to the host and respects handled actions', async () => {
    const openImage = vi.fn(async () => true);
    const wrapper = mountMedia({
      alt: 'Preview alt',
      mimeType: 'image/webp',
      title: 'Preview title',
      url: '/artifacts/preview.webp',
    }, openImage);

    await wrapper.get('.chat-media-block__image-button').trigger('click');
    expect(openImage).toHaveBeenLastCalledWith({
      alt: 'Preview alt',
      kind: 'media',
      mimeType: 'image/webp',
      name: 'Preview title',
      src: '/artifacts/preview.webp',
      title: 'Preview title',
    }, { intent: 'open' });
    expect(wrapper.getComponent(ChatImageLightbox).props('open')).toBe(false);

    await wrapper.get('[aria-label="Open fullscreen"]').trigger('click');
    expect(openImage).toHaveBeenLastCalledWith(expect.any(Object), { intent: 'fullscreen' });
    expect(wrapper.getComponent(ChatImageLightbox).props('open')).toBe(false);
  });

  it('opens and closes the SDK lightbox when the host declines the action', async () => {
    const openImage = vi.fn(() => false);
    const wrapper = mountMedia({ alt: 'Fallback preview', url: '/artifacts/preview.png' }, openImage);

    await wrapper.get('[aria-label="Open fullscreen"]').trigger('click');
    expect(wrapper.getComponent(ChatImageLightbox).props()).toMatchObject({
      alt: 'Fallback preview',
      label: 'Generated media',
      open: true,
      src: '/artifacts/preview.png',
    });

    wrapper.getComponent(ChatImageLightbox).vm.$emit('close');
    await wrapper.vm.$nextTick();
    expect(wrapper.getComponent(ChatImageLightbox).props('open')).toBe(false);
  });

  it('toggles prompt details without changing their exact content', async () => {
    const wrapper = mountMedia({ prompt: 'Draw the UI\nwith contrast', url: '/asset.png' });
    const button = wrapper.get('[aria-label="Prompt"]');

    expect(wrapper.get('.chat-fold').classes()).not.toContain('chat-fold--open');
    await button.trigger('click');
    expect(wrapper.get('.chat-fold').classes()).toContain('chat-fold--open');
    expect(wrapper.get('.chat-media-block__details-title').text()).toBe('Prompt');
    expect(wrapper.get('.chat-media-block__prompt').text()).toBe('Draw the UI\nwith contrast');

    await button.trigger('click');
    expect(wrapper.get('.chat-fold').classes()).not.toContain('chat-fold--open');
  });
});
