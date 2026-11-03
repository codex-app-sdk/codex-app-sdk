import { afterEach, describe, expect, it, vi } from 'vitest';

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

  describe('formatter cost', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    function renderTranscriptLabels(count: number) {
      for (let index = 0; index < count; index += 1) {
        const sameDay = new Date(2026, 8, 4, 1, index % 60);
        const thisWeek = new Date(now.getTime() - 2 * dayMs);
        const older = new Date(2025, 8, 4, 12, 0);
        for (const sentAt of [sameDay, thisWeek, older]) formatMessageSentAt(sentAt.toISOString(), now);
        fullMessageSentAt(older.toISOString());
      }
    }

    it('shares formatters across a long transcript instead of building one per label', () => {
      vi.useFakeTimers({ now });
      const construct = vi.spyOn(Intl, 'DateTimeFormat');

      renderTranscriptLabels(200);

      expect(construct.mock.calls.length).toBeLessThanOrEqual(4);
    });

    it('rebuilds formatters after a while so a changed time zone or locale is picked up', () => {
      vi.useFakeTimers({ now });
      renderTranscriptLabels(1);
      const construct = vi.spyOn(Intl, 'DateTimeFormat');

      vi.advanceTimersByTime(61_000);
      renderTranscriptLabels(1);

      expect(construct).toHaveBeenCalled();
    });
  });
});
