import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import RelaySignIn from '../src/renderer/components/RelaySignIn.vue';

describe('RelaySignIn', () => {
  it('explains the product and emits the managed ChatGPT sign-in action', async () => {
    const wrapper = mount(RelaySignIn);

    expect(wrapper.text()).toContain('Run the shift with Relay');
    expect(wrapper.text()).toContain('one continuous operations conversation');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('sign-in')).toStrictEqual([[]]);
  });

  it('renders busy and failure state without hiding the product context', () => {
    const wrapper = mount(RelaySignIn, {
      props: { busy: true, error: 'Sign in failed' },
    });

    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button').text()).toContain('Opening ChatGPT');
    expect(wrapper.get('[role="alert"]').text()).toBe('Sign in failed');
  });
});
