// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatComposerVoiceButton from '../../src/chat/ChatComposerVoiceButton.vue';

describe('ChatComposerVoiceButton', () => {
  it('renders its recording interface and emits toggles', async () => {
    const wrapper = mount(ChatComposerVoiceButton, {
      props: {
        disabled: false,
        label: 'Stop recording',
        recording: true,
        title: 'Stop recording',
      },
      slots: { recording: '<span>Listening</span>' },
    });

    expect(wrapper.attributes('aria-label')).toBe('Stop recording');
    expect(wrapper.attributes('aria-pressed')).toBe('true');
    expect(wrapper.classes()).toContain('chat-composer__voice--recording');
    await wrapper.trigger('click');
    expect(wrapper.emitted('toggle')).toStrictEqual([[]]);
    await wrapper.trigger('pointerenter', { pointerType: 'touch' });
    expect(wrapper.text()).toBe('Listening');
    await wrapper.trigger('pointerenter', { pointerType: 'mouse' });
    expect(wrapper.text()).toBe('');
    expect(wrapper.find('svg.tabler-icon-microphone-off').exists()).toBe(true);
    await wrapper.trigger('pointerleave');
    expect(wrapper.text()).toBe('Listening');
    await wrapper.trigger('pointerenter', { pointerType: 'mouse' });
    await wrapper.setProps({ recording: false });
    await wrapper.setProps({ recording: true });
    expect(wrapper.text()).toBe('Listening');
  });

  it('forwards disabled state and keeps the default composer recording control', async () => {
    const wrapper = mount(ChatComposerVoiceButton, {
      props: {
        disabled: true,
        label: 'Record voice prompt',
        recording: false,
        title: 'Audio recording is not available.',
      },
    });

    expect(wrapper.attributes('disabled')).toBeDefined();
    expect(wrapper.attributes('title')).toBe('Audio recording is not available.');
    await wrapper.setProps({ disabled: false, recording: true });
    expect(wrapper.find('svg.tabler-icon-microphone').exists()).toBe(true);
    await wrapper.trigger('pointerenter', { pointerType: 'mouse' });
    expect(wrapper.find('svg.tabler-icon-microphone-off').exists()).toBe(true);
    await wrapper.trigger('pointerleave');
    expect(wrapper.find('svg.tabler-icon-microphone').exists()).toBe(true);
  });
});
