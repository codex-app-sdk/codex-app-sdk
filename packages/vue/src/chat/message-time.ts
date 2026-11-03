const dayMs = 24 * 60 * 60 * 1000
const formatterLifetimeMs = 60_000

const timeOptions = {
  hour: 'numeric',
  minute: '2-digit',
} satisfies Intl.DateTimeFormatOptions

type Formatters = {
  builtAt: number
  time: Intl.DateTimeFormat
  weekdayTime: Intl.DateTimeFormat
  mediumDateTime: Intl.DateTimeFormat
  fullDateTime: Intl.DateTimeFormat
}

let formatters: Formatters | undefined

/** Building an Intl.DateTimeFormat is costly and every message label needs one on each render, so share them.
 * They are rebuilt every minute so a changed time zone or locale is still picked up. */
function currentFormatters(): Formatters {
  const age = formatters ? Date.now() - formatters.builtAt : Infinity
  if (!formatters || age < 0 || age >= formatterLifetimeMs) {
    formatters = {
      builtAt: Date.now(),
      time: new Intl.DateTimeFormat(undefined, timeOptions),
      weekdayTime: new Intl.DateTimeFormat(undefined, { weekday: 'short', ...timeOptions }),
      mediumDateTime: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
      fullDateTime: new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }),
    }
  }
  return formatters
}

export function formatMessageSentAt(value: string, now = new Date()) {
  const sentAt = new Date(value)
  if (Number.isNaN(sentAt.getTime())) {
    return ''
  }

  const { time, weekdayTime, mediumDateTime } = currentFormatters()

  if (isSameLocalDay(sentAt, now)) {
    return time.format(sentAt)
  }

  if (sentAt.getTime() < now.getTime() && now.getTime() - sentAt.getTime() < 7 * dayMs) {
    return weekdayTime.format(sentAt)
  }

  return mediumDateTime.format(sentAt)
}

export function fullMessageSentAt(value: string) {
  const sentAt = new Date(value)
  if (Number.isNaN(sentAt.getTime())) {
    return ''
  }

  return currentFormatters().fullDateTime.format(sentAt)
}

function isSameLocalDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
}
