// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ChatModelReasoningSelector from '../../src/chat/ChatModelReasoningSelector.vue';
import CodexComposerMenu from '../../src/components/CodexComposerMenu.vue';
import type { CodexModelOption, ReasoningEffort } from '../../src/chat/contracts';
import type { CodexComposerMenuItem } from '../../src/composer-menu';

type SelectorProps = {
  disabled?: boolean;
  modelCatalogStatus?: 'notLoaded' | 'loading' | 'loaded' | 'error';
  modelId?: string | null;
  menuItems?: CodexComposerMenuItem<{ action: 'select' | 'remove'; id: string }>[];
  models?: CodexModelOption[];
  reasoningEffort?: ReasoningEffort | null;
  serviceTier?: string | null;
  showReasoning?: boolean;
  showServiceTier?: boolean;
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

  it('prefers an explicit model, then the default model, then the first catalog entry', () => {
    expect(mountSelector({ modelId: 'codex-fast' }).get('.chat-model-selector__button').text())
      .toContain('5.1 Codex Fast Medium');

    const withoutDefault = models.map((model) => ({ ...model, isDefault: false }));
    expect(mountSelector({ modelId: 'missing', models: withoutDefault }).get('.chat-model-selector__button').text())
      .toContain('5.1 Codex Fast Medium');
  });

  it.each([
    ['loading', 'Loading models'],
    ['error', 'Models unavailable'],
    ['notLoaded', 'Model'],
    ['loaded', 'Model'],
  ] as const)('renders the exact empty-catalog label for %s', (modelCatalogStatus, label) => {
    const wrapper = mountSelector({ models: [], modelCatalogStatus });

    expect(wrapper.get('.chat-model-selector__button').text()).toBe(label);
    expect(wrapper.get<HTMLButtonElement>('.chat-model-selector__button').element.disabled).toBe(true);
  });

  it('uses explicit, default, and first-supported reasoning efforts in order', () => {
    const model: CodexModelOption = {
      ...models[0]!,
      defaultReasoningEffort: null,
      supportedReasoningEfforts: [
        { reasoningEffort: 'minimal', description: 'Minimal' },
        { reasoningEffort: 'high', description: 'High' },
      ],
    };

    expect(mountSelector({ models: [model], reasoningEffort: 'custom_effort' })
      .get('.chat-model-selector__button').text()).toContain('Custom Effort');
    expect(mountSelector({ models: [model] }).get('.chat-model-selector__button').text()).toContain('Minimal');
  });

  it.each([
    [{ showReasoning: false }, '5.1 Codex Max'],
    [{ models: [{ ...models[0]!, supportedReasoningEfforts: [] }] }, '5.1 Codex Fast'],
    [{ models: [{ ...models[0]!, supportedReasoningEfforts: undefined }] }, '5.1 Codex Fast'],
  ] satisfies Array<[Partial<SelectorProps>, string]>)
  ('hides reasoning when its gate is closed %#', async (overrides, expectedLabel) => {
    const wrapper = mountSelector(overrides);

    expect(wrapper.get('.chat-model-selector__button').text()).toBe(expectedLabel);
    await wrapper.get('.chat-model-selector__button').trigger('click');
    expect(wrapper.find('[data-submenu-id]').exists()).toBe(false);
    await wrapper.findAll('[role="menuitemradio"]')[0]!.trigger('click');
    expect(wrapper.emitted('update:modelId')?.[0]).toStrictEqual(['codex-fast']);
    expect(wrapper.emitted('update:reasoningEffort')).toBeUndefined();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('renders exact fallback effort labels when a supported effort is blank', () => {
    const blankEffortModel: CodexModelOption = {
      ...models[0]!,
      defaultReasoningEffort: null,
      supportedReasoningEfforts: [{ reasoningEffort: '', description: 'Blank' }],
    };

    expect(mountSelector({ models: [blankEffortModel], modelCatalogStatus: 'loading' })
      .get('.chat-model-selector__button').text()).toBe('5.1 Codex Fast Loading');
    expect(mountSelector({ models: [blankEffortModel], modelCatalogStatus: 'loaded' })
      .get('.chat-model-selector__button').text()).toBe('5.1 Codex Fast Reasoning');
  });

  it('selects a model and its own effort together without changing settings on submenu open', async () => {
    const wrapper = mountSelector();
    await wrapper.get('.chat-model-selector__button').trigger('click');
    await wrapper.get('[data-submenu-id="model:codex-fast"]').trigger('mouseenter');
    expect(wrapper.emitted('update:modelId')).toBeUndefined();
    const efforts = wrapper.findAll('[data-submenu-id="model:codex-fast"] [role="menuitemradio"]');
    expect(efforts.map((effort) => effort.text())).toStrictEqual(['Low', 'Medium']);
    await efforts[0]!.trigger('click');

    expect(wrapper.emitted('update:modelId')).toStrictEqual([['codex-fast']]);
    expect(wrapper.emitted('update:reasoningEffort')).toStrictEqual([['low']]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('changes the current model effort without re-emitting the model selection', async () => {
    const wrapper = mountSelector({ modelId: 'codex-max', reasoningEffort: 'medium' });
    await wrapper.get('.chat-model-selector__button').trigger('click');
    await wrapper.get('[data-submenu-id="model:codex-max"] > button').trigger('keydown', { key: 'ArrowRight' });
    await wrapper.findAll('[data-submenu-id="model:codex-max"] [role="menuitemradio"]')[1]!.trigger('click');
    expect(wrapper.emitted('update:modelId')).toBeUndefined();
    expect(wrapper.emitted('update:reasoningEffort')).toStrictEqual([['high']]);
  });

  it.each([
    ['codex-fast', 'medium', 'codex-max', 'medium'],
    ['codex-fast', 'low', 'codex-max', 'high'],
    ['codex-max', 'xhigh', 'codex-fast', 'medium'],
    ['codex-fast', null, 'codex-max', 'medium'],
  ] as const)('clicking %s/%s to %s selects the compatible or fallback effort %s', async (modelId, reasoningEffort, target, expected) => {
    const wrapper = mountSelector({
      modelId, reasoningEffort,
      models: models.map((model) => ({ ...model, defaultReasoningEffort: 'medium' })),
    });
    await wrapper.get('.chat-model-selector__button').trigger('click');
    await wrapper.get(`[data-submenu-id="model:${target}"] > button`).trigger('click');
    expect(wrapper.emitted('update:modelId')).toStrictEqual([[target]]);
    expect(wrapper.emitted('update:reasoningEffort')).toStrictEqual([[expected]]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('renders host model-menu items first and returns their original selection', async () => {
    const addFavorite = {
      id: 'add-favorite',
      label: 'Add current to favorites',
      payload: { action: 'select' as const, id: 'current' },
      type: 'action' as const,
    };
    const selectFavorite = {
      closeOnSelect: true,
      id: 'favorite:terra',
      label: 'Terra · Medium · Fast',
      payload: { action: 'select' as const, id: 'terra' },
      type: 'action' as const,
    };
    const removeFavorite = {
      id: 'remove-favorite:terra',
      label: 'Terra · Medium · Fast',
      payload: { action: 'remove' as const, id: 'terra' },
      type: 'action' as const,
    };
    const menuItems: NonNullable<SelectorProps['menuItems']> = [
      { id: 'favorites', label: 'Favorites', type: 'heading', actions: [addFavorite] },
      selectFavorite,
      {
        id: 'remove-favorite',
        label: 'Remove favorite',
        type: 'submenu',
        items: [removeFavorite],
      },
    ];
    const wrapper = mountSelector({ menuItems });
    await wrapper.get('.chat-model-selector__button').trigger('click');

    const rootMenu = wrapper.get('.chat-model-selector__menu');
    expect(rootMenu.get('.codex-composer-menu-list__heading-label').text()).toBe('Favorites');
    expect(rootMenu.findAll(':scope > .codex-composer-menu-list__separator')).toHaveLength(2);
    await rootMenu.get('button[aria-label="Add current to favorites"]').trigger('click');
    expect(wrapper.emitted('menuSelect')).toStrictEqual([[addFavorite]]);

    await wrapper.get('.chat-model-selector__button').trigger('click');
    const reopenedMenu = wrapper.get('.chat-model-selector__menu');
    await reopenedMenu.findAll(':scope > button')[0]!.trigger('click');
    expect(wrapper.emitted('menuSelect')).toStrictEqual([[addFavorite], [selectFavorite]]);
    expect(wrapper.find('.chat-model-selector__menu').exists()).toBe(false);

    await wrapper.get('.chat-model-selector__button').trigger('click');
    const removeMenu = wrapper.findAll('.codex-composer-menu-list__submenu')
      .find((submenu) => submenu.get(':scope > button').text().includes('Remove favorite'));
    expect(removeMenu).toBeDefined();
    await removeMenu!.get(':scope > button').trigger('click');
    await removeMenu!.get(':scope > .codex-composer-menu-list__submenu-list > [role="menuitem"]').trigger('click');
    expect(wrapper.emitted('menuSelect')).toStrictEqual([[addFavorite], [selectFavorite], [removeFavorite]]);
  });

  it('renders and toggles Fast mode when the model exposes a priority service tier', async () => {
    const wrapper = mountSelector({ modelId: 'codex-max' });
    expect(wrapper.find('.chat-model-selector__leading-icon').exists()).toBe(false);
    await wrapper.get('.chat-model-selector__button').trigger('click');

    const fastMode = wrapper.findAll('[role="menuitemcheckbox"]');
    expect(fastMode).toHaveLength(1);
    expect(fastMode[0]!.text()).toContain('Fast mode');
    expect(fastMode[0]!.text()).toContain('Fast responses');
    expect(fastMode[0]!.attributes('aria-checked')).toBe('false');
    expect(fastMode[0]!.find('.codex-composer-menu-list__switch').exists()).toBe(true);
    await fastMode[0]!.trigger('click');
    expect(wrapper.emitted('update:serviceTier')).toStrictEqual([['priority']]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
  });

  it('turns an already selected Fast mode off', async () => {
    const wrapper = mountSelector({ modelId: 'codex-max', serviceTier: 'priority' });
    await wrapper.get('.chat-model-selector__button').trigger('click');
    await wrapper.get('[role="menuitemcheckbox"]').trigger('click');

    expect(wrapper.emitted('update:serviceTier')).toStrictEqual([[null]]);
  });

  it('recognizes a fast service tier by name and emits its exact id', async () => {
    const nameMatchedModel: CodexModelOption = {
      ...models[0]!,
      serviceTiers: [{ id: 'turbo', name: 'Priority lane', description: 'Name-matched speed' }],
    };
    const wrapper = mountSelector({ models: [nameMatchedModel] });
    await wrapper.get('.chat-model-selector__button').trigger('click');

    expect(wrapper.get('[role="menuitemcheckbox"]').text()).toContain('Name-matched speed');
    await wrapper.get('[role="menuitemcheckbox"]').trigger('click');
    expect(wrapper.emitted('update:serviceTier')).toStrictEqual([['turbo']]);
  });

  it.each([
    { showServiceTier: false },
    {
      models: [{
        ...models[0]!,
        serviceTiers: [{ id: 'standard', name: 'Standard', description: 'Ordinary speed' }],
      }],
    },
    { models: [{ ...models[0]!, serviceTiers: [] }] },
  ] satisfies Array<Partial<SelectorProps>>)
  ('hides Fast mode when its gate is closed %#', async (overrides) => {
    const wrapper = mountSelector(overrides);
    await wrapper.get('.chat-model-selector__button').trigger('click');

    expect(wrapper.find('[role="menuitemcheckbox"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Speed');
  });

  it('shows the Fast mode icon only when the fast tier is selected', () => {
    const wrapper = mountSelector({ modelId: 'codex-max', serviceTier: 'priority' });

    expect(wrapper.find('.chat-model-selector__leading-icon').exists()).toBe(true);
  });

  it('shows the current model, reasoning effort, and Fast mode state at the menu root', async () => {
    const wrapper = mountSelector({ modelId: 'codex-max', reasoningEffort: 'xhigh', serviceTier: 'priority' });
    await wrapper.get('.chat-model-selector__button').trigger('click');

    expect(wrapper.get('[data-submenu-id="model:codex-max"] > button').text()).toContain('GPT-5.1 Codex Max');
    expect(wrapper.get('[data-submenu-id="model:codex-max"] > button').text()).toContain('Extra High');
    expect(wrapper.get('[data-submenu-id="model:codex-fast"] > button').text()).not.toContain('Extra High');
    expect(wrapper.findAll('[role="menuitemradio"][aria-checked="true"]')).toHaveLength(1);
    expect(wrapper.get('[role="menuitemcheckbox"]').attributes('aria-checked')).toBe('true');
  });

  it('keeps the divider only above Fast mode', async () => {
    const wrapper = mountSelector({ modelId: 'codex-max', serviceTier: 'priority' });
    await wrapper.get('.chat-model-selector__button').trigger('click');

    expect(wrapper.findAll('.codex-composer-menu-list__separator')).toHaveLength(1);
    expect(wrapper.get('.codex-composer-menu-list__heading').text()).toBe('Speed');
  });

  it('normalizes custom effort labels and marks only the effective effort as checked', async () => {
    const customModel: CodexModelOption = {
      ...models[0]!,
      defaultReasoningEffort: 'three_four',
      supportedReasoningEfforts: [
        { reasoningEffort: ' one-two ', description: 'Hyphenated' },
        { reasoningEffort: 'three_four', description: 'Underscored' },
        { reasoningEffort: 'five six', description: 'Spaced' },
        { reasoningEffort: ' XHIGH ', description: 'Special' },
      ],
    };
    const wrapper = mountSelector({ models: [customModel] });
    await wrapper.get('.chat-model-selector__button').trigger('click');
    await wrapper.get('[data-submenu-id="model:codex-fast"]').trigger('mouseenter');
    const choices = wrapper.findAll('[data-submenu-id="model:codex-fast"] [role="menuitemradio"]');

    expect(wrapper.get('[data-submenu-id="model:codex-fast"] > button .codex-composer-menu-list__label').text())
      .toBe('GPT-5.1 Codex Fast');
    expect(choices.map((choice) => choice.get('.codex-composer-menu-list__label').text())).toStrictEqual([
      'One Two',
      'Three Four',
      'Five Six',
      'Extra High',
    ]);
    expect(choices[0]!.get('.codex-composer-menu-list__label').element.textContent).toBe('One Two');
    expect(choices.map((choice) => choice.attributes('aria-checked'))).toStrictEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
  });

  it.each([
    ['GPT---Alpha', 'Alpha'],
    ['gpt   Beta', 'Beta'],
    ['The GPT Model', 'The GPT Model'],
    ['  Model Name  ', 'Model Name'],
    ['GPT---', 'GPT---'],
  ])('compacts the model label %s to %s', (displayName, expected) => {
    const wrapper = mountSelector({
      models: [{ ...models[0]!, displayName, supportedReasoningEfforts: [] }],
    });

    expect(wrapper.get('.chat-model-selector__label').element.textContent).toBe(expected);
  });

  it('ignores selectable commands without payloads or behind disabled feature gates', async () => {
    const onError = vi.fn();
    const noReasoning = mountSelector({ showReasoning: false });
    const noFastTier = mountSelector({ models: [{ ...models[0]!, serviceTiers: [] }] }, onError);

    emitMenuSelection(noReasoning, {
      id: 'missing-payload',
      label: 'Missing',
      type: 'action',
    });
    emitMenuSelection(noReasoning, {
      id: 'reasoning:high',
      label: 'High',
      payload: { kind: 'reasoning', value: 'high' },
      type: 'radio',
    });
    emitMenuSelection(noFastTier, {
      id: 'service-tier:priority',
      label: 'Fast mode',
      payload: { kind: 'serviceTier', value: 'priority' },
      type: 'checkbox',
    });
    await noReasoning.vm.$nextTick();
    await noFastTier.vm.$nextTick();

    expect(noReasoning.emitted('update:reasoningEffort')).toBeUndefined();
    expect(noReasoning.emitted('update:modelId')).toBeUndefined();
    expect(noFastTier.emitted('update:serviceTier')).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
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
    expect(wrapper.get('[data-submenu-id="model:codex-fast"] > button').attributes('aria-expanded')).toBe('false');
    expect(wrapper.get('[data-submenu-id="model:codex-max"] > button').attributes('aria-expanded')).toBe('false');
    for (const submenuId of ['model:codex-fast', 'model:codex-max']) {
      expect(wrapper.get(`[data-submenu-id="${submenuId}"] > .codex-composer-menu-list__submenu-list`).classes())
        .toContain('codex-composer-menu-list__submenu-list--bottom-aligned');
    }
    await wrapper.get('[data-submenu-id="model:codex-fast"]').trigger('mouseenter');
    expect(wrapper.get('[data-submenu-id="model:codex-fast"] > button').attributes('aria-expanded')).toBe('true');
    expect(wrapper.findAll('[data-submenu-id="model:codex-fast"] [role="menuitemradio"]')).toHaveLength(2);
    expect(wrapper.findAll('.codex-composer-menu-list__description')).toHaveLength(1);
    expect(wrapper.findAll('.chat-model-selector__menu')).toHaveLength(1);
  });
});

function mountSelector(overrides: Partial<SelectorProps> = {}, errorHandler?: (error: unknown) => void) {
  return mount(ChatModelReasoningSelector, {
    global: errorHandler ? { config: { errorHandler } } : undefined,
    props: {
      models,
      ...overrides,
    },
  });
}

function emitMenuSelection(
  wrapper: ReturnType<typeof mountSelector>,
  item: Record<string, unknown>,
) {
  const menu = wrapper.getComponent(CodexComposerMenu) as unknown as {
    vm: { $emit: (event: string, payload: unknown) => void };
  };
  menu.vm.$emit('select', item);
}
