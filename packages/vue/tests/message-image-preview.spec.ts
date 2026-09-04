// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CodexConversationPane,
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
    document.body.querySelectorAll('.chat-image-lightbox').forEach((element) => element.remove())
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
