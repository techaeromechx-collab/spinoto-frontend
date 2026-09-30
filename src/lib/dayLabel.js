/**
 * dayLabel.js — the day separator in a message thread, and the clock on a
 * bubble.
 *
 * Extracted from WhatsAppThread.jsx, which is still the only other caller.
 * Internal chat needs the identical behaviour, and two copies of a
 * "Today / Yesterday / 18 March" rule is how one of them ends up saying
 * "Yesterday" at 00:30 while the other says the date.
 *
 * All three are pure, take anything Date can parse, and return '' or null for
 * something they cannot — a thread must never render the string "Invalid Date"
 * because one row had a bad timestamp.
 */

/** Clock time on a bubble. 24h or 12h follows the browser's locale. */
export function when(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Local calendar day, as a key two timestamps can be compared on.
 *
 * LOCAL, deliberately — not the ISO date. A message at 00:30 IST is the small
 * hours of one day here and still the previous afternoon in UTC, so slicing the
 * ISO string would draw the separator in the wrong place for every late-night
 * message, which in a workshop is a lot of them.
 */
export function dayKey(v) {
  const d = new Date(v);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The label on a day separator.
 *
 * The year appears ONLY when it is not the current one. A thread that jumps
 * March → August is ordinary in both places this is used, and "18 March" with no
 * year is ambiguous the moment there are two years in one conversation — which
 * for anything long-running is most of them.
 *
 * Today/Yesterday because that is what the reader's own phone says, and a date
 * where they expect a word makes them do arithmetic.
 *
 * The comparison is on MIDNIGHT, not on elapsed hours: 23:50 and 00:10 are
 * twenty minutes apart and must still read as two different days.
 */
export function dayLabel(v) {
  const d = new Date(v);
  if (isNaN(d)) return '';

  const now = new Date();
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86400000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';

  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * A relative stamp for a list row: "now", "14:05", "Yesterday", "18 March".
 *
 * Not used by the thread — a bubble always wants the clock — but a conversation
 * list wants the coarsest thing that still distinguishes rows, because "14:05"
 * on a row from three weeks ago is worse than no time at all.
 */
export function listStamp(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';

  const diffSec = (Date.now() - d.getTime()) / 1000;
  if (diffSec >= 0 && diffSec < 60) return 'now';

  const label = dayLabel(v);
  return label === 'Today' ? when(v) : label;
}
