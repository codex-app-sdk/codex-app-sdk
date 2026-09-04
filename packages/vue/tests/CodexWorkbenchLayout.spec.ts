// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CodexWorkbenchLayout from '../src/components/CodexWorkbenchLayout.vue';

describe('CodexWorkbenchLayout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('composes independently scrolling content with measured chrome slots', () => {
    const wrapper = mount(CodexWorkbenchLayout, {
      props: { scrollMode: 'child' },
      slots: {
        default: '<main class="content">Transcript</main>',
        footer: '<footer class="footer">Composer</footer>',
        header: '<header class="header">Context</header>',
      },
    });

    expect(wrapper.classes()).toContain('codex-chat-theme');
    expect(wrapper.classes()).toContain('codex-workbench-layout--child');
    expect(wrapper.get('.content').text()).toBe('Transcript');
    expect(wrapper.get('.header').text()).toBe('Context');
    expect(wrapper.get('.footer').text()).toBe('Composer');
    expect(wrapper.attributes('style')).toContain('--workbench-layout-footer-offset: 0px');
  });

  it('measures and observes optional chrome in the default body-scroll layout', async () => {
    const observed: Element[] = [];
    const disconnect = vi.fn();
    let observer: TestResizeObserver | undefined;
    class TestResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {
        observer = this;
      }
      disconnect = disconnect;
      observe = vi.fn((element: Element) => observed.push(element));
      unobserve = vi.fn();
      trigger(): void {
        this.callback([], this as unknown as ResizeObserver);
      }
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);

    const wrapper = mount(CodexWorkbenchLayout, {
      slots: {
        default: '<main class="content">Transcript</main>',
        footer: '<footer>Composer</footer>',
        header: '<header>Context</header>',
      },
    });

    Object.defineProperty(wrapper.get('.codex-workbench-layout__header').element, 'offsetHeight', { value: 24 });
    Object.defineProperty(wrapper.get('.codex-workbench-layout__footer').element, 'offsetHeight', { value: 48 });
    observer?.trigger();
    await nextTick();

    expect(wrapper.classes()).toContain('codex-workbench-layout--body');
    expect(wrapper.find('.codex-workbench-layout__body--scroll').exists()).toBe(true);
    expect(wrapper.attributes('style')).toContain('--workbench-layout-header-offset: 24px');
    expect(wrapper.attributes('style')).toContain('--workbench-layout-footer-offset: 48px');
    expect(observed.map((element) => element.className)).toStrictEqual([
      'codex-workbench-layout__header',
      'codex-workbench-layout__footer',
    ]);

    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('supports body scrolling without optional header or footer chrome', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(_callback: ResizeObserverCallback) {}
      disconnect = disconnect;
      observe = observe;
      unobserve = vi.fn();
    });

    const wrapper = mount(CodexWorkbenchLayout, {
      slots: { default: '<main>Transcript</main>' },
    });

    expect(wrapper.find('.codex-workbench-layout__header').exists()).toBe(false);
    expect(wrapper.find('.codex-workbench-layout__footer').exists()).toBe(false);
    expect(wrapper.attributes('style')).toContain('--workbench-layout-header-offset: 0px');
    expect(wrapper.attributes('style')).toContain('--workbench-layout-footer-offset: 0px');
    expect(observe).not.toHaveBeenCalled();

    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('measures chrome immediately and unmounts without ResizeObserver support', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height(this: HTMLElement) {
      if (this.classList.contains('codex-workbench-layout__header')) return 18;
      if (this.classList.contains('codex-workbench-layout__footer')) return 36;
      return 0;
    });
    const errors: unknown[] = [];
    const wrapper = mount(CodexWorkbenchLayout, {
      global: { config: { errorHandler: (error) => errors.push(error) } },
      slots: {
        default: '<main>Transcript</main>',
        footer: '<footer>Composer</footer>',
        header: '<header>Context</header>',
      },
    });

    await nextTick();
    expect(wrapper.attributes('style')).toContain('--workbench-layout-header-offset: 18px');
    expect(wrapper.attributes('style')).toContain('--workbench-layout-footer-offset: 36px');
    wrapper.unmount();
    expect(errors).toStrictEqual([]);
  });
});
