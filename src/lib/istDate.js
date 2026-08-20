/**
 * 'YYYY-MM-DD' calendar arithmetic in IST.
 *
 * Mirrors the backend's utils/invoiceDate.js, and the test asserts the two
 * produce the SAME value rather than merely similar ones. A calendar date has
 * no time of day, and the browser's timezone must not decide what "today"
 * means for an Indian workshop: `new Date().toISOString().slice(0,10)` flips to
 * tomorrow at 18:30 IST, which is while the workshop is still finishing jobs.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // India has no DST

export function istToday() {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// Date.UTC so this is pure calendar arithmetic with no local-time exposure,
// and so month/year rollovers are handled by the platform rather than by hand.
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// The Monday–Sunday week CONTAINING the given date, not the next seven days.
// "This week" to a workshop owner means the week they are in, including the
// days already gone — a count that changed meaning every morning would be
// useless for comparing against yesterday.
export function weekBounds(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();  // 0 = Sunday
  const from = addDays(ymd, -((dow + 6) % 7));
  return { from, to: addDays(from, 6) };
}

export function fmtDayLabel(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
}

// 'HH:MM:SS' / 'HH:MM' → '9:30 AM'. Returns '—' rather than 'Invalid Date' for
// the appointments that genuinely have no time set.
export function fmtTimeShort(t) {
  if (!t) return '—';
  const [hRaw, mRaw] = String(t).split(':');
  const h = Number(hRaw);
  if (Number.isNaN(h)) return '—';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mRaw ?? '00'} ${ampm}`;
}

/**
 * The 6×7 grid of dates for a calendar month.
 *
 * Always 42 cells, so the grid never changes height as you page through months
 * — a shifting grid makes the "next month" arrow feel like it moved under you.
 * Leading and trailing cells come from the neighbouring months and are flagged
 * `inMonth: false` so the caller can grey them.
 *
 * @param ym         'YYYY-MM'
 * @param weekStart  0 = Sunday (the default, matching the calendar header
 *                   SUN…SAT), 1 = Monday.
 * @returns { from, to, days: [{ date, inMonth }] } — from/to are the FIRST and
 *          LAST cell, not the first and last of the month, because that is the
 *          range the grid actually displays and therefore needs data for.
 */
export function monthGrid(ym, weekStart = 0) {
  const [y, m] = ym.split('-').map(Number);
  const firstOfMonth = `${ym}-01`;
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();       // 0 = Sunday
  // How far back to the start of the week containing the 1st.
  const lead = (dow - weekStart + 7) % 7;
  const start = addDays(firstOfMonth, -lead);

  const days = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    days.push({ date, inMonth: date.slice(0, 7) === ym });
  }
  return { from: days[0].date, to: days[41].date, days };
}

/** 'YYYY-MM' → 'August 2026'. */
export function fmtMonthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Step a 'YYYY-MM' by whole months, handling the year boundary. */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The 'YYYY-MM' a 'YYYY-MM-DD' belongs to. */
export function monthOf(ymd) {
  return ymd.slice(0, 7);
}
