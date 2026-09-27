// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexConversationPane } from '../src'
import { useConversationEscapeInterrupt } from '../src/chat/use-conversation-escape-interrupt'

describe('conversation Escape interruption', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('arms on the first document Escape and interrupts on the second', async () => {
    const wrapper = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })

    const first = pressEscape()
    await wrapper.vm.$nextTick()
    expect(first.defaultPrevented).toBe(true)
    expect(wrapper.get('.chat-composer__send').classes())
      .toContain('codex-composer-send-button--interrupt-armed')
    expect(wrapper.emitted('interrupt')).toBeUndefined()

    const second = pressEscape()
    await wrapper.vm.$nextTick()
    expect(second.defaultPrevented).toBe(true)
    expect(wrapper.emitted('interrupt')).toStrictEqual([[]])
    expect(wrapper.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')
    wrapper.unmount()
  })

  it('clears the armed state after two seconds', async () => {
    vi.useFakeTimers()
    const wrapper = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })

    pressEscape()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(wrapper.get('.chat-composer__send').classes())
      .toContain('codex-composer-send-button--interrupt-armed')
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')
    wrapper.unmount()
  })

  it('lets the armed stop button interrupt while preserving a queued draft', async () => {
    const wrapper = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [], modelValue: 'queue this next' },
    })

    pressEscape()
    await wrapper.vm.$nextTick()
    await wrapper.get('.chat-composer__send').trigger('click')

    expect(wrapper.emitted('interrupt')).toStrictEqual([[]])
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not steal handled Escape events, modal Escape, or ambiguous multi-pane Escape', async () => {
    const first = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })

    const handled = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
    handled.preventDefault()
    document.dispatchEvent(handled)
    await first.vm.$nextTick()
    expect(first.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')

    const dialog = document.createElement('div')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('role', 'dialog')
    const dialogButton = document.createElement('button')
    dialog.append(dialogButton)
    document.body.append(dialog)
    dialogButton.focus()
    pressEscape(dialogButton)
    await first.vm.$nextTick()
    expect(first.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')
    dialog.remove()

    const second = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })
    pressEscape()
    await first.vm.$nextTick()
    expect(first.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')
    expect(second.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')

    ;(first.get('[role="textbox"]').element as HTMLElement).focus()
    pressEscape()
    await first.vm.$nextTick()
    expect(first.get('.chat-composer__send').classes())
      .toContain('codex-composer-send-button--interrupt-armed')
    expect(second.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')
    first.unmount()
    second.unmount()
  })

  it('can disable the document-wide Escape shortcut', async () => {
    const wrapper = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, escapeInterrupt: false, messages: [] },
    })

    const event = pressEscape()
    await wrapper.vm.$nextTick()
    expect(event.defaultPrevented).toBe(false)
    expect(wrapper.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')
    wrapper.unmount()
  })

  it('installs, clears, and removes the shortcut as reactive eligibility changes', async () => {
    vi.useFakeTimers()
    const wrapper = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })

    pressEscape()
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.chat-composer__send').classes())
      .toContain('codex-composer-send-button--interrupt-armed')

    await wrapper.setProps({ busy: false })
    expect(wrapper.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')
    expect(pressEscape().defaultPrevented).toBe(false)

    await wrapper.setProps({ busy: true })
    expect(pressEscape().defaultPrevented).toBe(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.chat-composer__send').classes())
      .toContain('codex-composer-send-button--interrupt-armed')

    await wrapper.setProps({ escapeInterrupt: false })
    expect(wrapper.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')
    expect(pressEscape().defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('ignores non-Escape, repeated, composing, and modified key events', async () => {
    const wrapper = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })
    const cases: KeyboardEventInit[] = [
      { key: 'Enter' },
      { key: 'Escape', repeat: true },
      { isComposing: true, key: 'Escape' },
      { altKey: true, key: 'Escape' },
      { ctrlKey: true, key: 'Escape' },
      { metaKey: true, key: 'Escape' },
      { shiftKey: true, key: 'Escape' },
    ]

    for (const init of cases) {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      document.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')
    wrapper.unmount()
  })

  it('routes an ambiguous Escape only to the pane that owns focus', async () => {
    const first = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })
    const second = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })

    ;(second.get('[role="textbox"]').element as HTMLElement).focus()
    pressEscape()
    await second.vm.$nextTick()

    expect(first.get('.chat-composer__send').classes())
      .not.toContain('codex-composer-send-button--interrupt-armed')
    expect(second.get('.chat-composer__send').classes())
      .toContain('codex-composer-send-button--interrupt-armed')
    first.unmount()
    second.unmount()
  })

  it('ignores an Escape listener whose pane root is detached', async () => {
    const detached = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })
    detached.element.remove()
    const active = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })

    ;(active.get('[role="textbox"]').element as HTMLElement).focus()
    const event = pressEscape()
    await active.vm.$nextTick()

    expect(event.defaultPrevented).toBe(true)
    expect(active.get('.chat-composer__send').classes())
      .toContain('codex-composer-send-button--interrupt-armed')
    detached.unmount()
    active.unmount()
  })

  it('cancels armed timeout and document listener during unmount', () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
    const removeEventListener = vi.spyOn(document, 'removeEventListener')
    const wrapper = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })

    pressEscape()
    wrapper.unmount()

    expect(clearTimeoutSpy).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
    clearTimeoutSpy.mockRestore()
    removeEventListener.mockRestore()
  })

  it('clears its own public armed state before invoking an interrupt callback', async () => {
    const onInterrupt = vi.fn()
    const Harness = defineComponent({
      setup() {
        const root = ref<HTMLElement | null>(null)
        const { armed } = useConversationEscapeInterrupt({
          root,
          busy: () => true,
          enabled: () => true,
          onInterrupt,
        })
        return () => h('div', {
          ref: root,
          'data-armed': String(armed.value),
          'data-codex-generating': 'true',
        })
      },
    })
    const wrapper = mount(Harness, { attachTo: document.body })

    pressEscape()
    await wrapper.vm.$nextTick()
    expect(wrapper.attributes('data-armed')).toBe('true')
    pressEscape()
    await wrapper.vm.$nextTick()

    expect(onInterrupt).toHaveBeenCalledOnce()
    expect(wrapper.attributes('data-armed')).toBe('false')
    wrapper.unmount()
  })

  it('does not let an unfocused hidden modal suppress the shortcut', async () => {
    const dialog = document.createElement('div')
    dialog.hidden = true
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    const wrapper = mount(CodexConversationPane, {
      attachTo: document.body,
      props: { busy: true, messages: [] },
    })

    pressEscape()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.chat-composer__send').classes())
      .toContain('codex-composer-send-button--interrupt-armed')
    wrapper.unmount()
  })
})

function pressEscape(target: EventTarget = document): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Escape',
  })
  target.dispatchEvent(event)
  return event
}
