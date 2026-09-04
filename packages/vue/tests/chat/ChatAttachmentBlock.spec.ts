// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatAttachmentBlock from '../../src/chat/ChatAttachmentBlock.vue';
import type { MessageAttachment } from '../../src/chat/types';

function attachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    kind: 'image',
    name: 'diagram.png',
    mimeType: 'image/png',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('ChatAttachmentBlock', () => {
  afterEach(() => {
    delete (window as Window & { codexAppSdkNative?: unknown }).codexAppSdkNative;
    document.body.innerHTML = '';
  });

  it.each([
    'https://example.test/image.png',
    'http://example.test/image.png',
    'blob:https://example.test/image',
    './image.png',
    '../image.png',
    '/images/image.png',
    'data:image/avif;base64,YQ==',
    'data:image/bmp;base64,YQ==',
    'data:image/gif;base64,YQ==',
    'data:image/heic;base64,YQ==',
    'data:image/heif;base64,YQ==',
    'data:image/jpeg;base64,YQ==',
    'data:image/jpg;base64,YQ==',
    'data:image/png;base64,YQ==',
    'data:image/webp;base64,YQ==',
  ])('renders an accepted image source: %s', (url) => {
    const wrapper = mount(ChatAttachmentBlock, { props: { attachment: attachment({ url }) } });

    expect(wrapper.get('img').attributes('src')).toBe(url);
    expect(wrapper.get('figure').attributes('title')).toBe(url);
  });

  it.each([
    undefined,
    '',
    '//server/share/image.png',
    'ftp://example.test/image.png',
    'javascript:alert(1)',
    'xhttps://example.test/image.png',
    'data:image/svg+xml;base64,YQ==',
    'prefix-data:image/png;base64,YQ==',
  ])('renders an unsafe or absent image source as a non-link chip: %s', (url) => {
    const wrapper = mount(ChatAttachmentBlock, { props: { attachment: attachment({ url }) } });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.element.tagName).toBe('SPAN');
    expect(wrapper.attributes('href')).toBeUndefined();
  });

  it('renders non-image attachments as chips even when their URL is image-safe', () => {
    const wrapper = mount(ChatAttachmentBlock, {
      props: {
        attachment: attachment({ kind: 'file', name: 'notes.txt', url: 'https://example.test/image.png' }),
      },
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('a').attributes('href')).toBe('https://example.test/image.png');
    expect(wrapper.text()).toBe('notes.txt');
  });

  it.each([
    ['/tmp/report.txt', '/tmp/report.txt'],
    ['./report.txt', './report.txt'],
    ['folder/name:part.txt', 'folder/name:part.txt'],
    ['C:\\temp\\report.txt', 'C:\\temp\\report.txt'],
    ['D:/temp/report.txt', 'D:/temp/report.txt'],
    ['file:///tmp/report.txt', 'file:///tmp/report.txt'],
  ])('links the accepted attachment path %s', (path, href) => {
    const wrapper = mount(ChatAttachmentBlock, {
      props: { attachment: attachment({ kind: 'file', name: 'report.txt', path }) },
    });

    expect(wrapper.get('a').attributes('href')).toBe(href);
  });

  it.each([
    '\\\\server\\share\\report.txt',
    '//server/share/report.txt',
    'javascript:alert(1)',
    'https://example.test/report.txt',
    'xfile:///tmp/report.txt',
  ])('does not link an unsafe or non-file attachment path: %s', (path) => {
    const wrapper = mount(ChatAttachmentBlock, {
      props: { attachment: attachment({ kind: 'file', name: 'report.txt', path }) },
    });

    expect(wrapper.element.tagName).toBe('SPAN');
    expect(wrapper.attributes('href')).toBeUndefined();
  });

  it('uses supported attachment URLs only when no accepted path exists', () => {
    const https = mount(ChatAttachmentBlock, {
      props: { attachment: attachment({ kind: 'file', path: '', url: 'https://example.test/report' }) },
    });
    const file = mount(ChatAttachmentBlock, {
      props: { attachment: attachment({ kind: 'file', url: 'file:///tmp/report' }) },
    });
    const http = mount(ChatAttachmentBlock, {
      props: { attachment: attachment({ kind: 'file', url: 'http://example.test/report' }) },
    });
    const prefixed = mount(ChatAttachmentBlock, {
      props: { attachment: attachment({ kind: 'file', url: 'xhttps://example.test/report' }) },
    });

    expect(https.get('a').attributes('href')).toBe('https://example.test/report');
    expect(file.get('a').attributes('href')).toBe('file:///tmp/report');
    expect(http.get('a').attributes('href')).toBe('http://example.test/report');
    expect(prefixed.element.tagName).toBe('SPAN');
  });

  it('leaves unresolved local images as chips when the native bridge is absent', async () => {
    const errors: unknown[] = [];
    const wrapper = mount(ChatAttachmentBlock, {
      global: { config: { errorHandler: (error) => errors.push(error) } },
      props: { attachment: attachment({ path: '/tmp/image.png' }) },
    });

    await flushPromises();
    expect(errors).toStrictEqual([]);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('a').attributes('href')).toBe('/tmp/image.png');
  });

  it('opens the built-in lightbox when the host does not handle an image', async () => {
    const wrapper = mount(ChatAttachmentBlock, {
      attachTo: document.body,
      props: { attachment: attachment({ url: 'https://example.test/image.png' }) },
    });

    expect(document.body.querySelector('.chat-image-lightbox')).toBeNull();
    await wrapper.get('button').trigger('click');
    expect(document.body.querySelector<HTMLImageElement>('.chat-image-lightbox__image')?.src)
      .toBe('https://example.test/image.png');

    document.body.querySelector<HTMLElement>('[aria-label="Close fullscreen"]')?.click();
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.chat-image-lightbox')).toBeNull();
  });

  it('offers the exact attachment payload to the host and honors only true as handled', async () => {
    const openImage = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const wrapper = mount(ChatAttachmentBlock, {
      attachTo: document.body,
      props: {
        attachment: attachment({
          name: 'chart.jpg',
          mimeType: 'image/jpeg',
          path: '/tmp/chart.jpg',
          url: 'https://example.test/chart.jpg',
        }),
        openImage,
      },
    });

    await wrapper.get('button').trigger('click');
    expect(openImage).toHaveBeenLastCalledWith({
      alt: 'chart.jpg',
      kind: 'attachment',
      mimeType: 'image/jpeg',
      name: 'chart.jpg',
      path: '/tmp/chart.jpg',
      src: 'https://example.test/chart.jpg',
      title: 'chart.jpg',
    }, { intent: 'open' });
    expect(document.body.querySelector('.chat-image-lightbox')).toBeNull();

    await wrapper.get('button').trigger('click');
    expect(document.body.querySelector('.chat-image-lightbox')).not.toBeNull();
  });

  it('falls back after an image error and resets when the source changes', async () => {
    const wrapper = mount(ChatAttachmentBlock, {
      props: { attachment: attachment({ url: 'https://example.test/first.png' }) },
    });

    await wrapper.get('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    await wrapper.setProps({ attachment: attachment({ url: 'https://example.test/second.png' }) });
    expect(wrapper.get('img').attributes('src')).toBe('https://example.test/second.png');
  });

  it('reads only unresolved local images through the native bridge', async () => {
    const readImagePreview = vi.fn(async () => 'data:image/png;base64,YQ==');
    Object.defineProperty(window, 'codexAppSdkNative', {
      configurable: true,
      value: { readImagePreview },
    });
    const wrapper = mount(ChatAttachmentBlock, {
      props: { attachment: attachment({ kind: 'file', path: '/tmp/file.txt' }) },
    });

    await flushPromises();
    expect(readImagePreview).not.toHaveBeenCalled();
    await wrapper.setProps({ attachment: attachment({ path: undefined }) });
    await flushPromises();
    expect(readImagePreview).not.toHaveBeenCalled();
    await wrapper.setProps({ attachment: attachment({ path: '/tmp/image.png', url: 'https://example.test/image.png' }) });
    await flushPromises();
    expect(readImagePreview).not.toHaveBeenCalled();
    await wrapper.setProps({ attachment: attachment({ path: '/tmp/image.png', url: undefined }) });
    await flushPromises();
    expect(readImagePreview).toHaveBeenCalledOnce();
    expect(wrapper.get('img').attributes('src')).toBe('data:image/png;base64,YQ==');
  });

  it('ignores stale, failed, empty, and unsafe native preview results', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const readImagePreview = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce('file:///tmp/unsafe.png')
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('missing'));
    Object.defineProperty(window, 'codexAppSdkNative', {
      configurable: true,
      value: { readImagePreview },
    });
    const wrapper = mount(ChatAttachmentBlock, {
      props: { attachment: attachment({ path: '/tmp/first.png' }) },
    });

    await wrapper.setProps({ attachment: attachment({ path: '/tmp/second.png' }) });
    second.resolve('data:image/png;base64,c2Vjb25k');
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('data:image/png;base64,c2Vjb25k');
    first.resolve('data:image/png;base64,Zmlyc3Q=');
    await flushPromises();
    expect(wrapper.get('img').attributes('src')).toBe('data:image/png;base64,c2Vjb25k');

    for (const path of ['/tmp/unsafe.png', '/tmp/empty.png', '/tmp/missing.png']) {
      await wrapper.setProps({ attachment: attachment({ path }) });
      await flushPromises();
      expect(wrapper.find('img').exists()).toBe(false);
    }
  });

  it('invalidates a pending native preview when unmounted', async () => {
    const pending = deferred<string>();
    const readImagePreview = vi.fn(() => pending.promise);
    Object.defineProperty(window, 'codexAppSdkNative', {
      configurable: true,
      value: { readImagePreview },
    });
    const wrapper = mount(ChatAttachmentBlock, {
      props: { attachment: attachment({ path: '/tmp/image.png' }) },
    });

    await flushPromises();
    wrapper.unmount();
    pending.resolve('data:image/png;base64,YQ==');
    await flushPromises();
    expect(readImagePreview).toHaveBeenCalledOnce();
  });
});
