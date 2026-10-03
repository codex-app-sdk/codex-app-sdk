// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.vue';
import type { CodexMessageTextSelection } from '@codex-app-sdk/vue';

async function openQuestionLab(wrapper: ReturnType<typeof mount>, delivery = 'async', format = 'choices', steps = 'multiple') {
  await wrapper.findAll('nav button').find((button) => button.text().includes('Approvals & questions'))!.trigger('click');
  await wrapper.get('select[aria-label="Question delivery"]').setValue(delivery);
  await wrapper.get('select[aria-label="Question format"]').setValue(format);
  await wrapper.get('select[aria-label="Question steps"]').setValue(steps);
  await wrapper.findAll('button').find((button) => button.text() === 'Ask question')!.trigger('click');
}

describe('component lab', () => {
  afterEach(() => vi.useRealTimers());
  it('shows a blocking tool question in place of the composer, then keeps its answered summary', async () => {
    const wrapper = mount(App);
    await openQuestionLab(wrapper, 'tool', 'choices', 'single');

    const footer = wrapper.get('.codex-conversation-pane__footer');
    expect(footer.text()).toContain('Which framework should I use?');
    expect(wrapper.find('.chat-rich-text-editor').exists()).toBe(false);
    expect(wrapper.find('.codex-conversation-pane__messages .chat-tool-user-input').exists()).toBe(false);

    await footer.get('button[aria-label="Vue"]').trigger('click');
    await footer.get('.chat-tool-user-input__button--primary').trigger('click');
    expect(wrapper.find('.chat-rich-text-editor').exists()).toBe(true);
    expect(wrapper.get('.codex-conversation-pane__messages').text()).toContain('Answered user question');
    expect(wrapper.get('.codex-conversation-pane__messages').text()).toContain('Vue');
  });
  it('exercises an asynchronous agent question through the controlled pane', async () => {
    vi.useFakeTimers();
    const wrapper = mount(App);
    await openQuestionLab(wrapper);

    expect(wrapper.text()).toContain('Which framework should I use?');
    expect(wrapper.find('.chat-rich-text-editor').exists()).toBe(false);
    await wrapper.findAll('button').find((button) => button.text() === 'Complete turn')!.trigger('click');
    expect(wrapper.find('.chat-rich-text-editor').exists()).toBe(true);
    await wrapper.get('button[aria-label="Pending question"]').trigger('click');
    expect(wrapper.find('.chat-rich-text-editor').exists()).toBe(false);
    const vueOption = wrapper.findAll('button').find((button) => button.text().includes('Vue'));
    expect(vueOption).toBeDefined();
    expect(vueOption!.element.closest('.chat-fold')).toBeNull();
    await vueOption!.trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === 'Next')!.trigger('click');
    await wrapper.get<HTMLTextAreaElement>('.chat-tool-user-input__other-input--direct').setValue('Preserve the existing API.');
    const send = wrapper.findAll('button').find((button) => button.text() === 'Send');
    expect(send).toBeDefined();
    await send!.trigger('click');

    expect(wrapper.text()).toContain('Answered: Vue, Preserve the existing API.');
    expect(wrapper.findAll('.chat-message--user').at(-1)?.text()).toContain('Vue, Preserve the existing API.');
    expect(wrapper.find('button[aria-label="Pending question"]').exists()).toBe(false);
  });
  it('shows text-only asynchronous questions as an immediately focused field', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await openQuestionLab(wrapper, 'async', 'text', 'single');

    const input = wrapper.get<HTMLTextAreaElement>('.chat-tool-user-input__other-input--direct');
    expect(wrapper.text().split('What should I know before continuing?')).toHaveLength(2);
    const questionCard = wrapper.findAll('.chat-tool-user-input')
      .find((card) => card.find('.chat-tool-user-input__other-input--direct').exists());
    expect(questionCard).toBeDefined();
    expect(questionCard!.find('.chat-tool-user-input__tag').exists()).toBe(false);
    expect(questionCard!.find('[aria-label="Question progress"]').exists()).toBe(false);
    expect(questionCard!.find('.chat-tool-user-input__option--other').exists()).toBe(false);
    await vi.waitFor(() => expect(document.activeElement).toBe(input.element));
    await input.setValue('Preserve the existing API.');
    await questionCard!.findAll('button').find((button) => button.text() === 'Send')!.trigger('click');

    expect(wrapper.text()).toContain('Answered: Preserve the existing API.');
    wrapper.unmount();
  });
  it('renders a dense multi-turn fixture with mentions, attachments, tools, and steering', async () => {
    const wrapper = mount(App);
    expect(wrapper.text()).toContain('Component lab');
    expect(wrapper.text()).toContain('Multi-turn conversation');
    expect(wrapper.find('.chat-user-text__mention--skill').text()).toContain('Commit-Push');
    expect(wrapper.find('.chat-user-text__mention--plugin').text()).toContain('Gmail');
    expect(wrapper.get('.chat-attachment-block__preview').attributes('alt')).toBe('composer-broken.png');
    expect(wrapper.text()).toContain('layout-notes.md');
    const toolHeader = wrapper.get('.chat-tool-group__header');
    expect(toolHeader.text()).toContain('4 actions done');
    expect(toolHeader.get('.chat-animated-diff-stat--added').text()).toBe('+128');
    expect(toolHeader.get('.chat-animated-diff-stat--deleted').text()).toBe('-96');
    await toolHeader.trigger('click');
    expect(wrapper.text()).toContain('Explored src/vue');
    expect(wrapper.find('.tabler-icon-folder').exists()).toBe(true);
    expect(wrapper.find('.tabler-icon-tool').exists()).toBe(true);
    const steer = wrapper.findAll('.chat-message')
      .find((message) => message.text().includes('Message from codex-claw'));
    expect(steer).toBeDefined();
    if (!steer) return;
    const messageHeader = steer.findAll('.chat-message--steer')
      .find((header) => header.text().includes('Message from codex-claw'));
    expect(messageHeader).toBeDefined();
    if (!messageHeader) return;
    expect(messageHeader.text()).toBe('Message from codex-claw');
    expect(steer.text()).toContain('Steered conversation');
    expect(steer.text()).toContain('Focus on the attachment renderer first.');
    expect(steer.find('.chat-message__actions').exists()).toBe(false);
    expect(messageHeader.element.compareDocumentPosition(steer.get('.chat-message__stack').element))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('demonstrates opt-in message selection and host-owned composer context', async () => {
    const wrapper = mount(App);
    const scenarioButton = wrapper.findAll('nav button')
      .find((button) => button.text().includes('Message selection'));
    expect(scenarioButton).toBeDefined();
    await scenarioButton!.trigger('click');
    const selection: CodexMessageTextSelection = {
      anchor: { x: 100, y: 120, width: 80, height: 20 },
      messageId: 'selection-assistant',
      messageIndex: 1,
      role: 'assistant',
      text: 'clear separation',
      turnId: 'selection-turn',
    };

    wrapper.getComponent({ name: 'CodexConversationPane' }).vm.$emit('messageTextSelectionChange', selection);
    await wrapper.vm.$nextTick();
    await wrapper.get('.lab__selection-action').trigger('click');

    expect(wrapper.get('.lab__composer-context-card').text()).toContain('clear separation');
    const send = wrapper.get('button[aria-label="Send prompt"]');
    expect(send.attributes()).not.toHaveProperty('disabled');
    await send.trigger('click');

    expect(wrapper.find('.lab__composer-context-card').exists()).toBe(false);
    expect(wrapper.findAll('.chat-message--user').at(-1)?.text()).toContain('Selected message context:');
    expect(wrapper.findAll('.chat-message--user').at(-1)?.text()).toContain('clear separation');
  });

  it('demonstrates the pending Goal command from selection through submission', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    const scenarioButton = wrapper.findAll('nav button')
      .find((button) => button.text().includes('Goal composer'));
    expect(scenarioButton).toBeDefined();
    await scenarioButton!.trigger('click');

    const editor = wrapper.get('[role="textbox"][contenteditable]');
    editor.element.textContent = '/goa';
    await editor.trigger('input');
    const range = document.createRange();
    range.selectNodeContents(editor.element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    await editor.trigger('keyup');
    await wrapper.get('.chat-composer-slash-menu__item').trigger('mousedown');

    expect(wrapper.get('[aria-label="Active composer modes"]').text()).toBe('Goal');
    expect(editor.attributes('data-placeholder')).toBe('Describe the goal');
    expect(wrapper.get('button[aria-label="Send prompt"]').attributes()).toHaveProperty('disabled');

    editor.element.textContent = 'Ship the component lab';
    await editor.trigger('input');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.findAll('.chat-message--user').at(-1)?.text()).toContain('/goal Ship the component lab');
    expect(wrapper.find('[aria-label="Active composer modes"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders every tool action icon and label in the tool gallery', async () => {
    const wrapper = mount(App);
    const galleryButton = wrapper.findAll('nav button')
      .find((button) => button.text().includes('Tool icon gallery'));
    expect(galleryButton).toBeDefined();
    await galleryButton!.trigger('click');

    const toolHeaders = wrapper.findAll('.chat-tool-group__header');
    expect(toolHeaders).toHaveLength(2);
    expect(toolHeaders[0]?.text()).toContain('5 actions done');
    expect(toolHeaders[0]?.get('.chat-animated-diff-stat--added').text()).toBe('+12');
    expect(toolHeaders[0]?.get('.chat-animated-diff-stat--deleted').text()).toBe('-3');
    expect(toolHeaders[1]?.text()).toContain('5 actions done');
    for (const toolHeader of toolHeaders) await toolHeader.trigger('click');

    const expected = [
      ['Created src/vue/chat/ToolGallery.vue', 'pencil'],
      ['Deleted src/vue/chat/LegacyTool.vue', 'trash'],
      ['Edited src/vue/chat/ChatToolCall.vue', 'pencil'],
      ['Explored src/vue/chat', 'folder'],
      ['Listed src/vue/chat', 'folder'],
      ['Updated plan', 'list-details'],
      ['Read README.md', 'file-text'],
      ['Ran /bin/bash -lc "npm test && npm run typecheck && npm run build"', 'terminal-2'],
      ['Searched registerCodexToolTitlePresenter', 'search'],
      ['Opened in-app browser', 'lab-browser-tool-icon'],
      ['Claw synchronization complete', 'tool'],
    ] as const;
    const toolCalls = wrapper.findAll('.chat-tool-call');
    expect(toolCalls).toHaveLength(expected.length);
    for (const [index, [label, icon]] of expected.entries()) {
      const toolCall = toolCalls[index];
      expect(toolCall).toBeDefined();
      if (!toolCall) continue;
      expect(toolCall.text().replace(/\s/g, '')).toContain(label.replace(/\s/g, ''));
      const iconClasses = toolCall.get('.chat-tool-call__title svg').classes();
      expect(iconClasses).toContain(icon === 'lab-browser-tool-icon' ? icon : `tabler-icon-${icon}`);
    }
  });

  it('shows active tools below the counter and completed tools first when expanded', async () => {
    vi.useFakeTimers();
    const wrapper = mount(App);
    const busyButton = wrapper.findAll('nav button')
      .find((button) => button.text().includes('Busy and queued'));
    expect(busyButton).toBeDefined();
    await busyButton!.trigger('click');

    const group = wrapper.get('.chat-tool-group');
    expect(group.get('.chat-tool-group__title').text()).toBe('2 actions done');
    expect(group.get('.chat-tool-group__running').text()).toContain('Finding composer code');
    expect(group.get('.chat-tool-group__running').text()).toContain('Running npm run build');
    expect(group.get('.chat-fold').classes()).not.toContain('chat-fold--open');

    await vi.advanceTimersByTimeAsync(600);
    expect(group.get('.chat-tool-group__title').text()).toBe('3 actions done');
    expect(group.get('.chat-tool-group__running').text()).toContain('Searched composer code');

    await vi.advanceTimersByTimeAsync(2_999);
    expect(group.get('.chat-tool-group__running').text()).toContain('Searched composer code');
    await vi.advanceTimersByTimeAsync(1);
    expect(group.get('.chat-tool-group__running').text()).not.toContain('Searched composer code');
    expect(group.get('.chat-tool-group__running').text()).toContain('Running npm run build');

    await group.get('.chat-tool-group__header').trigger('click');
    const titles = group.findAll('.chat-tool-call__title').map((title) => title.text());
    expect(titles.slice(0, 3)).toEqual(['Ran npm test', 'Read README.md', 'Searched composer code']);
    expect(titles.slice(3)).toEqual(['Running npm run build']);
  });

  it('demonstrates reasoning titles only while their tool group is active', async () => {
    vi.useFakeTimers();
    const wrapper = mount(App);
    const scenarioButton = wrapper.findAll('nav button')
      .find((button) => button.text().includes('Reasoning activity'));
    expect(scenarioButton).toBeDefined();
    await scenarioButton!.trigger('click');

    expect(wrapper.get('.chat-tool-group__title').text())
      .toBe('Planning targeted filename searches · 2 actions done');
    expect(wrapper.find('.chat-message-block--reasoning').exists()).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(wrapper.get('.chat-tool-group__title').text())
      .toBe('Inspecting component contract backend · 3 actions done');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(wrapper.get('.chat-tool-group__title').text()).toBe('4 actions done');
    expect(wrapper.text()).toContain('The component contract is clear.');
    expect(wrapper.text()).not.toContain('Planning targeted filename searches');
    expect(wrapper.text()).not.toContain('Inspecting component contract backend');
  });

  it('visibly confirms that the current scenario was reset', async () => {
    vi.useFakeTimers();
    const wrapper = mount(App);
    const scenarioButton = wrapper.findAll('nav button')
      .find((button) => button.text().includes('Reasoning activity'));
    expect(scenarioButton).toBeDefined();
    await scenarioButton!.trigger('click');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(wrapper.get('.chat-tool-group__title').text())
      .toBe('Inspecting component contract backend · 3 actions done');

    const resetButton = wrapper.findAll('button')
      .find((button) => button.text() === 'Reset scenario');
    expect(resetButton).toBeDefined();
    await resetButton!.trigger('click');

    expect(wrapper.get('.chat-tool-group__title').text())
      .toBe('Planning targeted filename searches · 2 actions done');
    expect(resetButton!.text()).toBe('Reset complete');

    await vi.advanceTimersByTimeAsync(1_500);
    expect(resetButton!.text()).toBe('Reset complete');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resetButton!.text()).toBe('Reset scenario');
  });

  it('shows one work disclosure for a turn with multiple steers and assistant segments', async () => {
    const wrapper = mount(App);
    const busyButton = wrapper.findAll('nav button')
      .find((button) => button.text().includes('Busy and queued'));
    expect(busyButton).toBeDefined();
    await busyButton!.trigger('click');

    expect(wrapper.findAll('.chat-work-group__title').map((title) => title.text()))
      .toStrictEqual(['Working']);
    expect(wrapper.get('.chat-work-group__header').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.chat-work-group__header svg').exists()).toBe(false);
    expect(wrapper.text()).toContain('Check the message-list boundary too.');
    expect(wrapper.text()).toContain('Keep both steers in this turn.');
    expect(wrapper.findAll('.chat-message--steer-below')).toHaveLength(2);
    expect(wrapper.findAll('.chat-message__stream-dot')).toHaveLength(1);
    const generatedPreview = wrapper.get('.chat-media-block').element;
    const laterCommentary = wrapper.findAll('.chat-message-block--text')
      .find((block) => block.text().includes('Checking the generated preview'))?.element;
    expect(laterCommentary).toBeDefined();
    expect(generatedPreview.compareDocumentPosition(laterCommentary!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('demonstrates restart-safe continuation without adding a user prompt', async () => {
    const wrapper = mount(App);
    const scenarioButton = wrapper.findAll('nav button')
      .find((button) => button.text().includes('Interrupted turn'));
    expect(scenarioButton).toBeDefined();
    await scenarioButton!.trigger('click');

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Stopped · Hide details');
    expect(wrapper.get('button[aria-label="Continue"]').attributes()).not.toHaveProperty('disabled');
    expect(wrapper.findAll('.chat-message--user')).toHaveLength(0);

    await wrapper.get('button[aria-label="Continue"]').trigger('click');

    expect(wrapper.findAll('.chat-work-group__title').map((title) => title.text()))
      .toStrictEqual(['Stopped · Hide details', 'Working']);
    expect(wrapper.findAll('.chat-message--user')).toHaveLength(0);
    expect(wrapper.text()).toContain('Continuation started without a new prompt');
  });

  it('keeps generated media visible while completed steer and work-only rows stay folded', async () => {
    const wrapper = mount(App);
    const scenarioButton = wrapper.findAll('nav button')
      .find((button) => button.text().includes('Completed turns'));
    expect(scenarioButton).toBeDefined();
    await scenarioButton!.trigger('click');

    expect(wrapper.findAll('.chat-work-group__title').map((title) => title.text()))
      .toStrictEqual(['Done · View details']);
    expect(wrapper.findAll('.chat-message--steer-below')).toHaveLength(0);
    expect(wrapper.findAll('.chat-message--assistant')).toHaveLength(4);
    expect(wrapper.findAll('.chat-message__actions')).toHaveLength(1);
    expect(wrapper.text()).toContain('The completed turn is compact.');
    expect(wrapper.get('.chat-media-block').element.closest('.chat-fold')).toBeNull();
    expect(wrapper.get('.chat-media-block').isVisible()).toBe(true);

    await wrapper.get('.chat-work-group__header').trigger('click');

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · Hide details');
    expect(wrapper.findAll('.chat-message--steer-below')).toHaveLength(2);
    expect(wrapper.findAll('.chat-message--assistant')).toHaveLength(5);
    expect(wrapper.findAll('.chat-message__actions')).toHaveLength(1);
    expect(wrapper.get('.chat-media-block').element.closest('.chat-fold')).toBeNull();
    expect(wrapper.get('.chat-media-block').isVisible()).toBe(true);

    await wrapper.get('.chat-work-group__header').trigger('click');

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · View details');
    expect(wrapper.findAll('.chat-message--steer-below')).toHaveLength(0);
    expect(wrapper.findAll('.chat-message--assistant')).toHaveLength(4);
  });

  it('shows completed work without a disclosure when there is no summary', async () => {
    const wrapper = mount(App);
    const scenarioButton = wrapper.findAll('nav button')
      .find((button) => button.text().includes('Completed turns'));
    expect(scenarioButton).toBeDefined();
    await scenarioButton!.trigger('click');

    expect(wrapper.findAll('.chat-work-group__header')).toHaveLength(1);
    expect(wrapper.text()).toContain('Finished the verification.');
    expect(wrapper.text()).toContain('The docs are current.');
    expect(wrapper.text()).not.toContain('Also check the docs.');
    const noSummaryTurn = wrapper.findAll('.codex-message-turn')
      .find((turn) => turn.text().includes('Finished the verification.'));
    expect(noSummaryTurn).toBeDefined();
    expect(noSummaryTurn!.find('.chat-work-group__header').exists()).toBe(false);
    expect(noSummaryTurn!.findAll('.chat-message--steer-below')).toHaveLength(0);
    expect(noSummaryTurn!.findAll('.chat-message__actions')).toHaveLength(0);
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
