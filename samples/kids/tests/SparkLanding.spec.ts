import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SparkLanding from '../src/renderer/components/SparkLanding.vue';

describe('SparkLanding', () => {
  it('offers a clear grown-up-assisted sign-in action', async () => {
    const wrapper = mount(SparkLanding);

    expect(wrapper.get('h1').text()).toBe('Welcome to Spark!');
    expect(wrapper.text()).toContain('Ask a grown-up to help you sign in.');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('signIn')).toStrictEqual([[]]);
  });

  it('shows progress and a friendly error without allowing duplicate sign-in', () => {
    const wrapper = mount(SparkLanding, {
      props: { busy: true, error: 'We could not finish signing in. Please try again.' },
    });

    expect(wrapper.get('button').text()).toContain('Opening sign in…');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[role="alert"]').text()).toContain('Please try again.');
  });
});
