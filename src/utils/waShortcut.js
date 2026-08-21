/**
 * The '/' shortcut matcher for the WhatsApp composer.
 *
 * ── WHY THIS IS NOT INSIDE THE COMPONENT ────────────────────────────────────
 *
 * It is the one part of the composer that is pure logic with a right and a
 * wrong answer for inputs nobody types on purpose — a pasted URL, a slash in
 * the middle of a word, a caret dropped back into text already written. Those
 * are the cases a person testing the feature by using it never produces, and
 * exactly the ones a test can hold still. Left inline in the JSX it would be
 * checkable only by "does a picker appear when I type", which is the case that
 * was never in doubt.
 *
 * Returns null when nothing should be offered, or:
 *   { start, end, items }   — the slice of `value` to replace, and the matches
 *
 * `start`/`end` bound the TOKEN, not the whole box: accepting a suggestion
 * replaces '/test' and leaves everything else where it was.
 */

/**
 * @param replies  the active quick replies, as the API returns them
 * @param value    the current text of the composer
 * @param caret    the caret offset within it (selectionStart)
 * @param limit    how many matches to offer
 */
export function matchShortcut(replies, value, caret, limit = 6) {
  if (!Array.isArray(replies) || !replies.length) return null;
  if (typeof value !== 'string') return null;

  const at = Number.isInteger(caret) ? Math.max(0, Math.min(caret, value.length)) : value.length;

  /* The token must OPEN with the slash: start of the box, or after whitespace.
     This is the whole defence against 'https://ik.imagekit.io/…' — the slashes
     there follow a colon and a letter, so no token starts at them and the
     picker stays shut while somebody pastes a link.

     The token then runs to the next whitespace, INCLUDING any further slashes.
     Stopping at a second slash looks tidier and breaks a real case: nothing
     stops an admin naming a shortcut '/car/service', and a token that ended at
     the inner slash would match it right up until the moment they typed it in
     full, then close. '//' still offers nothing — shortcuts are stored with
     exactly one leading slash, so no needle beginning with '/' can match. */
  const m = value.slice(0, at).match(/(?:^|\s)(\/[^\s]*)$/);
  if (!m) return null;

  const token  = m[1];
  const needle = token.slice(1).toLowerCase();

  const items = replies
    .filter((q) => {
      /* Shortcut only, and by PREFIX.

         Matching titles as well would put "Price list" — which has no shortcut
         — behind '/pri', and there is nothing the advisor could have typed to
         mean it; it would appear out of the middle of a word they were still
         writing. Matching anywhere in the shortcut rather than at its start
         has the same problem in miniature: '/at' would offer '/what-we-do'.
         The ⚡ panel is where loose search belongs, and it searches titles,
         shortcuts and message text.

         Normalised the same way the server stores them — lower case, one
         leading slash — so '/Hours' typed in a hurry still matches. */
      const sc = String(q?.shortcut || '').trim().replace(/^\/+/, '').toLowerCase();
      return sc !== '' && sc.startsWith(needle);
    })
    .slice(0, limit);

  if (!items.length) return null;

  return { start: at - token.length, end: at, items };
}

/**
 * Apply a chosen reply to the draft.
 *
 * Splices over the token — the slash was an instruction, not part of the
 * message, and appending instead would send the customer "/test" followed by
 * the reply.
 *
 * Returns { value, caret } rather than setting anything, so the caller owns
 * the state and this stays testable.
 */
export function applyShortcut(value, range, message) {
  const before = value.slice(0, range.start);
  const text   = String(message ?? '');
  return {
    value: before + text + value.slice(range.end),
    caret: (before + text).length,
  };
}
