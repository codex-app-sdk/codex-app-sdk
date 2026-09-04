import { describe, expect, it } from 'vitest';

import { formatMessageSentAt, fullMessageSentAt } from '../../src/chat/message-time';

const dayMs = 24 * 60 * 60 * 1000;
const timeOptions = { hour: 'numeric', minute: '2-digit' } satisfies Intl.DateTimeFormatOptions;

function formatted(value: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(undefined, options).format(value);
}

describe('message timestamps', () => {
  const now = new Date(2026, 8, 4, 12, 0, 0, 0);

  it('returns no label for an invalid timestamp', () => {
    expect(formatMessageSentAt('not-a-date', now)).toBe('');
    expect(fullMessageSentAt('not-a-date')).toBe('');
  });

  it('formats the same local day as a time', () => {
    const sentAt = new Date(2026, 8, 4, 1, 23);

    expect(formatMessageSentAt(sentAt.toISOString(), now)).toBe(formatted(sentAt, timeOptions));
  });

  it('formats a past timestamp less than seven days old with weekday and time', () => {
    const sentAt = new Date(now.getTime() - 7 * dayMs + 1);

    expect(formatMessageSentAt(sentAt.toISOString(), now)).toBe(formatted(sentAt, {
      weekday: 'short',
      ...timeOptions,
    }));
  });

  it.each([
    ['the exact seven-day boundary', new Date(now.getTime() - 7 * dayMs)],
    ['a future local day', new Date(2026, 8, 5, 12, 0)],
    ['the same day number in an earlier month', new Date(2026, 7, 4, 12, 0)],
    ['the same month and day in an earlier year', new Date(2025, 8, 4, 12, 0)],
  ])('formats %s with medium date and short time', (_label, sentAt) => {
    expect(formatMessageSentAt(sentAt.toISOString(), now)).toBe(formatted(sentAt, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }));
  });

  it('does not confuse an adjacent local date with the same day', () => {
    const sentAt = new Date(2026, 8, 3, 23, 30);

    expect(formatMessageSentAt(sentAt.toISOString(), now)).toBe(formatted(sentAt, {
      weekday: 'short',
      ...timeOptions,
    }));
  });

  it('provides a full accessible timestamp', () => {
    const sentAt = new Date(2024, 1, 29, 16, 45);

    expect(fullMessageSentAt(sentAt.toISOString())).toBe(formatted(sentAt, {
      dateStyle: 'full',
      timeStyle: 'short',
    }));
  });
});
