// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.vue';

describe('component lab', () => {
  afterEach(() => vi.useRealTimers());
  it('renders a dense multi-turn fixture with mentions, attachments, tools, and steering', () => {
    const wrapper = mount(App);
    expect(wrapper.text()).toContain('Component lab');
    expect(wrapper.text()).toContain('Multi-turn conversation');
    expect(wrapper.find('.chat-user-text__mention--skill').text()).toContain('Commit-Push');
    expect(wrapper.find('.chat-user-text__mention--plugin').text()).toContain('Gmail');
    expect(wrapper.get('.chat-attachment-block__preview').attributes('alt')).toBe('composer-broken.png');
    expect(wrapper.text()).toContain('layout-notes.md');
    const toolHeader = wrapper.get('.chat-tool-group__header');
    expect(toolHeader.text()).toContain('3 actions done');
    expect(toolHeader.get('.chat-animated-diff-stat--added').text()).toBe('+128');
    expect(toolHeader.get('.chat-animated-diff-stat--deleted').text()).toBe('-96');
    const steer = wrapper.get('.chat-message:has(.chat-message--steer)');
    expect(steer.text()).toContain('Steered conversation');
    expect(steer.find('.chat-message__actions').exists()).toBe(false);
  });

  it('submits multiline prompts without a backend', async () => {
    const wrapper = mount(App);
    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = 'first line\nsecond line';
    await editor.trigger('input');
    await editor.trigger('keydown', { key: 'Enter' });

    expect(wrapper.text()).toContain('Submitted 2-line prompt');
    expect(wrapper.findAll('.chat-message--user').at(-1)?.text()).toContain('first line');
    expect(wrapper.findAll('.chat-message--user').at(-1)?.text()).toContain('second line');
  });

  it('plays the same deterministic streaming response after every submission', async () => {
    vi.useFakeTimers();
    const wrapper = mount(App);
    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = 'stream a reply';
    await editor.trigger('input');
    await editor.trigger('keydown', { key: 'Enter' });

    expect(wrapper.findAll('.chat-message--assistant').at(-1)?.find('.chat-message__thinking').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(900);
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('.chat-message--assistant').at(-1)?.text())
      .toContain('Mock response: the composer accepted the prompt and streamed this deterministic reply.');
    expect(wrapper.text()).toContain('Mock stream completed');
  });

  it('turns a pasted image into one SDK attachment without inserting inline HTML', async () => {
    const wrapper = mount(App);
    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = 'Review this image';
    await editor.trigger('input');
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        files: [new File(['png'], 'clipboard.png', { type: 'image/png' })],
        getData: () => '',
        types: ['text/html', 'Files'],
      },
    });

    editor.element.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(wrapper.text()).toContain('clipboard.png'));
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(true);
    expect(editor.find('img').exists()).toBe(false);

    await wrapper.get('form').trigger('submit');

    expect(wrapper.text()).toContain('with 1 attachment(s)');
    expect(wrapper.find('[aria-label="Prompt attachments"]').exists()).toBe(false);
    const submittedMessage = wrapper.findAll('.chat-message--user').at(-1);
    expect(submittedMessage?.text()).toContain('Review this image');
    expect(submittedMessage?.get('.chat-attachment-block__preview').attributes('alt')).toBe('clipboard.png');
  });
});
