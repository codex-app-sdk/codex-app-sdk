// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatComposerVoiceField from '../../src/chat/ChatComposerVoiceField.vue';

describe('ChatComposerVoiceField', () => {
  it('shows the draft, transcript, and a listening indicator without extra controls', () => {
    const wrapper = mount(ChatComposerVoiceField, {
      props: { recording: true, transcript: { finalText: 'Hello.', partialText: 'Another word' }, before: 'Draft ' },
    });

    expect(wrapper.text()).toBe('Draft Hello.Another word');
    expect(wrapper.get('.chat-composer__audio-partial').text()).toBe('Another word');
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').attributes('aria-label')).toBe('Listening');
  });

  it('uses status text only while there is no draft or recognized speech to display', async () => {
    const wrapper = mount(ChatComposerVoiceField, {
      props: { recording: false, starting: true },
    });

    expect(wrapper.text()).toBe('Starting microphone...');
    await wrapper.setProps({ starting: false });
    expect(wrapper.text()).toBe('Transcribing...');
    for (const [text, expected] of [
      [{ before: 'Existing draft' }, 'Existing draft'],
      [{ after: 'Remaining draft' }, 'Remaining draft'],
      [{ transcript: { finalText: 'Recognized speech', partialText: '' } }, 'Recognized speech'],
      [{ transcript: { finalText: '', partialText: 'Pending words' } }, 'Pending words'],
    ] as const) {
      await wrapper.setProps({ before: '', after: '', transcript: undefined, ...text });
      expect(wrapper.text()).toBe(expected);
      expect(wrapper.find('[role="status"]').exists()).toBe(false);
    }
  });
});
