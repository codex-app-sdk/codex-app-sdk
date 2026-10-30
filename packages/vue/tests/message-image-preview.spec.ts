// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, shallowRef, type Component } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CodexConversationPane,
  provideCodexHostCapabilities,
  CodexMessage,
  createCodexConversationPaneController,
  type CodexChatMessage,
} from '../src'

const imageUrl = 'data:image/png;base64,cG5n'
const messages: CodexChatMessage[] = [
  {
    content: 'Review this image',
    id: 'user-image',
    parts: [{
      type: 'attachment',
      attachment: {
        kind: 'image',
        mimeType: 'image/png',
        name: 'screenshot.png',
        path: '/tmp/screenshot.png',
        url: imageUrl,
      },
    }],
    role: 'user',
  },
  {
    content: 'Generated a result',
    id: 'assistant-image',
    parts: [{
      type: 'media',
      media: { alt: 'Generated result', mimeType: 'image/png', title: 'Result', url: imageUrl },
    }],
    role: 'assistant',
  },
]

describe('conversation message image previews', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.querySelectorAll('.chat-image-lightbox').forEach((element) => element.remove())
  })

  it('resolves local Markdown and generated-media images through the host capability before display', async () => {
    const readImagePreview = vi.fn(async (_reference: string) => imageUrl)
    vi.stubGlobal('codexAppSdkNative', { readImagePreview, capabilities: { attachments: false, clipboard: false, externalLinks: false, transcription: false } })
    const wrapper = mount(CodexConversationPane, { props: { messages: [{ id: 'local-images', role: 'assistant', content: '', parts: [
      { type: 'text', content: 'Here is ![Screenshot](/tmp/screenshot.png).' },
      { type: 'media', media: { title: 'Generated', url: 'file:///tmp/generated.png' } },
    ] }] } })
    await flushPromises()
    expect(readImagePreview.mock.calls.map(([reference]) => reference).sort()).toStrictEqual(['/tmp/screenshot.png', 'file:///tmp/generated.png'])
    expect(wrapper.findAll('img').map(image => image.attributes('src'))).toStrictEqual([imageUrl, imageUrl])
    wrapper.unmount()
  })

  it('discards image resolutions after the displayed message changes or unmounts', async () => {
    const pending: ((value: string) => void)[] = []
    const readImagePreview = vi.fn((_reference: string) => new Promise<string>(resolve => pending.push(resolve)))
    vi.stubGlobal('codexAppSdkNative', { readImagePreview, capabilities: { attachments: false, clipboard: false, externalLinks: false, transcription: false } })
    const message = (name: string): CodexChatMessage => ({ id: 'changing', role: 'assistant', content: '', parts: [
      { type: 'text', content: `See ![Preview](/tmp/${name}.png) here.` },
      { type: 'media', media: { title: 'Media', url: `/tmp/${name}.png` } },
    ] })
    const wrapper = mount(CodexConversationPane, { props: { messages: [message('old')] } })
    await flushPromises()
    await wrapper.setProps({ messages: [message('new')] })
    await flushPromises()
    pending.slice(0, 2).forEach(resolve => resolve(imageUrl))
    await flushPromises()
    expect(wrapper.get('button[aria-label="Open Preview"] img').attributes('src')).toBeUndefined()
    expect(wrapper.get('button[aria-label="Open Media"] img').attributes('src')).toBeUndefined()
    const detachedImage = wrapper.get('button[aria-label="Open Preview"] img').element
    wrapper.unmount()
    pending.slice(2).forEach(resolve => resolve(imageUrl))
    await flushPromises()
    expect(detachedImage.getAttribute('src')).toBeNull()
  })

  it.each(['failed', 'missing', 'unsafe'] as const)('keeps %s host previews out of the rendered media and lets opening fall back to the host', async outcome => {
    const readImagePreview = vi.fn(async () => {
      if (outcome === 'failed') throw new Error('Laptop disconnected')
      return outcome === 'missing' ? null : 'file:///private/unsafe.png'
    })
    const openImage = vi.fn(() => true)
    vi.stubGlobal('codexAppSdkNative', { readImagePreview, capabilities: { attachments: false, clipboard: false, externalLinks: false, transcription: false } })
    const wrapper = mount(CodexConversationPane, { props: { openImage, messages: [{ id: 'unavailable', role: 'assistant', content: '', parts: [
      { type: 'text', content: 'See ![Missing](/tmp/missing.png) here.' },
      { type: 'media', media: { title: 'Unavailable', url: '/tmp/missing.png' } },
    ] }] } })
    await flushPromises()
    expect(wrapper.findAll('img').map(image => image.attributes('src'))).toStrictEqual([undefined, undefined])
    await wrapper.get('[aria-label="Open Unavailable"]').trigger('click')
    expect(openImage).toHaveBeenCalledWith(expect.objectContaining({ src: '/tmp/missing.png' }), expect.objectContaining({ intent: 'open' }))
    wrapper.unmount()
  })

  // Browser decoding is covered by the native WebKit/Chromium workflow. This
  // mounted workflow protects shared leases, cancellation, and oversized fallback.
  it('shares bounded previews, releases their last consumer, and keeps full images accessible', async () => {
    const revoked = vi.fn()
    let nextUrl = 0
    vi.stubGlobal('URL', Object.assign(class extends URL {}, {
      createObjectURL: () => `blob:preview-${++nextUrl}`, revokeObjectURL: revoked,
    }))
    let blobSize = 64
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => ({ size: blobSize }) })))
    let pixels = 16
    vi.stubGlobal('Image', class {
      naturalWidth = 1; get naturalHeight() { return pixels }
      onload: (() => void) | null = null; onerror: (() => void) | null = null
      set src(value: string) { if (value) queueMicrotask(() => pixels < 0 ? this.onerror?.() : this.onload?.()) }
    })
    let release!: (value: string) => void
    const read = vi.fn(async (_reference: string): Promise<string | null> => imageUrl)
    const openImage = vi.fn(() => true)
    const items = shallowRef<CodexChatMessage[]>([])
    const media = (id: string, url = '/tmp/shared.png'): CodexChatMessage => ({ id, role: 'assistant', content: '', parts: [{ type: 'media', media: { title: id, url } }] })
    const wrapper = mount(defineComponent({ components: { CodexConversationPane: CodexConversationPane as unknown as Component }, setup() {
      provideCodexHostCapabilities({ readImagePreview: read, capabilities: { attachments: false, clipboard: false, externalLinks: false, transcription: false },
        copyToClipboard: async () => {}, ingestAttachments: async () => [], pickAttachments: async () => [], openExternal: async () => {}, transcribeAudio: async () => { throw new Error('Unavailable') },
      }, { imagePreviewBudgetBytes: 256 })
      return { items, openImage }
    }, template: '<CodexConversationPane :messages="items" :open-image="openImage" />' }))
    try {
      items.value = [media('first'), media('second')]; await flushPromises()
      expect(read).toHaveBeenCalledOnce()
      expect(wrapper.findAll('img').map(img => img.attributes('src'))).toStrictEqual(['blob:preview-1', 'blob:preview-1'])
      items.value = [media('second')]; await flushPromises(); expect(revoked).not.toHaveBeenCalled()
      items.value = [media('second'), media('third', '/tmp/third.png'), media('fourth', '/tmp/fourth.png')]; await flushPromises()
      expect(wrapper.get('[aria-label="Open second"]').text()).toContain('Load image')
      await wrapper.get('[aria-label="Open second"]').trigger('click'); await flushPromises()
      expect(wrapper.get('[aria-label="Open second"] img').attributes('src')).toMatch(/^blob:/)
      pixels = 1000
      items.value = [media('large', '/tmp/large.png')]; await flushPromises()
      expect(wrapper.findAll('img')).toHaveLength(0)
      await wrapper.get('[aria-label="Open large"]').trigger('click'); await flushPromises()
      expect(openImage).toHaveBeenCalledWith(expect.objectContaining({ src: '/tmp/large.png' }), expect.anything())
      pixels = 16
      read.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
      items.value = [media('pending', '/tmp/pending.png')]; await flushPromises()
      items.value = []; await flushPromises()
      const count = nextUrl; release(imageUrl); await flushPromises()
      expect(nextUrl).toBe(count)
      for (const result of [null, 'file:///unsafe.png', 'data:image/png;base64,' + 'A'.repeat(24 * 1024 * 1024)]) {
        read.mockResolvedValueOnce(result)
        items.value = [media('unavailable', `/tmp/${nextUrl}-${String(result).length}.png`)]; await flushPromises()
        expect(wrapper.findAll('img')).toHaveLength(0)
      }
      read.mockRejectedValueOnce(new Error('Disconnected'))
      items.value = [media('offline', '/tmp/offline.png')]; await flushPromises()
      expect(wrapper.get('[aria-label="Open offline"]').text()).toContain('Load image')
      pixels = -1
      items.value = [media('corrupt', '/tmp/corrupt.png')]; await flushPromises()
      expect(wrapper.findAll('img')).toHaveLength(0)
      pixels = 16; blobSize = 512
      items.value = [media('encoded-overflow', '/tmp/encoded.png')]; await flushPromises()
      expect(wrapper.findAll('img')).toHaveLength(0)
      blobSize = 64
      items.value = [media('remote', 'https://example.com/image.png')]; await flushPromises()
      expect(wrapper.get('img').attributes('src')).toBe('https://example.com/image.png')
      items.value = [{id:'attachment',role:'user',content:'',parts:[{type:'attachment',attachment:{kind:'image',name:'Photo.png',path:'/tmp/photo.png'}}]}]; await flushPromises()
      expect(wrapper.get('[aria-label="Open Photo.png"] img').attributes('src')).toMatch(/^blob:/)
      await wrapper.get('[aria-label="Open Photo.png"]').trigger('click'); await flushPromises()
      expect(openImage).toHaveBeenLastCalledWith(expect.objectContaining({kind:'attachment'}), expect.anything())
      pixels = 1000
      items.value = [{id:'attachment',role:'user',content:'',parts:[{type:'attachment',attachment:{kind:'image',name:'Large.png',path:'/tmp/large-photo.png'}}]}]; await flushPromises()
      await wrapper.get('[aria-label="Load Large.png"]').trigger('click'); await flushPromises()
      expect(openImage).toHaveBeenLastCalledWith(expect.objectContaining({src:'/tmp/large-photo.png'}), expect.anything())
      pixels = 16
      items.value = [media('final')]; await flushPromises()
    } finally { wrapper.unmount() }
    expect(revoked.mock.calls.map(([url]) => url).sort()).toStrictEqual(Array.from({ length: nextUrl }, (_, i) => `blob:preview-${i + 1}`).sort())
  })

  it('opens user attachments and assistant media in the SDK lightbox by default', async () => {
    const wrapper = mount(CodexConversationPane, { props: { messages } })

    await wrapper.get('[aria-label="Open screenshot.png"]').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.chat-image-lightbox__image')?.getAttribute('src')).toBe(imageUrl)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('.chat-image-lightbox')).toBeNull()

    await wrapper.get('.chat-media-block__actions [aria-label="Open fullscreen"]').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.chat-image-lightbox__image')?.getAttribute('alt')).toBe('Generated result')
  })

  it('lets generated-media downloads bypass conversation link interception', () => {
    const wrapper = mount(CodexConversationPane, { props: { messages } })
    const download = wrapper.get('.chat-media-block__actions [aria-label="Download media"]')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    const preventTestNavigation = vi.fn((clickEvent: Event) => clickEvent.preventDefault())
    download.element.addEventListener('click', preventTestNavigation)

    download.element.dispatchEvent(event)

    expect(preventTestNavigation).toHaveBeenCalledOnce()
    expect(download.attributes()).toMatchObject({
      download: 'Result.png',
      href: imageUrl,
    })
    expect(wrapper.emitted('openLink')).toBeUndefined()
  })

  it('keeps the SDK lightbox active when CodexMessage is mounted without an image handler', async () => {
    const wrapper = mount(CodexMessage, { props: { message: messages[0]! } })

    await wrapper.get('[aria-label="Open screenshot.png"]').trigger('click')
    await flushPromises()

    expect(document.body.querySelector('.chat-image-lightbox__image')?.getAttribute('src')).toBe(imageUrl)
  })

  it('lets a controller action own image opening with message context', async () => {
    const openImage = vi.fn()
    const controller = createCodexConversationPaneController({
      actions: { openImage },
      state: { identity: { messages } },
    })
    const wrapper = mount(CodexConversationPane, { props: { controller } })

    await wrapper.get('[aria-label="Open screenshot.png"]').trigger('click')
    await flushPromises()

    expect(openImage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'attachment',
        name: 'screenshot.png',
        path: '/tmp/screenshot.png',
        src: imageUrl,
      }),
      expect.objectContaining({
        index: 0,
        intent: 'open',
        message: expect.objectContaining({ id: 'user-image' }),
      }),
    )

    await wrapper.get('.chat-media-block__image-button').trigger('click')
    await flushPromises()
    expect(openImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'media', src: imageUrl, title: 'Result' }),
      expect.objectContaining({
        index: 1,
        intent: 'open',
        message: expect.objectContaining({ id: 'assistant-image' }),
      }),
    )

    await wrapper.get('.chat-media-block__actions [aria-label="Open fullscreen"]').trigger('click')
    await flushPromises()
    expect(openImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'media', src: imageUrl, title: 'Result' }),
      expect.objectContaining({
        index: 1,
        intent: 'fullscreen',
        message: expect.objectContaining({ id: 'assistant-image' }),
      }),
    )
    expect(document.body.querySelector('.chat-image-lightbox')).toBeNull()
  })

  it('uses the SDK lightbox when an override explicitly returns false', async () => {
    const openImage = vi.fn(() => false)
    const wrapper = mount(CodexConversationPane, { props: { messages, openImage } })

    await wrapper.get('.chat-media-block__image-button').trigger('click')
    await flushPromises()

    expect(openImage).toHaveBeenCalledOnce()
    expect(document.body.querySelector('.chat-image-lightbox')).not.toBeNull()
  })

  it('surfaces image-handler failures without also opening the fallback lightbox', async () => {
    const openImage = vi.fn(async () => {
      throw new Error('Image host failed')
    })
    const wrapper = mount(CodexConversationPane, { props: { messages, openImage } })

    await wrapper.get('.chat-media-block__image-button').trigger('click')
    await flushPromises()

    expect(openImage).toHaveBeenCalledOnce()
    expect(wrapper.get('[role="alert"]').text()).toBe('Image host failed')
    expect(document.body.querySelector('.chat-image-lightbox')).toBeNull()
  })

  it('does not invoke the compatibility image handler in controller mode', async () => {
    const legacyOpenImage = vi.fn(() => true)
    const controller = createCodexConversationPaneController({
      actions: {},
      state: { identity: { messages } },
    })
    const wrapper = mount(CodexConversationPane, {
      props: { controller, openImage: legacyOpenImage },
    })

    await wrapper.get('[aria-label="Open screenshot.png"]').trigger('click')
    await flushPromises()

    expect(legacyOpenImage).not.toHaveBeenCalled()
    expect(document.body.querySelector('.chat-image-lightbox')).not.toBeNull()
  })
})
