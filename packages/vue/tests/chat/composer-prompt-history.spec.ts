import { describe, expect, it, vi } from 'vitest';
import { createComposerPromptHistory } from '../../src/chat/composer-prompt-history';

function setup(limit?: number) {
  let current = '';
  const apply = vi.fn((value: string) => {
    current = value;
  });
  const history = createComposerPromptHistory({
    apply,
    currentPrompt: () => current,
    ...(limit === undefined ? {} : { limit }),
  });
  return {
    apply,
    history,
    setCurrent(value: string) {
      current = value;
    },
  };
}

describe('composer prompt history', () => {
  it('does not recall an empty history or replace a nonempty draft', () => {
    const state = setup();
    expect(state.history.recall('ArrowUp')).toBe(false);
    expect(state.apply).not.toHaveBeenCalled();

    state.history.remember('saved');
    state.setCurrent('draft');
    expect(state.history.recall('ArrowUp')).toBe(false);
    expect(state.apply).not.toHaveBeenCalled();
  });

  it('navigates older entries, clamps at the oldest, and clears after the newest', () => {
    const state = setup();
    state.history.remember('first');
    state.history.remember('second');

    expect(state.history.recall('ArrowDown')).toBe(false);
    expect(state.history.recall('ArrowUp')).toBe(true);
    expect(state.apply).toHaveBeenLastCalledWith('second');
    expect(state.history.recall('ArrowUp')).toBe(true);
    expect(state.apply).toHaveBeenLastCalledWith('first');
    expect(state.history.recall('ArrowUp')).toBe(true);
    expect(state.apply).toHaveBeenLastCalledWith('first');
    expect(state.history.recall('ArrowDown')).toBe(true);
    expect(state.apply).toHaveBeenLastCalledWith('second');
    expect(state.history.recall('ArrowDown')).toBe(true);
    expect(state.apply).toHaveBeenLastCalledWith('');
    expect(state.history.recall('ArrowDown')).toBe(false);
  });

  it('bounds remembered entries to an explicit limit', () => {
    const state = setup(2);
    state.history.remember('discarded');
    state.history.remember('older');
    state.history.remember('newer');

    state.history.recall('ArrowUp');
    state.history.recall('ArrowUp');
    state.history.recall('ArrowUp');
    expect(state.apply).toHaveBeenLastCalledWith('older');
  });

  it('clamps nonpositive limits to one entry', () => {
    const state = setup(0);
    state.history.remember('discarded');
    state.history.remember('retained');

    state.history.recall('ArrowUp');
    state.history.recall('ArrowUp');
    expect(state.apply).toHaveBeenLastCalledWith('retained');
  });

  it('uses a default limit of one hundred entries', () => {
    const state = setup();
    for (let index = 0; index <= 100; index += 1) state.history.remember(`prompt-${index}`);
    for (let index = 0; index <= 100; index += 1) state.history.recall('ArrowUp');
    expect(state.apply).toHaveBeenLastCalledWith('prompt-1');
  });

  it('seeds only the newest bounded entries and resets active navigation', () => {
    const state = setup(2);
    state.history.seed(['discarded', 'older', 'newer']);
    state.history.recall('ArrowUp');
    expect(state.apply).toHaveBeenLastCalledWith('newer');
    state.history.recall('ArrowUp');
    state.history.recall('ArrowUp');
    expect(state.apply).toHaveBeenLastCalledWith('older');

    state.history.seed(['replacement-old', 'replacement-new']);
    state.setCurrent('');
    state.history.recall('ArrowUp');
    expect(state.apply).toHaveBeenLastCalledWith('replacement-new');
    state.history.recall('ArrowUp');
    expect(state.apply).toHaveBeenLastCalledWith('replacement-old');
    state.history.recall('ArrowUp');
    expect(state.apply).toHaveBeenLastCalledWith('replacement-old');
  });

  it('keeps the navigation index when reseeded with identical entries', () => {
    const state = setup();
    state.history.seed(['older', 'newer']);
    state.history.recall('ArrowUp');
    expect(state.apply).toHaveBeenLastCalledWith('newer');

    state.history.seed(['older', 'newer']);
    state.history.recall('ArrowUp');
    expect(state.apply).toHaveBeenLastCalledWith('older');
  });

  it('replaces a same-length seed when only one entry changed', () => {
    const state = setup();
    state.history.seed(['shared', 'old']);
    state.history.recall('ArrowUp');

    state.history.seed(['shared', 'replacement']);
    state.setCurrent('');
    state.history.recall('ArrowUp');
    expect(state.apply).toHaveBeenLastCalledWith('replacement');
  });

  it('resets navigation after remembering a new entry or explicitly exiting', () => {
    const remembered = setup();
    remembered.history.seed(['older', 'newer']);
    remembered.history.recall('ArrowUp');
    remembered.history.remember('latest');
    expect(remembered.history.recall('ArrowDown')).toBe(false);
    remembered.setCurrent('');
    remembered.history.recall('ArrowUp');
    expect(remembered.apply).toHaveBeenLastCalledWith('latest');

    const exited = setup();
    exited.history.seed(['older', 'newer']);
    exited.history.recall('ArrowUp');
    exited.history.exit();
    expect(exited.history.recall('ArrowDown')).toBe(false);
  });
});
