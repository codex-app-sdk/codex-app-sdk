// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatModelReasoningSelector from '../../src/chat/ChatModelReasoningSelector.vue';
import type { CodexModelOption, ReasoningEffort } from '../../src/chat/contracts';

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
    await wrapper.get('[data-submenu-id="model"] > button').trigger('click');
    const modelChoices = wrapper.findAll('[data-submenu-id="model"] [role="menuitemradio"]');

    expect(modelChoices).toHaveLength(2);
    await modelChoices[0]!.trigger('click');
    await wrapper.get('.chat-model-selector__button').trigger('click');
    await wrapper.get('[data-submenu-id="reasoning"] > button').trigger('click');
    await wrapper.findAll('[data-submenu-id="reasoning"] [role="menuitemradio"]')[0]!.trigger('click');

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

  it('shows the current model, reasoning effort, and Fast mode state at the menu root', async () => {
    const wrapper = mountSelector({ modelId: 'codex-max', reasoningEffort: 'xhigh', serviceTier: 'priority' });
    await wrapper.get('.chat-model-selector__button').trigger('click');

    expect(wrapper.get('[data-submenu-id="model"] > button').text()).toContain('5.1 Codex Max');
    expect(wrapper.get('[data-submenu-id="reasoning"] > button').text()).toContain('Extra High');
    expect(wrapper.get('[role="menuitemcheckbox"]').attributes('aria-checked')).toBe('true');
  });

  it('keeps the divider only above Fast mode', async () => {
    const wrapper = mountSelector({ modelId: 'codex-max', serviceTier: 'priority' });
    await wrapper.get('.chat-model-selector__button').trigger('click');

    expect(wrapper.findAll('.codex-composer-menu-list__separator')).toHaveLength(1);
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

  it('organizes model and reasoning choices into hierarchical menus', async () => {
    const wrapper = mountSelector();
    await wrapper.get('.chat-model-selector__button').trigger('click');

    expect(wrapper.findAll('[data-submenu-id]')).toHaveLength(2);
    expect(wrapper.get('[data-submenu-id="model"] > button').attributes('aria-expanded')).toBe('false');
    expect(wrapper.get('[data-submenu-id="reasoning"] > button').attributes('aria-expanded')).toBe('false');
    for (const submenuId of ['model', 'reasoning']) {
      expect(wrapper.get(`[data-submenu-id="${submenuId}"] > .codex-composer-menu-list__submenu-list`).classes())
        .toContain('codex-composer-menu-list__submenu-list--bottom-aligned');
    }
    await wrapper.get('[data-submenu-id="model"] > button').trigger('click');
    expect(wrapper.get('[data-submenu-id="model"] > button').attributes('aria-expanded')).toBe('true');
    expect(wrapper.findAll('[data-submenu-id="model"] [role="menuitemradio"]')).toHaveLength(2);
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
