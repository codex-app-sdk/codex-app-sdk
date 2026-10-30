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

  // Observer delivery and host promises can race source changes or disposal;
  // exercise that boundary here while real geometry is covered in browser tests.
  it('loads near images once, protects visible previews, and ignores stale visibility after disposal', async () => {
    type Observer = { callback: IntersectionObserverCallback; targets: Set<Element>; margin: string; disconnected: boolean }
    const observers: Observer[] = []
    vi.stubGlobal('IntersectionObserver', class {
      state: Observer
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
        this.state = { callback, targets: new Set(), margin: options.rootMargin ?? '', disconnected: false }; observers.push(this.state)
      }
      observe(target: Element) { this.state.targets.add(target) }
      unobserve(target: Element) { this.state.targets.delete(target) }
      disconnect() { this.state.disconnected = true }
    })
    let sequence = 0
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: () => `blob:viewport-${++sequence}`, revokeObjectURL: revoke }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => ({size:64}) })))
    vi.stubGlobal('Image', class {
      naturalWidth = 4; naturalHeight = 4; onload: (() => void) | null = null
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()) }
    })
    const read = vi.fn(async (_reference: string): Promise<string | null> => imageUrl)
    const items = shallowRef<CodexChatMessage[]>(['first','second','third'].map(id => ({id,role:'assistant',content:'',parts:[{type:'media',media:{title:id,url:`/${id}.png`, ...(id === 'first' ? {width:1024,height:512} : id === 'third' ? {width:Number.NaN,height:-1} : {})}}]})))
    const wrapper = mount(defineComponent({setup() {
      provideCodexHostCapabilities({readImagePreview:read} as never, {imagePreviewBudgetBytes:256,viewportImageLoading:true})
      return {items}
    }, components:{CodexMessage:CodexMessage as unknown as Component}, template:'<div style="overflow-y:auto"><CodexMessage v-for="item in items" :key="item.id" :message="item" /></div>'}), {attachTo:document.body})
    const target = (name: string) => wrapper.get(`[aria-label="Open ${name}"]`).element.closest('figure')!
    const deliver = (element: Element, near: boolean, visible: boolean) => {
      for (const observer of observers) if (observer.targets.has(element)) observer.callback([
        {target:element,isIntersecting:observer.margin === '0px' ? visible : near} as IntersectionObserverEntry,
      ], {} as IntersectionObserver)
    }
    await flushPromises()
    expect(read).not.toHaveBeenCalled()
    expect(wrapper.get('[aria-label="Open first"]').attributes('style')).toContain('aspect-ratio: 1024 / 512')
    const first = target('first'), second = target('second'), third = target('third')
    deliver(first,true,true); deliver(second,true,false); await flushPromises()
    expect(wrapper.findAll('img')).toHaveLength(2)
    deliver(third,true,false); await flushPromises()
    expect(wrapper.get('[aria-label="Open first"] img').attributes('src')).toBe('blob:viewport-1')
    expect(wrapper.find('[aria-label="Open second"] img').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Open second"]').attributes('style')).toContain('aspect-ratio: 4 / 4')
    deliver(second,false,false); deliver(third,false,false); deliver(second,true,true); await flushPromises()
    expect(wrapper.get('[aria-label="Open second"] img').attributes('src')).toMatch(/^blob:/)
    const count = read.mock.calls.length
    deliver(second,false,false); deliver(second,true,true); await flushPromises(); expect(read).toHaveBeenCalledTimes(count)
    // With both retained previews visible, a third cannot churn them out.
    deliver(third,true,true); await flushPromises()
    expect(wrapper.findAll('img')).toHaveLength(2)
    expect(wrapper.get('[aria-label="Open first"] img').attributes('src')).toBe('blob:viewport-1')
    items.value = [{id:'portrait',role:'user',content:'',parts:[{type:'attachment',attachment:{kind:'image',name:'Portrait',url:'/portrait.png',width:720,height:1280}}]}]
    await flushPromises()
    expect(wrapper.get('[aria-label="Open Portrait"]').attributes('style')).toContain('aspect-ratio: 720 / 1280')
    deliver(target('Portrait'),true,true); await flushPromises()
    expect(wrapper.get('[aria-label="Open Portrait"] img').attributes('src')).toMatch(/^blob:/)
    expect(wrapper.get('[aria-label="Open Portrait"]').attributes('style')).toContain('aspect-ratio: 720 / 1280')
    // Scrolling away before a queued request starts must avoid the host read.
    const releases: Array<(value: string) => void> = []
    read.mockImplementationOnce(() => new Promise(resolve => releases.push(resolve))).mockImplementationOnce(() => new Promise(resolve => releases.push(resolve)))
    items.value = ['queue-a','queue-b','queue-c','queue-d','queue-e'].map(id => ({id,role:'assistant',content:'',parts:[{type:'media',media:{title:id,url:`/${id}.png`}}]}))
    await flushPromises()
    for (const name of ['queue-a','queue-b','queue-c','queue-d','queue-e']) deliver(target(name),true,name === 'queue-e')
    await flushPromises(); expect(releases).toHaveLength(2)
    deliver(target('queue-c'),false,false)
    for (const finish of releases) finish(imageUrl)
    await flushPromises()
    expect(read.mock.calls.some(([reference]) => reference === '/queue-c.png')).toBe(false)
    expect(read.mock.calls.findIndex(([r]) => r === '/queue-e.png')).toBeLessThan(read.mock.calls.findIndex(([r]) => r === '/queue-d.png'))
    read.mockResolvedValue(imageUrl)
    // A stalled native thumbnail encoder must release the two loading slots;
    // callbacks arriving after disposal must not allocate orphaned blob URLs.
    const encoders: BlobCallback[] = []
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as never)
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => { encoders.push(callback) })
    vi.useFakeTimers()
    try {
      items.value = ['encode-a','encode-b','encode-c','encode-d','encode-e'].map(id => ({id,role:'assistant',content:'',parts:[{type:'media',media:{title:id,url:`/${id}.png`}}]}))
      await flushPromises()
      for (const name of ['encode-a','encode-b','encode-c','encode-d','encode-e']) { Object.defineProperty(target(name),'clientWidth',{value:1}); deliver(target(name),true,false) }
      await flushPromises(); expect(encoders).toHaveLength(2)
      encoders[0]!(new Blob(['thumbnail'])); encoders[1]!(null)
      await flushPromises(); expect(encoders).toHaveLength(4)
      await vi.advanceTimersByTimeAsync(15_001); await flushPromises()
      expect(encoders).toHaveLength(5)
      await vi.advanceTimersByTimeAsync(15_001); await flushPromises()
      items.value = []; await flushPromises()
      const allocations = sequence
      for (const callback of encoders) callback(new Blob(['original']))
      await flushPromises(); expect(sequence).toBe(allocations)
    } finally { vi.useRealTimers(); context.mockRestore(); encode.mockRestore() }
    // A host may scroll the document rather than a dedicated chat container.
    ;(wrapper.element as HTMLElement).style.overflowY = ''
    let finish!: (value: string) => void
    read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    items.value = [{id:'slow',role:'assistant',content:'',parts:[{type:'media',media:{title:'slow',url:'/slow.png'}}]}]
    await flushPromises(); deliver(target('slow'),true,true); await flushPromises()
    const old = observers.flatMap(o => [...o.targets].map(element => ({o,element})))
    wrapper.unmount(); finish(imageUrl); await flushPromises()
    for (const {o,element} of old) o.callback([{target:element,isIntersecting:true} as IntersectionObserverEntry], {} as IntersectionObserver)
    await flushPromises()
    expect(observers.every(o => o.disconnected)).toBe(true)
    expect(revoke).toHaveBeenCalledTimes(sequence)
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
