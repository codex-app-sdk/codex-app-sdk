// @vitest-environment jsdom

import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatHtmlBlock from '../../src/chat/ChatHtmlBlock.vue';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// JSDOM cannot run the sandbox. Use real message ports to exercise the parent's
// asynchronous lifecycle; rendering, script execution and isolation are owned
// by the Chromium lab regression instead.
function connect(frame: HTMLIFrameElement) {
  let port: MessagePort | undefined;
  const packets: unknown[] = [];
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((_message, options) => {
    port = (options!.transfer as unknown as MessagePort[])[0];
    port!.on('message', packet => packets.push(packet));
  });
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: 'codex-html-ready' }));
  return packets;
}

describe('HTML preview lifecycle', () => {
  it('delivers the latest source after a delayed handshake and resets rewritten documents', async () => {
    vi.stubGlobal('MessageChannel', MessageChannel);
    const wrapper = mount(ChatHtmlBlock, { attachTo: document.body, props: { source: '<p>Old', title: 'Example', complete: false } });
    const frame = wrapper.get('iframe').element;
    // Unrelated frames must not initialize this preview's channel.
    window.dispatchEvent(new MessageEvent('message', { source: window, data: 'codex-html-ready' }));
    await wrapper.setProps({ source: '<p>Latest</p>', complete: true });
    const child = connect(frame);
    await vi.waitFor(() => expect(child).toEqual([{ chunk: '<p>Latest</p>', complete: true }]));
    await wrapper.setProps({ title: 'Renamed example' });
    expect(wrapper.get('iframe').attributes('title')).toBe('Renamed example');
    expect(wrapper.get('iframe').element).toBe(frame);

    await wrapper.setProps({ source: '<p>Replacement</p>' });
    expect(wrapper.get('iframe').element).not.toBe(frame);
    const replacement = connect(wrapper.get('iframe').element);
    await vi.waitFor(() => expect(replacement).toEqual([{ chunk: '<p>Replacement</p>', complete: true }]));
    // Appending after a completed document also needs a fresh parser.
    const completedFrame = wrapper.get('iframe').element;
    await wrapper.setProps({ source: '<p>Replacement</p><p>More</p>' });
    expect(wrapper.get('iframe').element).not.toBe(completedFrame);
    wrapper.unmount();
  });

  it('copies current source rather than the sandbox wrapper and cleans up downloads', async () => {
    const clipboard = { writeText: vi.fn(async () => undefined) };
    vi.stubGlobal('navigator', { clipboard });
    const create = vi.fn(() => 'blob:html-download');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const wrapper = mount(ChatHtmlBlock, { props: { source: '<button>Hi</button>', complete: false } });
    await wrapper.get('[aria-label="Show HTML source"]').trigger('click');
    expect(wrapper.get('pre').text()).toBe('<button>Hi</button>');
    await wrapper.get('[aria-label="Show HTML preview"]').trigger('click');
    await wrapper.setProps({ source: '<button>Updated</button>', complete: true });
    await wrapper.get('[aria-label="Copy code"]').trigger('click');
    expect(clipboard.writeText).toHaveBeenCalledWith('<button>Updated</button>');
    expect(wrapper.find('[aria-label="Code copied"]').exists()).toBe(true);
    await wrapper.get('[aria-label="Download HTML"]').trigger('click');
    expect(create.mock.calls).toHaveLength(1);
    wrapper.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:html-download');
  });
});
