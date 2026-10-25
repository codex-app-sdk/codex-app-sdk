import { describe, expect, it } from 'vitest';
import { formatWorkDuration } from '../../src/chat/work-duration';

describe('formatWorkDuration', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    [Number.NaN, ''],
    [-5, ''],
    [400, ''],
    [1_000, '1s'],
    [42_900, '42s'],
    [60_000, '1m'],
    [278_000, '4m 38s'],
    [3_600_000, '1h'],
    [3_780_000, '1h 3m'],
  ])('formats %s as %j', (ms, expected) => {
    expect(formatWorkDuration(ms)).toBe(expected);
  });
});
