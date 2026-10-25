// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import ChatWorkGroup from '../../src/chat/ChatWorkGroup.vue';
import { assistantWorkMessageIndexKey, assistantWorkTurnKey, type AssistantWorkTurnContext } from '../../src/chat/message-work-state';

function mountWithTurn(turn: Partial<{ active: boolean; status: AssistantWorkTurnContext['status']['value']; startedAt: string | null; durationMs: number | null }>) {
  const state = ref({ active: true, status: undefined as AssistantWorkTurnContext['status']['value'], startedAt: null as string | null, durationMs: null as number | null, ...turn });
  const expanded = ref(false);
  const context: AssistantWorkTurnContext = {
    active: computed(() => state.value.active),
    completedWithoutFinal: computed(() => false),
    enabled: computed(() => true),
    expanded,
    finalStarted: computed(() => !state.value.active),
    headerMessageIndex: computed(() => 0),
    latestStreamingAssistantIndex: computed(() => 0),
    phased: computed(() => true),
    status: computed(() => state.value.status),
    turnId: computed(() => 'turn-1'),
    startedAt: computed(() => state.value.startedAt),
    durationMs: computed(() => state.value.durationMs),
    toggle: () => { expanded.value = !expanded.value; },
  };
  const wrapper = mount(ChatWorkGroup, {
    props: { active: state.value.active, finalStarted: !state.value.active },
    slots: { default: 'Work' },
    global: { provide: { [assistantWorkTurnKey as symbol]: context, [assistantWorkMessageIndexKey as symbol]: computed(() => 0) } },
  });
  return { wrapper, state };
}

afterEach(() => vi.useRealTimers());

describe('ChatWorkGroup', () => {
  it('expands active work, collapses completed work, and lets the reader reopen it', async () => {
    const wrapper = mount(ChatWorkGroup, {
      props: { active: true, finalStarted: false },
      slots: { default: 'Inspected the renderer' },
    });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Working');
    expect(wrapper.get('.chat-fold').classes()).toContain('chat-fold--open');
    expect(wrapper.get('.chat-work-group__header').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.chat-work-group__header svg').exists()).toBe(false);

    await wrapper.get('.chat-work-group__header').trigger('click');
    expect(wrapper.get('.chat-fold').classes()).toContain('chat-fold--open');

    await wrapper.setProps({ active: false, finalStarted: true });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · View details');
    expect(wrapper.get('.chat-fold').classes()).not.toContain('chat-fold--open');

    await wrapper.get('.chat-work-group__header').trigger('click');
    expect(wrapper.get('.chat-fold').classes()).toContain('chat-fold--open');
    expect(wrapper.get('.chat-work-group__title').text()).toBe('Done · Hide details');
  });

  it('shows summary-less work directly and keeps it expanded while active', async () => {
    const wrapper = mount(ChatWorkGroup, {
      props: { active: false, finalStarted: false },
      slots: { default: 'Inspecting the renderer' },
    });

    expect(wrapper.find('.chat-work-group__header').exists()).toBe(false);
    expect(wrapper.text()).toContain('Inspecting the renderer');
    await wrapper.setProps({ active: true });
    expect(wrapper.get('.chat-work-group__title').text()).toBe('Working');
    expect(wrapper.get('.chat-fold').classes()).toContain('chat-fold--open');

    await wrapper.get('.chat-work-group__header').trigger('click');
    expect(wrapper.get('.chat-fold').classes()).toContain('chat-fold--open');
    await wrapper.setProps({ finalStarted: true });
    expect(wrapper.get('.chat-fold').classes()).not.toContain('chat-fold--open');
  });

  it('shows the elapsed time while working and keeps it ticking', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T01:00:00.000Z'));
    const { wrapper } = mountWithTurn({ active: true, startedAt: '2026-10-25T00:58:48.000Z' });

    expect(wrapper.get('.chat-work-group__title').text()).toBe('Working · 1m 12s');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(wrapper.get('.chat-work-group__title').text()).toBe('Working · 1m 15s');
  });

  it('shows plain Working until the turn start is known or a second has passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T01:00:00.000Z'));
    expect(mountWithTurn({ active: true }).wrapper.get('.chat-work-group__title').text()).toBe('Working');
    expect(mountWithTurn({ active: true, startedAt: '2026-10-25T01:00:00.000Z' }).wrapper.get('.chat-work-group__title').text()).toBe('Working');
  });

  it('shows the final duration once the turn is done, stopped or failed', async () => {
    const done = mountWithTurn({ active: false, status: 'completed', durationMs: 278_000 }).wrapper;
    expect(done.get('.chat-work-group__title').text()).toBe('Done · 4m 38s · View details');
    await done.get('.chat-work-group__header').trigger('click');
    expect(done.get('.chat-work-group__title').text()).toBe('Done · 4m 38s · Hide details');

    expect(mountWithTurn({ active: false, status: 'interrupted', durationMs: 5_000 }).wrapper.get('.chat-work-group__title').text()).toContain('Stopped · 5s');
    expect(mountWithTurn({ active: false, status: 'failed', durationMs: 5_000 }).wrapper.get('.chat-work-group__title').text()).toContain('Failed · 5s');
  });

  it('falls back to the plain label when the duration is unknown', () => {
    expect(mountWithTurn({ active: false, status: 'completed', durationMs: null }).wrapper.get('.chat-work-group__title').text()).toBe('Done · View details');
  });
});
