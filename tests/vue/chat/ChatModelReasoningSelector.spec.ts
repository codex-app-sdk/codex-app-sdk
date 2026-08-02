// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatModelReasoningSelector from '../../../src/vue/chat/ChatModelReasoningSelector.vue';
import type { CodexModelOption, ReasoningEffort } from '../../../src/vue/chat/contracts';

type SelectorProps = {
  disabled?: boolean;
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  modelId?: string | null;
  models?: CodexModelOption[];
  reasoningEffort?: ReasoningEffort | null;
  serviceTier?: string | null;
};

const models: CodexModelOption[] = [
  {
    id: 'codex-fast',
    model: 'gpt-5.1-codex-fast',
    displayName: 'GPT-5.1 Codex Fast',
    description: 'Fast implementation work',
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Quick' },
      { reasoningEffort: 'medium', description: 'Balanced' },
    ],
    defaultReasoningEffort: 'medium',
    isDefault: false,
  },
  {
    id: 'codex-max',
    model: 'gpt-5.1-codex-max',
    displayName: 'GPT-5.1 Codex Max',
    description: 'Deep implementation work',
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'Deep reasoning' },
      { reasoningEffort: 'xhigh', description: 'Maximum reasoning' },
    ],
    defaultReasoningEffort: 'high',
    serviceTiers: [{ id: 'priority', name: 'Priority', description: 'Fast responses' }],
    defaultServiceTier: null,
    isDefault: true,
  },
];

describe('ChatModelReasoningSelector', () => {
  it('shows the selected model and reasoning effort labels', () => {
    const wrapper = mountSelector({
      modelId: 'codex-max',
      reasoningEffort: 'xhigh',
    });

    expect(wrapper.get('.chat-model-selector__button').text()).toContain('5.1 Codex Max Extra High');
  });

  it('falls back to the default catalog model and its default reasoning effort', () => {
    const wrapper = mountSelector();

    expect(wrapper.get('.chat-model-selector__button').text()).toContain('5.1 Codex Max High');
  });

  it('emits model and reasoning changes from dropdown commands', async () => {
    const wrapper = mountSelector();
    await wrapper.get('.chat-model-selector__button').trigger('click');
    const choices = wrapper.findAll('[role="menuitemradio"]');

    expect(choices).toHaveLength(5);
    await choices[0]!.trigger('click');
    await wrapper.get('.chat-model-selector__button').trigger('click');
    await wrapper.findAll('[role="menuitemradio"]')[2]!.trigger('click');

    expect(wrapper.emitted('update:modelId')).toStrictEqual([['codex-fast']]);
    expect(wrapper.emitted('update:reasoningEffort')).toStrictEqual([['medium']]);
  });

  it('renders and toggles Fast mode when the model exposes a priority service tier', async () => {
    const wrapper = mountSelector({ modelId: 'codex-max' });
    expect(wrapper.find('.chat-model-selector__leading-icon').exists()).toBe(false);
    await wrapper.get('.chat-model-selector__button').trigger('click');

    const fastMode = wrapper.findAll('[role="menuitemcheckbox"]');
    expect(fastMode).toHaveLength(1);
    expect(fastMode[0]!.text()).toContain('Fast mode');
    await fastMode[0]!.trigger('click');
    expect(wrapper.emitted('update:serviceTier')).toStrictEqual([['priority']]);
  });

  it('shows the Fast mode icon only when the fast tier is selected', () => {
    const wrapper = mountSelector({ modelId: 'codex-max', serviceTier: 'priority' });

    expect(wrapper.find('.chat-model-selector__leading-icon').exists()).toBe(true);
  });

  it('keeps disabled controls inert when the model catalog has not loaded', () => {
    const wrapper = mountSelector({
      models: [],
      modelCatalogStatus: 'loading',
    });

    expect(wrapper.text()).toContain('Loading models');
    expect(wrapper.text()).toContain('Loading');
    for (const button of wrapper.findAll('button')) {
      expect(button.attributes()).toHaveProperty('disabled');
    }
  });

  it('does not show model descriptions inside the popover', async () => {
    const wrapper = mountSelector();
    await wrapper.get('.chat-model-selector__button').trigger('click');

    expect(wrapper.text()).not.toContain('Deep implementation work');
    expect(wrapper.text()).not.toContain('Fast implementation work');
  });

  it('groups model choices above reasoning choices in one menu', async () => {
    const wrapper = mountSelector();
    await wrapper.get('.chat-model-selector__button').trigger('click');

    expect(wrapper.findAll('.codex-composer-menu-list__heading').map((heading) => heading.text())).toStrictEqual([
      'Model',
      'Reasoning',
      'Speed',
    ]);
    expect(wrapper.findAll('.codex-composer-menu-list__description')).toHaveLength(1);
    expect(wrapper.findAll('.chat-model-selector__menu')).toHaveLength(1);
  });
});

function mountSelector(overrides: Partial<SelectorProps> = {}) {
  return mount(ChatModelReasoningSelector, {
    props: {
      models,
      ...overrides,
    },
  });
}
